import fs from "node:fs";
import path from "node:path";

interface GroqChatResponse {
	id: string;
	object: string;
	created: number;
	model: string;
	choices: Array<{
		index: number;
		message: {
			role: string;
			content: string;
		};
		finish_reason: string;
	}>;
	usage: {
		prompt_tokens: number;
		completion_tokens: number;
		total_tokens: number;
	};
}

// Content types for Groq API messages
interface TextContent {
	type: "text";
	text: string;
}

interface ImageUrlContent {
	type: "image_url";
	image_url: {
		url: string;
	};
}

type MessageContent = TextContent | ImageUrlContent;

interface GroqRequestBody {
	model: string;
	messages: Array<{ role: string; content: string | MessageContent[] }>;
	temperature: number;
	response_format?: { type: string };
}

// Custom error type with auth flag
interface AuthError extends Error {
	isAuthError: boolean;
}

// Problem info structure
interface ProblemInfo {
	problem_statement: string;
	context?: string;
	suggested_responses?: string[];
	reasoning?: string;
	input_format?: {
		description: string;
		parameters: unknown[];
	};
	output_format?: {
		description: string;
		type: string;
		subtype: string;
	};
	complexity?: { time: string; space: string };
	test_cases?: unknown[];
	validation_type?: string;
	difficulty?: string;
}

interface ExtractedProblemInfo {
	problem_statement: string;
	context?: string;
	suggested_responses?: string[];
	reasoning?: string;
}

interface SolutionResponse {
	solution: {
		code: string;
		problem_statement: string;
		context?: string;
		suggested_responses?: string[];
		reasoning?: string;
	};
}

type TextModel = "auto" | "openai/gpt-oss-20b" | "openai/gpt-oss-120b";

export class LLMHelper {
	private apiKey: string;
	private textModel: TextModel;
	private readonly visionModel: string;
	private readonly apiUrl = "https://api.groq.com/openai/v1/chat/completions";
	private readonly defaultSystemPrompt =
		`You are Wingman, a highly capable, proactive assistant for any kind of problem or situation (not just coding).

Core behavior:
- Infer what the user is trying to accomplish. If unclear, ask 1–3 precise clarifying questions.
- Provide the best possible answer with strong structure and high signal.
- Use any provided knowledge-base excerpts as the source of truth. If the answer is not supported by those excerpts, say so and suggest what to search for next.
- When you rely on knowledge-base excerpts, include a short Sources section listing the document titles you used (do not invent sources).
- Respect the user's stated preferences and style.
- Be transparent about uncertainty and never fabricate quotes, citations, or facts.

Response style:
- Be concise but thorough; prioritize actionable steps.
- When helpful, include a short rationale (avoid long, step-by-step internal reasoning).`;

	// Dynamic customization fields
	private customSystemPrompt = "";
	private additionalContext = "";
	private memoryContext = "";

	private resolveTextModelForRequest(params?: {
		userMessage?: string;
		historyMessages?: number;
		task?: "chat" | "solution" | "other";
	}): Exclude<TextModel, "auto"> {
		if (this.textModel !== "auto") return this.textModel;

		const message = params?.userMessage?.trim() ?? "";
		const task = params?.task ?? "other";
		const historyMessages = params?.historyMessages ?? 0;
		const memoryChars = this.memoryContext?.length ?? 0;

		let score = 0;
		if (task === "solution") score += 3;
		if (memoryChars > 0) score += 2;
		if (memoryChars > 2500) score += 1;
		if (historyMessages >= 10) score += 1;
		if (message.length > 400) score += 1;
		if (message.length > 1200) score += 1;

		if (
			/\b(debug|refactor|architecture|design|strategy|negotiate|contract|agreement|policy|analy[sz]e|compare|trade-?offs|write code|implement|test plan|root cause)\b/i.test(
				message,
			)
		) {
			score += 2;
		}

		if (/^(hi|hello|thanks|thank you|ok|okay|cool)\b/i.test(message)) {
			score = Math.max(0, score - 2);
		}

		return score >= 4 ? "openai/gpt-oss-120b" : "openai/gpt-oss-20b";
	}

	constructor(apiKey: string, textModel?: TextModel, visionModel?: string) {
		if (!apiKey) {
			throw new Error("GROQ_API_KEY is required");
		}
		this.apiKey = apiKey;
		this.textModel = textModel || "openai/gpt-oss-20b";
		this.visionModel =
			visionModel || "meta-llama/llama-4-scout-17b-16e-instruct";
		console.log(`[LLMHelper] Initialized with Groq API`);
		console.log(`[LLMHelper] Text model: ${this.textModel}`);
		console.log(`[LLMHelper] Vision model: ${this.visionModel}`);
	}

	// Set custom system prompt (role)
	public setCustomSystemPrompt(prompt: string): void {
		this.customSystemPrompt = prompt;
		console.log(`[LLMHelper] Custom system prompt set (${prompt.length} chars)`);
	}

	// Set additional context (user text + profile facts)
	public setAdditionalContext(context: string): void {
		this.additionalContext = context;
		console.log(`[LLMHelper] Additional context set (${context.length} chars)`);
	}

	// Set memory context (from Supermemory search results)
	public setMemoryContext(context: string): void {
		this.memoryContext = context;
		console.log(`[LLMHelper] Memory context set (${context.length} chars)`);
	}

	private buildSystemMessages(): Array<{ role: "system"; content: string }> {
		const messages: Array<{ role: "system"; content: string }> = [];
		messages.push({
			role: "system",
			content: this.customSystemPrompt || this.defaultSystemPrompt,
		});

		if (this.additionalContext) {
			messages.push({
				role: "system",
				content: `User Context:\n${this.additionalContext}`,
			});
		}

		if (this.memoryContext) {
			messages.push({
				role: "system",
				content: `Knowledge Base Excerpts:\n${this.memoryContext}`,
			});
		}

		console.log("[LLMHelper] Building system messages...");
		console.log(`[LLMHelper]   - System messages: ${messages.length}`);
		console.log(`[LLMHelper]   - Has custom prompt: ${!!this.customSystemPrompt}`);
		console.log(
			`[LLMHelper]   - Has additional context: ${!!this.additionalContext} (${this.additionalContext.length} chars)`,
		);
		console.log(
			`[LLMHelper]   - Has memory context: ${!!this.memoryContext} (${this.memoryContext.length} chars)`,
		);
		if (this.memoryContext) {
			console.log(
				`[LLMHelper]   - Memory context preview: "${this.memoryContext.substring(0, 100)}..."`,
			);
		}

		return messages;
	}

	// Reset all customizations to defaults
	public resetCustomization(): void {
		this.customSystemPrompt = "";
		this.additionalContext = "";
		this.memoryContext = "";
		console.log("[LLMHelper] Customizations reset to defaults");
	}

	private async callGroq(
		model: string,
		messages: Array<{ role: string; content: string | MessageContent[] }>,
		options?: {
			temperature?: number;
			responseFormat?: { type: string };
			signal?: AbortSignal;
		},
	): Promise<string> {
		try {
			const body: GroqRequestBody = {
				model,
				messages,
				temperature: options?.temperature ?? 0.7,
				// No max_completion_tokens - let API use maximum available
			};

			if (options?.responseFormat) {
				body.response_format = options.responseFormat;
			}

			const response = await fetch(this.apiUrl, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${this.apiKey}`,
				},
				body: JSON.stringify(body),
				signal: options?.signal,
			});

			if (!response.ok) {
				const errorText = await response.text();
				console.error(
					"[LLMHelper] Groq API error:",
					response.status,
					errorText,
				);

				// Throw specific error for auth failures (401/403)
				if (response.status === 401 || response.status === 403) {
					const authError = new Error(
						`Groq API authentication error: ${response.status} - ${errorText}`,
					) as AuthError;
					authError.isAuthError = true;
					throw authError;
				}

				throw new Error(`Groq API error: ${response.status} - ${errorText}`);
			}

			const data: GroqChatResponse = await response.json();
			return data.choices[0]?.message?.content || "";
		} catch (error: unknown) {
			console.error("[LLMHelper] Error calling Groq:", error);

			// Preserve auth errors - don't wrap them
			if (error instanceof Error && "isAuthError" in error) {
				throw error;
			}

			const message =
				error instanceof Error ? error.message : "Unknown error occurred";
			throw new Error(`Failed to call Groq API: ${message}`);
		}
	}

	private async imageToBase64(imagePath: string): Promise<string> {
		const imageData = await fs.promises.readFile(imagePath);
		return imageData.toString("base64");
	}

	private getImageMimeType(imagePath: string): string {
		const ext = path.extname(imagePath).toLowerCase();
		const mimeTypes: Record<string, string> = {
			".png": "image/png",
			".jpg": "image/jpeg",
			".jpeg": "image/jpeg",
			".gif": "image/gif",
			".webp": "image/webp",
			".bmp": "image/bmp",
			".tiff": "image/tiff",
			".tif": "image/tiff",
		};
		return mimeTypes[ext] || "application/octet-stream";
	}

	private async imageToDataUrl(imagePath: string): Promise<string> {
		const base64 = await this.imageToBase64(imagePath);
		const mimeType = this.getImageMimeType(imagePath);
		return `data:${mimeType};base64,${base64}`;
	}

	private cleanJsonResponse(text: string): string {
		// Remove markdown code block syntax if present
		text = text.replace(/^```(?:json)?\n/, "").replace(/\n```$/, "");
		// Remove any leading/trailing whitespace
		text = text.trim();
		return text;
	}

	private parseJsonResponse<T>(text: string): T {
		const cleaned = this.cleanJsonResponse(text);
		try {
			return JSON.parse(cleaned) as T;
		} catch (_error) {
			// Fallback: attempt to extract the first JSON object from a noisy response.
			const first = cleaned.indexOf("{");
			const last = cleaned.lastIndexOf("}");
			if (first !== -1 && last !== -1 && last > first) {
				const candidate = cleaned.slice(first, last + 1);
				return JSON.parse(candidate) as T;
			}
			throw _error;
		}
	}

	public async extractProblemFromImages(
		imagePaths: string[],
		signal?: AbortSignal,
	): Promise<ExtractedProblemInfo> {
		try {
			// Build content array with text and images
			const content: MessageContent[] = [
				{
					type: "text",
					text: `Please analyze these images and extract the following information in JSON format:\n{
  "problem_statement": "A clear statement of the problem or situation depicted in the images.",
  "context": "Relevant background or context from the images.",
  "suggested_responses": ["First possible answer or action", "Second possible answer or action", "..."],
  "reasoning": "Explanation of why these suggestions are appropriate."
}\nImportant: Return ONLY the JSON object, without any markdown formatting or code blocks.`,
				},
			];

			// Add images (max 5 per Groq limits)
			const imagesToProcess = imagePaths.slice(0, 5);
			for (const imagePath of imagesToProcess) {
				const dataUrl = await this.imageToDataUrl(imagePath);
				content.push({
					type: "image_url",
					image_url: {
						url: dataUrl,
					},
				});
			}

			let response: string;
				try {
					// Prefer JSON mode when available; fall back for models/endpoints that don't support it.
					response = await this.callGroq(
						this.visionModel,
						[...this.buildSystemMessages(), { role: "user", content }],
						{ temperature: 1, responseFormat: { type: "json_object" }, signal },
					);
				} catch (e: unknown) {
					const message = e instanceof Error ? e.message : String(e);
					if (message.includes("response_format") || message.includes("json_object")) {
						response = await this.callGroq(
							this.visionModel,
							[...this.buildSystemMessages(), { role: "user", content }],
							{ temperature: 1, signal },
						);
					} else {
						throw e;
					}
			}

			try {
				const parsed = this.parseJsonResponse<ExtractedProblemInfo>(response);
				return parsed;
			} catch (e: unknown) {
				console.error(
					"[LLMHelper] JSON parse error:",
					e,
					"Raw response:",
					response,
				);
				const message = e instanceof Error ? e.message : "Unknown parse error";
				throw new Error(`Failed to parse Groq response as JSON: ${message}`);
			}
		} catch (error) {
			console.error("[LLMHelper] Error extracting problem from images:", error);
			throw error;
		}
	}

	public async generateSolution(
		problemInfo: ProblemInfo,
		signal?: AbortSignal,
	): Promise<SolutionResponse> {
		const prompt = `Given this problem or situation:\n${JSON.stringify(problemInfo, null, 2)}\n\nPlease provide your response in the following JSON format:\n{
  "solution": {
    "code": "The code or main answer here.",
    "problem_statement": "Restate the problem or situation.",
    "context": "Relevant background/context.",
    "suggested_responses": ["First possible answer or action", "Second possible answer or action", "..."],
    "reasoning": "Explanation of why these suggestions are appropriate."
  }
}\nImportant: Return ONLY the JSON object, without any markdown formatting or code blocks.`;

		console.log("[LLMHelper] Calling Groq for solution...");
		try {
			const model = this.resolveTextModelForRequest({
				task: "solution",
				userMessage: prompt,
			});

			let response: string;
				try {
					// Prefer JSON mode when available; fall back for models/endpoints that don't support it.
					response = await this.callGroq(
						model,
						[...this.buildSystemMessages(), { role: "user", content: prompt }],
						{ temperature: 0.7, responseFormat: { type: "json_object" }, signal },
					);
				} catch (e: unknown) {
					const message = e instanceof Error ? e.message : String(e);
					if (message.includes("response_format") || message.includes("json_object")) {
						response = await this.callGroq(
							model,
							[...this.buildSystemMessages(), { role: "user", content: prompt }],
							{ temperature: 0.7, signal },
						);
					} else {
						throw e;
					}
			}
			console.log("[LLMHelper] Groq returned result.");
			try {
				const parsed = this.parseJsonResponse<SolutionResponse>(response);
				console.log("[LLMHelper] Parsed response:", parsed);
				return parsed;
			} catch (e: unknown) {
				console.error(
					"[LLMHelper] JSON parse error:",
					e,
					"Raw response:",
					response,
				);
				const message = e instanceof Error ? e.message : "Unknown parse error";
				throw new Error(`Failed to parse Groq response as JSON: ${message}`);
			}
		} catch (error) {
			console.error("[LLMHelper] Error in generateSolution:", error);
			throw error;
		}
	}

	public async debugSolutionWithImages(
		problemInfo: ProblemInfo,
		currentCode: string,
		debugImagePaths: string[],
		signal?: AbortSignal,
	): Promise<SolutionResponse> {
		try {
			// Build content array with text and images
			const content: MessageContent[] = [
				{
					type: "text",
					text: `Given:\n1. The original problem or situation: ${JSON.stringify(problemInfo, null, 2)}\n2. The current response or approach: ${currentCode}\n3. The debug information in the provided images\n\nPlease analyze the debug information and provide feedback in this JSON format:\n{
  "solution": {
    "code": "The code or main answer here.",
    "problem_statement": "Restate the problem or situation.",
    "context": "Relevant background/context.",
    "suggested_responses": ["First possible answer or action", "Second possible answer or action", "..."],
    "reasoning": "Explanation of why these suggestions are appropriate."
  }
}\nImportant: Return ONLY the JSON object, without any markdown formatting or code blocks.`,
				},
			];

			// Add images (max 5 per Groq limits)
			const imagesToProcess = debugImagePaths.slice(0, 5);
			for (const imagePath of imagesToProcess) {
				const dataUrl = await this.imageToDataUrl(imagePath);
				content.push({
					type: "image_url",
					image_url: {
						url: dataUrl,
					},
				});
			}

			let response: string;
				try {
					// Prefer JSON mode when available; fall back for models/endpoints that don't support it.
					response = await this.callGroq(
						this.visionModel,
						[...this.buildSystemMessages(), { role: "user", content }],
						{ temperature: 1, responseFormat: { type: "json_object" }, signal },
					);
				} catch (e: unknown) {
					const message = e instanceof Error ? e.message : String(e);
					if (message.includes("response_format") || message.includes("json_object")) {
						response = await this.callGroq(
							this.visionModel,
							[...this.buildSystemMessages(), { role: "user", content }],
							{ temperature: 1, signal },
						);
					} else {
						throw e;
					}
			}

			try {
				const parsed = this.parseJsonResponse<SolutionResponse>(response);
				console.log("[LLMHelper] Parsed debug response:", parsed);
				return parsed;
			} catch (e: unknown) {
				console.error(
					"[LLMHelper] JSON parse error:",
					e,
					"Raw response:",
					response,
				);
				const message = e instanceof Error ? e.message : "Unknown parse error";
				throw new Error(`Failed to parse Groq response as JSON: ${message}`);
			}
		} catch (error) {
			console.error("[LLMHelper] Error debugging solution with images:", error);
			throw error;
		}
	}

	public async analyzeImageFile(imagePath: string, signal?: AbortSignal) {
		try {
			const dataUrl = await this.imageToDataUrl(imagePath);

			const content: MessageContent[] = [
				{
					type: "text",
					text: `Describe the content of this image in a short, concise answer. In addition to your main answer, suggest several possible actions or responses the user could take next based on the image. Do not return a structured JSON object, just answer naturally as you would to a user.`,
				},
				{
					type: "image_url",
					image_url: {
						url: dataUrl,
					},
				},
			];

			const response = await this.callGroq(
				this.visionModel,
				[...this.buildSystemMessages(), { role: "user", content }],
				{ temperature: 1, signal },
			);

			return { text: response, timestamp: Date.now() };
		} catch (error) {
			console.error("[LLMHelper] Error analyzing image file:", error);
			throw error;
		}
	}

	public async chat(
		message: string,
		history?: Array<{ role: "user" | "assistant"; content: string }>,
		signal?: AbortSignal,
	): Promise<string> {
		try {
			const messages: Array<{ role: string; content: string }> = [
				...this.buildSystemMessages(),
			];
			if (history && history.length > 0) {
				for (const m of history) {
					if (m?.content) {
						messages.push({ role: m.role, content: m.content });
					}
				}
			}
			messages.push({ role: "user", content: message });

			const model = this.resolveTextModelForRequest({
				task: "chat",
				userMessage: message,
				historyMessages: history?.length ?? 0,
			});
			const response = await this.callGroq(model, messages, {
				temperature: 0.7,
				signal,
			});
			return response;
		} catch (error) {
			console.error("[LLMHelper] Error in chat:", error);
			throw error;
		}
	}

	public getCurrentModel(): string {
		return this.textModel;
	}

	public getVisionModel(): string {
		return this.visionModel;
	}

	public getAvailableModels(): string[] {
		return ["auto", "openai/gpt-oss-20b", "openai/gpt-oss-120b"];
	}

	public switchModel(model: TextModel): void {
		if (
			model !== "auto" &&
			model !== "openai/gpt-oss-20b" &&
			model !== "openai/gpt-oss-120b"
		) {
			throw new Error(
				`Invalid model: ${model}. Must be auto, openai/gpt-oss-20b, or openai/gpt-oss-120b`,
			);
		}
		this.textModel = model;
		console.log(`[LLMHelper] Switched to model: ${this.textModel}`);
	}

	public async testConnection(): Promise<{ success: boolean; error?: string }> {
		try {
			// Test with a simple prompt
			const model = this.resolveTextModelForRequest({
				task: "other",
				userMessage: "Hello",
			});
			await this.callGroq(
				model,
				[{ role: "user", content: "Hello" }],
				{ temperature: 0.7 },
			);
			return { success: true };
		} catch (error: unknown) {
			const message =
				error instanceof Error ? error.message : "Unknown error occurred";
			return { success: false, error: message };
		}
	}
}
