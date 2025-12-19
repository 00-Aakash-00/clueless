// ProcessingHelper.ts

import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
	import { app } from "electron";
	import { LLMHelper } from "./LLMHelper";
	import {
		SupermemoryHelper,
		ROLE_PRESETS,
		type CustomizeConfig,
		type StoredDocument,
		type AboutYouEntry,
		type ListDocumentsOptions,
		type ListedDocument,
		type ListDocumentsResponse,
		type SupermemoryConnection,
		type SupermemoryProvider,
		type CreateConnectionResponse,
		type DeleteConnectionResponse,
		type ConnectionDocument,
	} from "./SupermemoryHelper";
	import type { AppState } from "./main";

dotenv.config();

type TextModel = "auto" | "openai/gpt-oss-20b" | "openai/gpt-oss-120b";

type ChatRole = "user" | "assistant";
interface ChatHistoryMessage {
	role: ChatRole;
	content: string;
	timestamp: number;
}

export class ProcessingHelper {
	private appState: AppState;
	private llmHelper: LLMHelper;
	private supermemoryHelper: SupermemoryHelper | null = null;
	private currentProcessingAbortController: AbortController | null = null;
	private currentExtraProcessingAbortController: AbortController | null = null;
	private chatHistory: ChatHistoryMessage[] = [];
	private readonly MAX_CHAT_HISTORY_MESSAGES = 30;
	private readonly MAX_CHAT_MESSAGE_CHARS = 8000;
	private readonly MAX_MEMORY_CONTEXT_CHARS = 12000;
	private cachedProfile: { static: string[]; dynamic: string[] } | null = null;
	private cachedProfileAt = 0;
	private readonly PROFILE_CACHE_MS = 10 * 60 * 1000;

	constructor(appState: AppState) {
		this.appState = appState;

		// Get Groq API key from environment
		const apiKey = process.env.GROQ_API_KEY;
		if (!apiKey) {
			throw new Error("GROQ_API_KEY not found in environment variables");
		}

		// Get text model from environment (default to auto)
		const rawTextModel = process.env.GROQ_TEXT_MODEL;
		const allowedTextModels: TextModel[] = [
			"auto",
			"openai/gpt-oss-20b",
			"openai/gpt-oss-120b",
		];
		const textModel: TextModel = allowedTextModels.includes(rawTextModel as TextModel)
			? (rawTextModel as TextModel)
			: "auto";

		// Get vision model from environment (optional)
		const visionModel = process.env.GROQ_VISION_MODEL;

		console.log("[ProcessingHelper] Initializing with Groq Cloud");
		this.llmHelper = new LLMHelper(apiKey, textModel, visionModel);

		// Initialize SupermemoryHelper if API key is available
		const supermemoryApiKey = process.env.SUPERMEMORY_API_KEY;
		if (supermemoryApiKey) {
			console.log("[ProcessingHelper] Initializing Supermemory");
			this.supermemoryHelper = new SupermemoryHelper(supermemoryApiKey);

			// Sync role/system prompt first
			const effectivePrompt = this.supermemoryHelper.getEffectiveSystemPrompt();
			this.llmHelper.setCustomSystemPrompt(effectivePrompt);

			// Sync initial context to LLMHelper (About You + session context + cached profile when available)
			this.syncAdditionalContextToLlm();
			void this.getUserProfile(true);
		} else {
			console.log(
				"[ProcessingHelper] Supermemory API key not found, customization features limited",
			);
		}
	}

	public async processScreenshots(): Promise<void> {
		const mainWindow = this.appState.getMainWindow();
		if (!mainWindow) return;

		const view = this.appState.getView();

		if (view === "queue") {
			const screenshotQueue = this.appState
				.getScreenshotHelper()
				.getScreenshotQueue();
			if (screenshotQueue.length === 0) {
				mainWindow.webContents.send(
					this.appState.PROCESSING_EVENTS.NO_SCREENSHOTS,
				);
				return;
			}

			const allPaths = this.appState.getScreenshotHelper().getScreenshotQueue();

			// Handle screenshots as batch image analysis (processes all screenshots, up to 5)
			mainWindow.webContents.send(
				this.appState.PROCESSING_EVENTS.INITIAL_START,
			);
			this.appState.setView("solutions");
			this.currentProcessingAbortController = new AbortController();
			const signal = this.currentProcessingAbortController.signal;
			try {
				// Use extractProblemFromImages for batch processing all screenshots
				const extractedProblem = await this.llmHelper.extractProblemFromImages(
					allPaths,
					signal,
				);
				const problemInfo = {
					problem_statement: extractedProblem.problem_statement,
					context: extractedProblem.context,
					suggested_responses: extractedProblem.suggested_responses,
					reasoning: extractedProblem.reasoning,
					input_format: {
						description: "Generated from screenshots",
						parameters: [] as unknown[],
					},
					output_format: {
						description: "Generated from screenshots",
						type: "string",
						subtype: "text",
					},
					complexity: { time: "N/A", space: "N/A" },
					test_cases: [] as unknown[],
					validation_type: "auto_extracted",
					difficulty: "custom",
				};
				mainWindow.webContents.send(
					this.appState.PROCESSING_EVENTS.PROBLEM_EXTRACTED,
					problemInfo,
				);
				this.appState.setProblemInfo(problemInfo);

				// Search memories using the extracted problem/context, so uploaded documents can influence the solution.
				const memoryQuery = [problemInfo.problem_statement, problemInfo.context]
					.filter(Boolean)
					.join("\n\n");
				await this.prepareMemoryContext(memoryQuery || "problem solving context");

				// Generate solution and emit SOLUTION_SUCCESS
				const solution = await this.llmHelper.generateSolution(
					problemInfo,
					signal,
				);

				// Store the solution code for accurate debug diffs later
				if (solution?.solution?.code) {
					this.appState.setCurrentSolutionCode(solution.solution.code);
					this.addToChatHistory(
						"assistant",
						`[Generated solution]\n\n${solution.solution.code}`,
					);
				}

				mainWindow.webContents.send(
					this.appState.PROCESSING_EVENTS.SOLUTION_SUCCESS,
					solution,
				);
			} catch (error: unknown) {
				console.error("Image processing error:", error);

				// Reset view back to queue on any error during initial processing
				this.appState.setView("queue");

				// Check for auth errors and emit UNAUTHORIZED event
				const isAuthError =
					error instanceof Error &&
					"isAuthError" in error &&
					(error as { isAuthError: boolean }).isAuthError;
				if (isAuthError) {
					mainWindow.webContents.send(
						this.appState.PROCESSING_EVENTS.UNAUTHORIZED,
					);
				} else {
					const message =
						error instanceof Error ? error.message : "Unknown error occurred";
					mainWindow.webContents.send(
						this.appState.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
						message,
					);
				}
			} finally {
				this.currentProcessingAbortController = null;
			}
			return;
		} else {
			// Debug mode
			const extraScreenshotQueue = this.appState
				.getScreenshotHelper()
				.getExtraScreenshotQueue();
			if (extraScreenshotQueue.length === 0) {
				console.log("No extra screenshots to process");
				mainWindow.webContents.send(
					this.appState.PROCESSING_EVENTS.NO_SCREENSHOTS,
				);
				return;
			}

			// Early guard: Check prerequisites BEFORE starting debug
			const problemInfo = this.appState.getProblemInfo();
			const oldCode = this.appState.getCurrentSolutionCode();
			if (!problemInfo || !oldCode) {
				console.log("Missing prerequisites for debug, resetting to queue");
				this.appState.setView("queue");
				mainWindow.webContents.send(
					this.appState.PROCESSING_EVENTS.DEBUG_ERROR,
					"No solution to debug. Please take screenshots and process first.",
				);
				return;
			}

			mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.DEBUG_START);
			this.currentExtraProcessingAbortController = new AbortController();
			const debugSignal = this.currentExtraProcessingAbortController.signal;

			try {
				// Search memories for relevant context before debugging
				await this.prepareMemoryContext(problemInfo.problem_statement || "debugging code solution");

				// Debug the solution using vision model
				const debugResult = await this.llmHelper.debugSolutionWithImages(
					problemInfo,
					oldCode,
					extraScreenshotQueue,
					debugSignal,
				);

				this.appState.setHasDebugged(true);
				if (debugResult?.solution?.code) {
					this.addToChatHistory(
						"assistant",
						`[Debugged solution]\n\n${debugResult.solution.code}`,
					);
				}

				// Send data in the format the frontend expects: { solution: { old_code, new_code, thoughts, time_complexity, space_complexity } }
				// Solutions.tsx accesses data.solution, then sets it to queryClient cache
				// Debug.tsx reads from cache expecting { old_code, new_code, thoughts, time_complexity, space_complexity }
				mainWindow.webContents.send(
					this.appState.PROCESSING_EVENTS.DEBUG_SUCCESS,
					{
						solution: {
							old_code: oldCode,
							new_code: debugResult.solution.code,
							thoughts: debugResult.solution.suggested_responses || [],
							time_complexity: "N/A",
							space_complexity: "N/A",
						},
					},
				);
			} catch (error: unknown) {
				console.error("Debug processing error:", error);

				// Check for auth errors and emit UNAUTHORIZED event
				const isAuthError =
					error instanceof Error &&
					"isAuthError" in error &&
					(error as { isAuthError: boolean }).isAuthError;
				if (isAuthError) {
					// Reset view to queue on auth errors (user needs to fix API key)
					this.appState.setView("queue");
					mainWindow.webContents.send(
						this.appState.PROCESSING_EVENTS.UNAUTHORIZED,
					);
				} else {
					// Non-auth debug errors: stay in solutions view, just show error
					const message =
						error instanceof Error ? error.message : "Unknown error occurred";
					mainWindow.webContents.send(
						this.appState.PROCESSING_EVENTS.DEBUG_ERROR,
						message,
					);
				}
			} finally {
				this.currentExtraProcessingAbortController = null;
			}
		}
	}

	public cancelOngoingRequests(): void {
		if (this.currentProcessingAbortController) {
			this.currentProcessingAbortController.abort();
			this.currentProcessingAbortController = null;
		}

		if (this.currentExtraProcessingAbortController) {
			this.currentExtraProcessingAbortController.abort();
			this.currentExtraProcessingAbortController = null;
		}

		this.appState.setHasDebugged(false);
	}

	public resetConversation(): void {
		this.chatHistory = [];
		this.llmHelper.setMemoryContext("");
	}

	private addToChatHistory(role: ChatRole, content: string): void {
		const trimmed = content?.trim();
		if (!trimmed) return;

		const safeContent =
			trimmed.length > this.MAX_CHAT_MESSAGE_CHARS
				? `${trimmed.slice(0, this.MAX_CHAT_MESSAGE_CHARS)}\n\n...[truncated]`
				: trimmed;

		this.chatHistory.push({ role, content: safeContent, timestamp: Date.now() });
		if (this.chatHistory.length > this.MAX_CHAT_HISTORY_MESSAGES) {
			this.chatHistory = this.chatHistory.slice(
				this.chatHistory.length - this.MAX_CHAT_HISTORY_MESSAGES,
			);
		}
	}

	private buildRetrievalQuery(userMessage: string): string {
		const recentUserMessages = this.chatHistory
			.filter((m) => m.role === "user")
			.slice(-2)
			.map((m) => m.content.trim())
			.filter(Boolean)
			.map((m) => (m.length > 400 ? `${m.slice(0, 400)}…` : m));

		const parts = [...recentUserMessages, userMessage.trim()].filter(Boolean);
		return parts.join("\n\n");
	}

	public async chat(message: string): Promise<string> {
		const trimmed = message.trim();
		if (!trimmed) return "";

		await this.prepareMemoryContext(this.buildRetrievalQuery(trimmed));

		const history = this.chatHistory.map((m) => ({
			role: m.role,
			content: m.content,
		}));

		const response = await this.llmHelper.chat(trimmed, history);
		this.addToChatHistory("user", trimmed);
		this.addToChatHistory("assistant", response);
		return response;
	}

	private async generateCallBriefSummaryFromTranscript(transcript: string): Promise<string> {
		const trimmed = transcript.trim();
		if (!trimmed) return "";

		const prompt = [
			"You are helping the user during an ongoing conversation.",
			"Summarize the situation so far in a way that helps craft the next response. Use only what is in the transcript.",
			"",
			"Output format:",
			"- Context (1 sentence)",
			"- What they want (1 bullet)",
			"- What we know (1–3 bullets)",
			"- Best next step (1 bullet)",
			"",
			"Transcript:",
			trimmed,
		].join("\n");

		return await this.llmHelper.chatWithOverrides({
			message: prompt,
			temperature: 0.3,
			task: "other",
			overrides: { memoryContext: "" },
		});
	}

	private async buildKnowledgeBaseContextForLiveReply(query: string): Promise<string> {
		const helper = this.supermemoryHelper;
		if (!helper) return "";
		const q = query.trim();
		if (q.length < 3) return "";

		const aboutYouIds = new Set(
			helper
				.getAboutYouEntries()
				.map((entry) => entry.supermemoryId)
				.filter((id): id is string => typeof id === "string" && id.trim().length > 0),
		);

		const kbFilters = {
			AND: [
				{ key: "type", value: "about_you", negate: true },
				{ key: "type", value: "text_context", negate: true },
				{ key: "source", value: "about_you", negate: true },
				{ key: "type", value: "call_utterance", negate: true },
				{ key: "type", value: "call_summary", negate: true },
				{ key: "source", value: "call", negate: true },
			],
		};

		const clamp = (text: string, maxChars: number): string => {
			const trimmed = text.trim();
			if (trimmed.length <= maxChars) return trimmed;
			return `${trimmed.slice(0, maxChars)}…`;
		};

		const buildDocBlocks = (
			docs: Array<Awaited<ReturnType<typeof helper.searchDocuments>>["results"][number]>,
		): string => {
			const MAX_DOCS = 4;
			const MAX_CHUNKS_PER_DOC = 3;
			const MAX_DOC_SUMMARY_CHARS = 650;
			const MAX_CHUNK_CHARS = 800;

			const blocks: string[] = [];
			for (const doc of docs.slice(0, MAX_DOCS)) {
				const meta =
					doc.metadata && typeof doc.metadata === "object" && !Array.isArray(doc.metadata)
						? (doc.metadata as Record<string, unknown>)
						: {};
				const filename = typeof meta.filename === "string" ? meta.filename.trim() : "";
				const title =
					(typeof doc.title === "string" && doc.title.trim()) ||
					filename ||
					doc.documentId;
				const score =
					typeof doc.score === "number" && Number.isFinite(doc.score) ? doc.score : null;

				const lines: string[] = [];
				lines.push(
					`### ${[title, score !== null ? `score ${score.toFixed(2)}` : ""]
						.filter(Boolean)
						.join(" — ")}`,
				);

				const summary = typeof doc.summary === "string" ? doc.summary.trim() : "";
				if (summary) lines.push(`Summary: ${clamp(summary, MAX_DOC_SUMMARY_CHARS)}`);

				const chunks = Array.isArray(doc.chunks) ? doc.chunks : [];
				for (const chunk of chunks.slice(0, MAX_CHUNKS_PER_DOC)) {
					const content = typeof chunk.content === "string" ? chunk.content.trim() : "";
					if (!content) continue;
					const chunkScore =
						typeof chunk.score === "number" && Number.isFinite(chunk.score)
							? chunk.score
							: null;
					lines.push(
						`${chunkScore !== null ? `- (${chunkScore.toFixed(2)}) ` : "- "}${clamp(content, MAX_CHUNK_CHARS)}`,
					);
				}

				blocks.push(lines.join("\n"));
			}
			return blocks.join("\n\n").trim();
		};

		try {
			const docsResult = await helper.searchDocuments(q, {
				limit: 4,
				documentThreshold: 0.55,
				chunkThreshold: 0.65,
				rewriteQuery: true,
				rerank: true,
				includeSummary: true,
				onlyMatchingChunks: true,
				filters: kbFilters,
			});

			const filteredDocs = docsResult.results.filter((doc) => {
				if (aboutYouIds.has(doc.documentId)) return false;
				const meta =
					doc.metadata && typeof doc.metadata === "object" && !Array.isArray(doc.metadata)
						? (doc.metadata as Record<string, unknown>)
						: {};
				const source = typeof meta.source === "string" ? meta.source : "";
				const type = typeof meta.type === "string" ? meta.type : "";
				if (source === "about_you" || type === "about_you") return false;
				if (source === "call" || type === "call_utterance" || type === "call_summary") {
					return false;
				}
				if (type === "text_context") return false;
				return true;
			});

			if (filteredDocs.length > 0) {
				const instruction =
					"Knowledge base excerpts (use for grounding). Do not add a Sources section in your reply. Do not mention file names unless the user asks.";
				const blocks = buildDocBlocks(filteredDocs);
				return blocks ? `${instruction}\n\n${blocks}`.trim() : "";
			}
		} catch (error) {
			console.warn("[ProcessingHelper] Knowledge base lookup failed:", error);
		}

		try {
			const memResult = await helper.searchMemories(q, {
				limit: 6,
				threshold: 0.45,
				rerank: true,
				rewriteQuery: true,
				include: { documents: true, summaries: true },
				filters: kbFilters,
			});
			if (memResult.results.length === 0) return "";
			const lines: string[] = [];
			lines.push(
				"Knowledge base excerpts (use for grounding). Do not add a Sources section in your reply. Do not mention file names unless the user asks.",
			);
			lines.push("");
			for (const item of memResult.results.slice(0, 6)) {
				const text = typeof item.memory === "string" ? item.memory.trim() : "";
				if (!text) continue;
				lines.push(`- ${clamp(text, 420)}`);
			}
			return lines.join("\n").trim();
		} catch (error) {
			console.warn("[ProcessingHelper] Knowledge base memory lookup failed:", error);
			return "";
		}
	}

	public async generateLiveWhatDoISay(): Promise<string> {
		const active = this.appState.callAssistManager.getActiveSession();
		if (!active) {
			throw new Error("Start Call Assist first to use live reply.");
		}

		const transcriptTailRaw = this.appState.callAssistManager.getTranscriptTail(18).trim();
		if (!transcriptTailRaw) {
			throw new Error("No transcript yet. Speak for a few seconds, then try again.");
		}

		const clamp = (text: string, maxChars: number): string => {
			const trimmed = text.trim();
			if (trimmed.length <= maxChars) return trimmed;
			return `${trimmed.slice(0, maxChars)}…`;
		};

		const question = this.appState.callAssistManager.getMostRecentQuestion();
		const recentQuestionText = question?.text?.trim() ?? "";
		const recentQuestionSpeaker = question?.speakerLabel?.trim() || "Other person";

		const transcriptTail = clamp(transcriptTailRaw, 2200);
		const summaryRaw = await this.generateCallBriefSummaryFromTranscript(transcriptTail);
		const callSummary = clamp(summaryRaw, 1400);

		const kbQuery = recentQuestionText || transcriptTail;
		const kbContext = await this.buildKnowledgeBaseContextForLiveReply(kbQuery);

		const prompt = [
			"You are helping the user respond live in an ongoing conversation.",
			"",
			"Call context:",
			`- Most recent question (${recentQuestionSpeaker}):`,
			recentQuestionText ? `"${clamp(recentQuestionText, 420)}"` : "(No clear question detected.)",
			"",
			"- Call summary:",
			callSummary || "(Summary unavailable.)",
			"",
			"- Recent transcript:",
			transcriptTail,
			"",
			"Task:",
			"- Write exactly what the user should say next (natural speaking voice).",
			"- Lead with the direct answer in 1–3 sentences.",
			"- If you need clarification, ask exactly one short question at the end.",
			"- Keep it confident and specific; avoid filler.",
			"- Do not mention being an assistant or AI.",
			"",
			"Output format:",
			"Say:",
			"<1 short paragraph>",
			"",
			"Ask (optional):",
			"<one short question or leave blank>",
		].join("\n");

		return await this.llmHelper.chatWithOverrides({
			message: prompt,
			temperature: 0.45,
			task: "chat",
			overrides: {
				memoryContext: kbContext,
			},
		});
	}

	public async generateCallAssistSuggestion(params: {
		callId: string;
		utterance: string;
		transcriptTail: string;
	}): Promise<string> {
		const utterance = params.utterance.trim();
		if (!utterance) return "";

		const transcriptTail = params.transcriptTail.trim();

		let memoryContext = "";
		if (this.supermemoryHelper) {
			try {
				const docsResult = await this.supermemoryHelper.searchDocuments(utterance, {
					limit: 4,
					documentThreshold: 0.55,
					chunkThreshold: 0.65,
					rewriteQuery: true,
					rerank: true,
					includeSummary: true,
					onlyMatchingChunks: true,
				});

				const filteredDocs = docsResult.results.filter((doc) => {
					const meta =
						doc.metadata &&
						typeof doc.metadata === "object" &&
						!Array.isArray(doc.metadata)
							? (doc.metadata as Record<string, unknown>)
							: {};
					const source = typeof meta.source === "string" ? meta.source : "";
					const type = typeof meta.type === "string" ? meta.type : "";
					if (source === "about_you" || type === "about_you") return false;
					if (type === "text_context") return false;
					if (source === "call" || type === "call_utterance" || type === "call_summary") {
						return false;
					}
					return true;
				});

				if (filteredDocs.length > 0) {
					const clamp = (text: string, maxChars: number): string => {
						const trimmedText = text.trim();
						if (trimmedText.length <= maxChars) return trimmedText;
						return `${trimmedText.slice(0, maxChars)}…`;
					};

					const blocks: string[] = [];
					const MAX_DOCS = 4;
					const MAX_CHUNKS_PER_DOC = 3;
					const MAX_DOC_SUMMARY_CHARS = 700;
					const MAX_CHUNK_CHARS = 700;

					for (const doc of filteredDocs.slice(0, MAX_DOCS)) {
						const meta =
							doc.metadata &&
							typeof doc.metadata === "object" &&
							!Array.isArray(doc.metadata)
								? (doc.metadata as Record<string, unknown>)
								: {};
						const filename =
							typeof meta.filename === "string" ? meta.filename.trim() : "";
						const title =
							(typeof doc.title === "string" && doc.title.trim()) ||
							filename ||
							doc.documentId;
						const lines: string[] = [];
						lines.push(`### ${title}`);

						const summary =
							typeof doc.summary === "string" ? doc.summary.trim() : "";
						if (summary) {
							lines.push(`Summary: ${clamp(summary, MAX_DOC_SUMMARY_CHARS)}`);
						}

						const chunks = Array.isArray(doc.chunks) ? doc.chunks : [];
						for (const chunk of chunks.slice(0, MAX_CHUNKS_PER_DOC)) {
							const content =
								typeof chunk.content === "string" ? chunk.content.trim() : "";
							if (!content) continue;
							lines.push(`- ${clamp(content, MAX_CHUNK_CHARS)}`);
						}
						blocks.push(lines.join("\n"));
					}

					const instruction =
						"Use the knowledge base excerpts below when they help. If you used them, include a short Sources section listing the document titles you relied on (do not invent sources). If no excerpt is relevant, do not force it.";
					memoryContext = `${instruction}\n\n${blocks.join("\n\n")}`.trim();
				}
			} catch (error) {
				console.warn("[ProcessingHelper] Call assist KB lookup failed:", error);
			}
		}

		const promptParts: string[] = [];
		promptParts.push("You are assisting the user during a live conversation.");
		promptParts.push(`Other speaker just finished saying:\n\"${utterance}\"`);
		if (transcriptTail) {
			promptParts.push(`Recent transcript:\n${transcriptTail}`);
		}
		promptParts.push(
			[
				"Task:",
				"- Draft a reply the user can say next (brief, natural, confident).",
				"- If they asked a question, answer directly first, then add a crisp next step.",
				"- If there is missing context, ask exactly one clarifying question.",
				"- If a knowledge-base excerpt is relevant, use it and include a Sources section.",
			].join("\n"),
		);

		const callAssistPrompt = promptParts.join("\n\n");

		try {
			return await this.llmHelper.chatWithOverrides({
				message: callAssistPrompt,
				overrides: { memoryContext },
				temperature: 0.5,
				task: "other",
			});
		} catch (error) {
			console.error("[ProcessingHelper] Call assist suggestion failed:", error);
			throw error;
		}
	}

	public async generateCallSummary(params: {
		callId: string;
		transcript: string;
	}): Promise<string> {
		const transcript = params.transcript.trim();
		if (!transcript) return "";

		const prompt = [
			"You are helping the user after a live conversation.",
			"Write a concise, high-signal summary based only on the transcript.",
			"",
			"Output format:",
			"- Summary (2–4 sentences)",
			"- Decisions (0–5 bullets)",
			"- Action Items (0–8 bullets, each with an owner if implied)",
			"- Open Questions (0–6 bullets)",
			"- Next Best Move (1–2 bullets)",
			"",
			"Transcript:",
			transcript,
		].join("\n");

		try {
			return await this.llmHelper.chatWithOverrides({
				message: prompt,
				temperature: 0.4,
				task: "other",
				overrides: {
					memoryContext: "",
				},
			});
		} catch (error) {
			console.error("[ProcessingHelper] Call summary generation failed:", error);
			throw error;
		}
	}

	public async analyzeImageFile(
		imagePath: string,
	): Promise<{ text: string; timestamp: number }> {
		const result = await this.llmHelper.analyzeImageFile(imagePath);
		this.addToChatHistory("assistant", `[Screenshot analysis]\n\n${result.text}`);
		return result;
	}

	/**
	 * Search Supermemory for relevant context and inject it into the LLM prompt.
	 * Called automatically before LLM operations to include uploaded documents.
	 */
		private async prepareMemoryContext(query: string): Promise<void> {
			if (!this.supermemoryHelper) {
				// Ensure we don't reuse stale memory context across sessions/flows.
				this.llmHelper.setMemoryContext("");
			console.log(
				"[ProcessingHelper] Supermemory not available, skipping memory search",
			);
			return;
		}

				try {
					console.log(
						`[ProcessingHelper] Searching memories for: "${query.substring(0, 50)}..."`,
					);

					const uploadedDocs = this.supermemoryHelper.getDocuments();
					const hasUploadedDocs = uploadedDocs.length > 0;
					const aboutYouIds = new Set(
						this.supermemoryHelper
							.getAboutYouEntries()
							.map((entry) => entry.supermemoryId)
							.filter(
								(id): id is string =>
									typeof id === "string" && id.trim().length > 0,
							),
					);
					const containerTag = this.supermemoryHelper.getDefaultContainerTag();
					const queryForHints = query.trim();
					const queryHintsCall =
						/\b(call|calls|meeting|meetings|transcript|caption|captions|what did (?:i|we|they) say|earlier|previously|last time|action items|follow-?ups)\b/i.test(
							queryForHints,
						);
					const kbFilters = {
						AND: [
							{ key: "type", value: "about_you", negate: true },
							{ key: "type", value: "text_context", negate: true },
							{ key: "source", value: "about_you", negate: true },
							{ key: "type", value: "call_utterance", negate: true },
							{ key: "type", value: "call_summary", negate: true },
							{ key: "source", value: "call", negate: true },
						],
					};

					const clamp = (text: string, maxChars: number): string => {
						const trimmed = text.trim();
						if (trimmed.length <= maxChars) return trimmed;
						return `${trimmed.slice(0, maxChars)}…`;
					};

					const mergeCallAndKbContext = (callContext: string, kbContext: string): string => {
						const callBlock = callContext.trim();
						const kbBlock = kbContext.trim();
						if (!callBlock) return kbBlock;
						if (!kbBlock) return callBlock;

						const separator = "\n\n---\n\n";
						const budget = this.MAX_MEMORY_CONTEXT_CHARS;
						const remaining = budget - callBlock.length - separator.length;
						if (remaining <= 0) return clamp(callBlock, budget);
						const cappedKb =
							kbBlock.length > remaining
								? `${kbBlock.slice(0, Math.max(0, remaining - 18))}\n\n...[truncated]`
								: kbBlock;
						return `${callBlock}${separator}${cappedKb}`.trim();
					};

					const MAX_CALL_CONTEXT_CHARS = 2800;
					let callContext = "";
					if (queryHintsCall) {
						const activeSession = this.appState.callAssistManager.getActiveSession();
						if (activeSession) {
							const parts: string[] = [];
							const tail = this.appState.callAssistManager.getTranscriptTail(14).trim();
							if (tail) {
								parts.push(`Call Transcript (recent):\n${clamp(tail, 1800)}`);
							}
							try {
								const scoped = await this.supermemoryHelper.searchMemories(queryForHints, {
									limit: 6,
									threshold: 0.35,
									rerank: true,
									rewriteQuery: true,
									filters: {
										AND: [
											{ key: "source", value: "call", negate: false },
											{ key: "callId", value: activeSession.sessionId, negate: false },
										],
									},
								});
								const excerptLines: string[] = [];
								const seen = new Set<string>();
								for (const item of scoped.results) {
									const text =
										typeof item.memory === "string" ? item.memory.trim() : "";
									if (!text) continue;
									const key = text.toLowerCase();
									if (seen.has(key)) continue;
									seen.add(key);
									excerptLines.push(`- ${clamp(text, 420)}`);
									if (excerptLines.length >= 6) break;
								}
								if (excerptLines.length > 0) {
									parts.push(`Call Transcript (relevant):\n${excerptLines.join("\n")}`);
								}
							} catch (error) {
								console.warn("[ProcessingHelper] Call context scoped lookup failed:", error);
							}

							callContext = clamp(parts.join("\n\n"), MAX_CALL_CONTEXT_CHARS);
						} else {
							try {
								const callResult = await this.supermemoryHelper.searchMemories(queryForHints, {
									limit: 7,
									threshold: 0.35,
									rerank: true,
									rewriteQuery: true,
									filters: {
										AND: [{ key: "source", value: "call", negate: false }],
									},
								});
								if (callResult.results.length > 0) {
									const lines: string[] = [];
									lines.push("Call Transcript (previous):");
									for (const item of callResult.results.slice(0, 7)) {
										const text =
											typeof item.memory === "string" ? item.memory.trim() : "";
										if (!text) continue;
										lines.push(`- ${clamp(text, 420)}`);
									}
									callContext = clamp(lines.join("\n"), MAX_CALL_CONTEXT_CHARS);
								}
							} catch (error) {
								console.warn("[ProcessingHelper] Call context lookup failed:", error);
							}
						}
					}

					const attempts: Array<{
						name: string;
						options: Parameters<typeof this.supermemoryHelper.searchMemories>[1];
					}> = [
					{
						name: "fast",
						options: {
							limit: 5,
							threshold: 0.6,
							rerank: false,
							rewriteQuery: false,
							include: { documents: true, summaries: true },
							filters: kbFilters,
						},
					},
						{
							name: "expanded",
							options: {
								limit: 8,
								threshold: 0.45,
								rerank: true,
								rewriteQuery: true,
								include: { documents: true, summaries: true },
								filters: kbFilters,
							},
							},
						];

				let result:
					| Awaited<ReturnType<typeof this.supermemoryHelper.searchMemories>>
					| null = null;

				for (const attempt of attempts) {
					result = await this.supermemoryHelper.searchMemories(query, attempt.options);
					if (result?.results?.length) {
						console.log(
							`[ProcessingHelper] Memory search success (${attempt.name}): ${result.results.length} results`,
						);
						break;
					}
					console.log(`[ProcessingHelper] Memory search empty (${attempt.name})`);
				}

				const instruction =
					"Use the following knowledge base materials to answer the user's question. Prefer quoting or paraphrasing the most relevant excerpt(s) and reference the document titles. Some results include document summaries—use them when they help. If you used the knowledge base, include a short Sources section listing the document titles you relied on (do not invent sources). If the answer is not present, say you couldn't find it in the knowledge base and ask for the exact document name or a few keywords to search for.";

					if (result?.results?.length) {
						const MAX_DOC_SUMMARY_CHARS = 900;
					const MAX_EXCERPT_CHARS = 700;
					const MAX_GROUPS = 5;
					const MAX_EXCERPTS_PER_GROUP = 4;
					const MAX_SUMMARY_GROUPS = 3;

					type DocGroup = {
						key: string;
						title: string;
						summary: string;
						bestSimilarity: number | null;
						excerpts: Array<{ similarity: number | null; text: string }>;
						seen: Set<string>;
					};

					const groups = new Map<string, DocGroup>();

					for (const item of result.results) {
						const resultId = typeof item.id === "string" ? item.id : "";
						const memory = typeof item.memory === "string" ? item.memory.trim() : "";
						const context =
							typeof item.context === "string" ? item.context.trim() : "";
						const excerpt =
							context && context.length >= memory.length ? context : memory;
						if (!excerpt) continue;

						const similarity =
							typeof item.similarity === "number" && Number.isFinite(item.similarity)
								? item.similarity
								: null;

						const firstDoc =
							Array.isArray(item.documents) && item.documents.length > 0
								? item.documents[0]
								: null;

						const docId =
							firstDoc && typeof firstDoc.id === "string" && firstDoc.id.trim()
								? firstDoc.id.trim()
								: resultId || `snippet_${groups.size}`;

						const docMetadata =
							firstDoc?.metadata &&
							typeof firstDoc.metadata === "object" &&
							!Array.isArray(firstDoc.metadata)
								? (firstDoc.metadata as Record<string, unknown>)
								: null;
						const resultMetadata =
							item.metadata &&
							typeof item.metadata === "object" &&
							!Array.isArray(item.metadata)
								? (item.metadata as Record<string, unknown>)
								: null;

						const titleFromDoc =
							typeof firstDoc?.title === "string" ? firstDoc.title.trim() : "";
						const titleFromDocFilename =
							typeof docMetadata?.filename === "string"
								? docMetadata.filename.trim()
								: "";
						const titleFromResult =
							typeof item.title === "string" ? item.title.trim() : "";
						const titleFromResultFilename =
							typeof resultMetadata?.filename === "string"
								? resultMetadata.filename.trim()
								: "";

						const title =
							titleFromDoc ||
							titleFromDocFilename ||
							titleFromResult ||
							titleFromResultFilename ||
							"Knowledge snippet";

						const summary =
							typeof firstDoc?.summary === "string" ? firstDoc.summary.trim() : "";

						const existing = groups.get(docId);
						const group: DocGroup =
							existing ?? {
								key: docId,
								title,
								summary,
								bestSimilarity: similarity,
								excerpts: [],
								seen: new Set<string>(),
							};

						if (!existing) groups.set(docId, group);
						if (!group.title && title) group.title = title;
						if (!group.summary && summary) group.summary = summary;
						if (similarity !== null) {
							group.bestSimilarity =
								group.bestSimilarity === null
									? similarity
									: Math.max(group.bestSimilarity, similarity);
						}

						const clampedExcerpt = clamp(excerpt, MAX_EXCERPT_CHARS);
						if (group.seen.has(clampedExcerpt)) continue;
						group.seen.add(clampedExcerpt);
						group.excerpts.push({ similarity, text: clampedExcerpt });
					}

					const sortedGroups = Array.from(groups.values()).sort((a, b) => {
						const aScore = a.bestSimilarity ?? -1;
						const bScore = b.bestSimilarity ?? -1;
						return bScore - aScore;
					});

					let summariesIncluded = 0;
					const blocks: string[] = [];
					for (const group of sortedGroups.slice(0, MAX_GROUPS)) {
						const headerParts = [group.title];
						if (group.bestSimilarity !== null) {
							headerParts.push(`best ${group.bestSimilarity.toFixed(2)}`);
						}
						const lines: string[] = [];
						lines.push(`### ${headerParts.join(" — ")}`);
						if (group.summary && summariesIncluded < MAX_SUMMARY_GROUPS) {
							summariesIncluded += 1;
							lines.push(`Summary: ${clamp(group.summary, MAX_DOC_SUMMARY_CHARS)}`);
						}
						for (const excerpt of group.excerpts.slice(0, MAX_EXCERPTS_PER_GROUP)) {
							const sim =
								excerpt.similarity !== null
									? excerpt.similarity.toFixed(2)
									: "";
							lines.push(`${sim ? `- (${sim}) ` : "- "}${excerpt.text}`);
						}
						blocks.push(lines.join("\n"));
					}

					const memoryContext = blocks.join("\n\n");

				const combinedMemory = `${instruction}\n\n${memoryContext}`.trim();
				const cappedMemory =
					combinedMemory.length > this.MAX_MEMORY_CONTEXT_CHARS
						? `${combinedMemory.slice(0, this.MAX_MEMORY_CONTEXT_CHARS)}\n\n...[truncated]`
						: combinedMemory;

					const searchableQuery = query.trim();
					const queryLooksSearchable =
						searchableQuery.length >= 4 && /[a-z0-9]/i.test(searchableQuery);
					const queryHintsDocuments =
						/\b(document|documents|doc|pdf|file|files|upload|uploaded|knowledge base|kb|policy|contract|agreement|spec|specification|notes)\b/i.test(
							searchableQuery,
						);

					const bestSimilarity =
						typeof result.results[0]?.similarity === "number" &&
						Number.isFinite(result.results[0].similarity)
							? result.results[0].similarity
							: null;
					const hasDocSummaries = result.results.some(
						(r) =>
							Array.isArray(r.documents) &&
							typeof r.documents?.[0]?.summary === "string" &&
							!!r.documents[0].summary?.trim(),
					);
					const hasUploadedOrIntegratedDocs =
						hasUploadedDocs || hasDocSummaries || queryHintsDocuments;

					let usedDocumentsSearch = false;
					let cappedPreferred = cappedMemory;

						if (
							queryLooksSearchable &&
							hasUploadedOrIntegratedDocs &&
							(queryHintsDocuments ||
								hasUploadedDocs ||
								hasDocSummaries ||
								bestSimilarity === null ||
								bestSimilarity < 0.82)
						) {
							try {
								const docAttempts: Array<{
									name: string;
									options: Parameters<typeof this.supermemoryHelper.searchDocuments>[1];
								}> = [
									{
										name: "docs",
										options: {
											limit: 4,
											documentThreshold: 0.55,
											chunkThreshold: 0.65,
											rewriteQuery: true,
											rerank: true,
											includeSummary: true,
											onlyMatchingChunks: true,
											filters: kbFilters,
										},
									},
									{
										name: "docs-wide",
										options: {
											limit: 4,
											documentThreshold: 0.42,
											chunkThreshold: 0.52,
											rewriteQuery: true,
											rerank: true,
											includeSummary: true,
											onlyMatchingChunks: true,
											filters: kbFilters,
										},
									},
								];

							let docsResult:
								| Awaited<ReturnType<typeof this.supermemoryHelper.searchDocuments>>
								| null = null;
							for (const attempt of docAttempts) {
								docsResult = await this.supermemoryHelper.searchDocuments(
									searchableQuery,
									attempt.options,
								);
								const filtered = docsResult.results.filter((doc) => {
									if (aboutYouIds.has(doc.documentId)) return false;
									const meta =
										doc.metadata &&
										typeof doc.metadata === "object" &&
										!Array.isArray(doc.metadata)
											? (doc.metadata as Record<string, unknown>)
											: {};
									const source = typeof meta.source === "string" ? meta.source : "";
									const type = typeof meta.type === "string" ? meta.type : "";
									if (source === "about_you" || type === "about_you") return false;
									if (source === "call" || type === "call_utterance" || type === "call_summary") {
										return false;
									}
									if (type === "text_context") return false;
									return true;
								});
								docsResult = { ...docsResult, results: filtered };

								if (docsResult.results.length > 0) {
									console.log(
										`[ProcessingHelper] Document search success (${attempt.name}): ${docsResult.results.length} results`,
									);
									break;
								}
								console.log(
									`[ProcessingHelper] Document search empty (${attempt.name})`,
								);
							}

							if (docsResult?.results?.length) {
								const MAX_DOCS = 4;
								const MAX_CHUNKS_PER_DOC = 4;
								const MAX_DOC_SUMMARY_CHARS = 900;
								const MAX_CHUNK_CHARS = 900;

								const clamp = (text: string, maxChars: number): string => {
									const trimmed = text.trim();
									if (trimmed.length <= maxChars) return trimmed;
									return `${trimmed.slice(0, maxChars)}…`;
								};

								const blocks: string[] = [];
								for (const doc of docsResult.results.slice(0, MAX_DOCS)) {
									const meta =
										doc.metadata &&
										typeof doc.metadata === "object" &&
										!Array.isArray(doc.metadata)
											? (doc.metadata as Record<string, unknown>)
											: {};
									const filename =
										typeof meta.filename === "string" ? meta.filename.trim() : "";
									const title =
										(typeof doc.title === "string" && doc.title.trim()) ||
										filename ||
										doc.documentId;
									const score =
										typeof doc.score === "number" && Number.isFinite(doc.score)
											? doc.score
											: null;

									const lines: string[] = [];
									lines.push(
										`### ${[title, score !== null ? `score ${score.toFixed(2)}` : ""]
											.filter(Boolean)
											.join(" — ")}`,
									);

									const summary =
										typeof doc.summary === "string" ? doc.summary.trim() : "";
									if (summary) {
										lines.push(`Summary: ${clamp(summary, MAX_DOC_SUMMARY_CHARS)}`);
									}

									const chunks = Array.isArray(doc.chunks) ? doc.chunks : [];
									for (const chunk of chunks.slice(0, MAX_CHUNKS_PER_DOC)) {
										const content =
											typeof chunk.content === "string" ? chunk.content.trim() : "";
										if (!content) continue;
										const chunkScore =
											typeof chunk.score === "number" &&
											Number.isFinite(chunk.score)
												? chunk.score
												: null;
										lines.push(
											`${chunkScore !== null ? `- (${chunkScore.toFixed(2)}) ` : "- "}${clamp(content, MAX_CHUNK_CHARS)}`,
										);
									}

									blocks.push(lines.join("\n"));
								}

								const docsContext = blocks.join("\n\n").trim();
								const combinedDocs = `${instruction}\n\n${docsContext}`.trim();
								const cappedDocs =
									combinedDocs.length > this.MAX_MEMORY_CONTEXT_CHARS
										? `${combinedDocs.slice(0, this.MAX_MEMORY_CONTEXT_CHARS)}\n\n...[truncated]`
										: combinedDocs;

								cappedPreferred =
									hasUploadedDocs || queryHintsDocuments
										? cappedDocs
										: bestSimilarity === null || bestSimilarity < 0.68
											? cappedDocs
											: cappedMemory;
								usedDocumentsSearch = cappedPreferred === cappedDocs;

								if (
									usedDocumentsSearch &&
									docsContext &&
									cappedPreferred.length < this.MAX_MEMORY_CONTEXT_CHARS * 0.7 &&
									memoryContext
								) {
									const extraBudget = this.MAX_MEMORY_CONTEXT_CHARS - cappedPreferred.length;
									const extra = memoryContext.slice(0, Math.max(0, extraBudget - 80));
									if (extra.trim()) {
										cappedPreferred = `${cappedPreferred}\n\n---\n\nAdditional excerpts:\n${extra}`.trim();
									}
								}
							}
						} catch (error) {
							console.warn(
								"[ProcessingHelper] Document search fallback failed:",
								error,
							);
						}
					}

					this.llmHelper.setMemoryContext(
						mergeCallAndKbContext(callContext, cappedPreferred),
					);
					console.log(
						`[ProcessingHelper] Memory context set from ${result.results.length} results (${combinedMemory.length} chars)${usedDocumentsSearch ? " + docs search" : ""}`,
					);
				} else {
					const searchableQuery = query.trim();
					const queryLooksSearchable =
						searchableQuery.length >= 4 && /[a-z0-9]/i.test(searchableQuery);

						if (queryLooksSearchable) {
							try {
								const docAttempts: Array<{
									name: string;
									options: Parameters<typeof this.supermemoryHelper.searchDocuments>[1];
								}> = [
									{
										name: "docs",
										options: {
											limit: 4,
											documentThreshold: 0.55,
											chunkThreshold: 0.65,
											rewriteQuery: true,
											rerank: true,
											includeSummary: true,
											onlyMatchingChunks: true,
											filters: kbFilters,
										},
									},
									{
										name: "docs-wide",
										options: {
											limit: 4,
											documentThreshold: 0.42,
											chunkThreshold: 0.52,
											rewriteQuery: true,
											rerank: true,
											includeSummary: true,
											onlyMatchingChunks: true,
											filters: kbFilters,
										},
									},
								];

								let filtered: Array<
									Awaited<
										ReturnType<typeof this.supermemoryHelper.searchDocuments>
									>["results"][number]
								> = [];
								for (const attempt of docAttempts) {
									const docsResult = await this.supermemoryHelper.searchDocuments(
										searchableQuery,
										attempt.options,
									);
									filtered = docsResult.results.filter((doc) => {
									if (aboutYouIds.has(doc.documentId)) return false;
									const meta =
										doc.metadata &&
										typeof doc.metadata === "object" &&
									!Array.isArray(doc.metadata)
										? (doc.metadata as Record<string, unknown>)
										: {};
								const source = typeof meta.source === "string" ? meta.source : "";
								const type = typeof meta.type === "string" ? meta.type : "";
								if (source === "about_you" || type === "about_you") return false;
								if (source === "call" || type === "call_utterance" || type === "call_summary") {
									return false;
								}
									if (type === "text_context") return false;
									return true;
								});
									if (filtered.length > 0) {
										console.log(
											`[ProcessingHelper] Document search success (${attempt.name}): ${filtered.length} results`,
										);
										break;
									}
									console.log(
										`[ProcessingHelper] Document search empty (${attempt.name})`,
									);
								}

								if (filtered.length > 0) {
								const MAX_DOCS = 4;
								const MAX_CHUNKS_PER_DOC = 4;
								const MAX_DOC_SUMMARY_CHARS = 900;
								const MAX_CHUNK_CHARS = 900;

								const clamp = (text: string, maxChars: number): string => {
									const trimmed = text.trim();
									if (trimmed.length <= maxChars) return trimmed;
									return `${trimmed.slice(0, maxChars)}…`;
								};

								const blocks: string[] = [];
								for (const doc of filtered.slice(0, MAX_DOCS)) {
									const meta =
										doc.metadata &&
										typeof doc.metadata === "object" &&
										!Array.isArray(doc.metadata)
											? (doc.metadata as Record<string, unknown>)
											: {};
									const filename =
										typeof meta.filename === "string" ? meta.filename.trim() : "";
									const title =
										(typeof doc.title === "string" && doc.title.trim()) ||
										filename ||
										doc.documentId;
									const score =
										typeof doc.score === "number" && Number.isFinite(doc.score)
											? doc.score
											: null;
									const lines: string[] = [];
									lines.push(
										`### ${[title, score !== null ? `score ${score.toFixed(2)}` : ""]
											.filter(Boolean)
											.join(" — ")}`,
									);

									const summary =
										typeof doc.summary === "string" ? doc.summary.trim() : "";
									if (summary) {
										lines.push(`Summary: ${clamp(summary, MAX_DOC_SUMMARY_CHARS)}`);
									}
									const chunks = Array.isArray(doc.chunks) ? doc.chunks : [];
									for (const chunk of chunks.slice(0, MAX_CHUNKS_PER_DOC)) {
										const content =
											typeof chunk.content === "string" ? chunk.content.trim() : "";
										if (!content) continue;
										const chunkScore =
											typeof chunk.score === "number" &&
											Number.isFinite(chunk.score)
												? chunk.score
												: null;
										lines.push(
											`${chunkScore !== null ? `- (${chunkScore.toFixed(2)}) ` : "- "}${clamp(content, MAX_CHUNK_CHARS)}`,
										);
									}
									blocks.push(lines.join("\n"));
								}

								const docsContext = blocks.join("\n\n").trim();
								const combinedDocs = `${instruction}\n\n${docsContext}`.trim();
								const cappedDocs =
									combinedDocs.length > this.MAX_MEMORY_CONTEXT_CHARS
										? `${combinedDocs.slice(0, this.MAX_MEMORY_CONTEXT_CHARS)}\n\n...[truncated]`
										: combinedDocs;
								this.llmHelper.setMemoryContext(
									mergeCallAndKbContext(callContext, cappedDocs),
								);
								console.log(
									`[ProcessingHelper] Memory context set from document search fallback (${filtered.length} docs)`,
								);
								return;
							}
						} catch (error) {
							console.warn(
								"[ProcessingHelper] Document search fallback (no mem hits) failed:",
								error,
							);
						}
					}

					try {
						const processing = await this.supermemoryHelper.getProcessingDocuments();
						const docNameById = new Map(
							uploadedDocs.map((d) => [d.id, d.name] as const),
						);

						const processingForContainer = processing.documents.filter((doc) => {
							if (Array.isArray(doc.containerTags)) {
								return (
									!aboutYouIds.has(doc.id) &&
									doc.containerTags.includes(containerTag)
								);
							}
							if (aboutYouIds.has(doc.id)) return false;
							return hasUploadedDocs ? docNameById.has(doc.id) : false;
						});

						if (processingForContainer.length > 0) {
							const names = processingForContainer
								.map((doc) => docNameById.get(doc.id) || doc.title || doc.id)
								.slice(0, 5)
								.join(", ");
							const extra =
								processingForContainer.length > 5
									? ` (+${processingForContainer.length - 5} more)`
									: "";

							this.llmHelper.setMemoryContext(
								mergeCallAndKbContext(
									callContext,
									`No relevant memories were found yet. Your knowledge base may still be processing, so it might not be searchable right now. Processing: ${names}${extra}. Ask again in a minute, or include specific keywords from the document.`,
								),
							);
								console.log(
									`[ProcessingHelper] Documents still processing (${processingForContainer.length}); memory context set to processing notice`,
								);
								return;
							}
						} catch (error) {
						console.warn(
							"[ProcessingHelper] Unable to check processing documents:",
							error,
						);
					}

					try {
						const listed = await this.supermemoryHelper.listDocuments({
							limit: 20,
							page: 1,
							order: "desc",
							sort: "updatedAt",
						});
						const readyDocs = listed.memories.filter((doc) => {
							if (!doc || doc.status !== "done") return false;
							if (aboutYouIds.has(doc.id)) return false;
							const meta = (doc.metadata ?? {}) as Record<string, unknown>;
							const source = typeof meta.source === "string" ? meta.source : "";
							const type = typeof meta.type === "string" ? meta.type : "";
							if (source === "about_you" || type === "about_you") return false;
							if (source === "call" || type === "call_utterance" || type === "call_summary") {
								return false;
							}
							if (type === "text_context") return false;
							return true;
						});
						if (readyDocs.length > 0) {
							const docLabels = readyDocs
								.slice(0, 8)
								.map((doc) => {
									const title = typeof doc.title === "string" ? doc.title.trim() : "";
									if (title) return title;
									const meta = (doc.metadata ?? {}) as Record<string, unknown>;
									const filename =
										typeof meta.filename === "string" ? meta.filename : "";
									return filename || doc.id;
								})
								.filter(Boolean)
								.join(", ");
							const extra = readyDocs.length > 8 ? ` (+${readyDocs.length - 8} more)` : "";

							this.llmHelper.setMemoryContext(
								mergeCallAndKbContext(
									callContext,
									`No directly relevant snippets were found for this question. Available knowledge base documents: ${docLabels}${extra}. Ask the user which document to use, or ask them to provide 3–5 keywords or an exact quote from the document to search.`,
								),
							);
							console.log(
								`[ProcessingHelper] No matches; provided ready-doc list (${readyDocs.length}) to guide follow-up`,
							);
							return;
						}
					} catch (error) {
						console.warn(
							"[ProcessingHelper] Unable to list documents for fallback:",
							error,
						);
					}

					this.llmHelper.setMemoryContext(mergeCallAndKbContext(callContext, ""));
					console.log("[ProcessingHelper] No relevant memories found");
				}
			} catch (error) {
			console.error("[ProcessingHelper] Error preparing memory context:", error);
			this.llmHelper.setMemoryContext("");
			// Don't throw - continue without memory context
		}
	}

	private formatProfileForPrompt(profile: { static: string[]; dynamic: string[] }): string {
		const staticItems = (profile.static || []).filter(Boolean).slice(0, 12);
		const dynamicItems = (profile.dynamic || []).filter(Boolean).slice(0, 12);
		if (staticItems.length === 0 && dynamicItems.length === 0) return "";

		const lines: string[] = [];
		lines.push("User Preferences (from profile):");
		if (staticItems.length > 0) {
			lines.push("Static:");
			for (const item of staticItems) lines.push(`- ${item}`);
		}
		if (dynamicItems.length > 0) {
			lines.push("Dynamic:");
			for (const item of dynamicItems) lines.push(`- ${item}`);
		}
		return lines.join("\n");
	}

	private syncAdditionalContextToLlm(): void {
		if (!this.supermemoryHelper) {
			this.llmHelper.setAdditionalContext("");
			return;
		}

		const base = this.supermemoryHelper.getAdditionalContext();
		const profileBlock = this.cachedProfile
			? this.formatProfileForPrompt(this.cachedProfile)
			: "";
		const combined = [base, profileBlock].filter(Boolean).join("\n\n---\n\n");
		this.llmHelper.setAdditionalContext(combined);
	}

	public getLLMHelper() {
		return this.llmHelper;
	}

	public getSupermemoryHelper() {
		return this.supermemoryHelper;
	}

	public getSupermemoryContainerTag(): string | null {
		return this.supermemoryHelper?.getDefaultContainerTag() ?? null;
	}

	// Customization methods

	public getCustomizeConfig(): CustomizeConfig | null {
		return this.supermemoryHelper?.getConfig() || null;
	}

	public getRolePresets(): Record<string, string> {
		return ROLE_PRESETS;
	}

	public setRole(role: string, customText?: string): boolean {
		if (!this.supermemoryHelper) {
			console.warn("[ProcessingHelper] Supermemory not initialized, cannot set role");
			return false;
		}
		this.supermemoryHelper.setRole(role, customText);
		// Sync to LLMHelper
		const effectivePrompt = this.supermemoryHelper.getEffectiveSystemPrompt();
		this.llmHelper.setCustomSystemPrompt(effectivePrompt);
		return true;
	}

	public setTextContext(text: string): boolean {
		if (!this.supermemoryHelper) {
			console.warn("[ProcessingHelper] Supermemory not initialized, cannot set text context");
			return false;
		}
		this.supermemoryHelper.setTextContext(text);
		this.syncAdditionalContextToLlm();
		return true;
	}

	public setUserFacts(facts: string[]): boolean {
		if (!this.supermemoryHelper) {
			console.warn("[ProcessingHelper] Supermemory not initialized, cannot set user facts");
			return false;
		}
		this.supermemoryHelper.setUserFacts(facts);
		this.syncAdditionalContextToLlm();
		return true;
	}

	public async uploadDocument(
		filePath: string,
	): Promise<{ id: string; status: string } | null> {
		if (!this.supermemoryHelper) {
			console.error("[ProcessingHelper] Supermemory not initialized");
			return null;
		}
		try {
			const result = await this.supermemoryHelper.uploadFileMemory(filePath);
			return result;
		} catch (error) {
			console.error("[ProcessingHelper] Error uploading document:", error);
			throw error;
		}
	}

	public async uploadDocumentData(
		fileName: string,
		data: Uint8Array,
		mimeType?: string,
	): Promise<{ id: string; status: string } | null> {
		if (!this.supermemoryHelper) {
			console.error("[ProcessingHelper] Supermemory not initialized");
			return null;
		}
		try {
			const result = await this.supermemoryHelper.uploadFileMemoryData(
				fileName,
				data,
				mimeType,
			);
			return result;
		} catch (error) {
			console.error("[ProcessingHelper] Error uploading document (bytes):", error);
			throw error;
		}
	}

	public async addTextMemory(
		content: string,
	): Promise<{ id: string; status: string } | null> {
		if (!this.supermemoryHelper) {
			console.error("[ProcessingHelper] Supermemory not initialized");
			return null;
		}
		try {
			const result = await this.supermemoryHelper.addTextMemory(content);
			return result;
		} catch (error) {
			console.error("[ProcessingHelper] Error adding text memory:", error);
			throw error;
		}
	}

	public async searchMemories(
		query: string,
	): Promise<{ results: unknown[]; total: number } | null> {
		if (!this.supermemoryHelper) {
			this.llmHelper.setMemoryContext("");
			return null;
		}
		try {
			const result = await this.supermemoryHelper.searchMemories(query);
			// Update LLMHelper with memory context
			if (result.results.length > 0) {
				const memoryContext = result.results
					.map((r: { memory?: string }) => r.memory || "")
					.filter(Boolean)
					.join("\n\n");
				const capped =
					memoryContext.length > this.MAX_MEMORY_CONTEXT_CHARS
						? `${memoryContext.slice(0, this.MAX_MEMORY_CONTEXT_CHARS)}\n\n...[truncated]`
						: memoryContext;
				this.llmHelper.setMemoryContext(capped);
			} else {
				this.llmHelper.setMemoryContext("");
			}
			return result;
		} catch (error) {
			console.error("[ProcessingHelper] Error searching memories:", error);
			this.llmHelper.setMemoryContext("");
			return null;
		}
	}

	public async deleteDocument(documentId: string): Promise<boolean> {
		if (!this.supermemoryHelper) {
			return false;
		}
		await this.supermemoryHelper.deleteMemory(documentId);
		return true;
	}

	public getDocuments(): StoredDocument[] {
		return this.supermemoryHelper?.getDocuments() || [];
	}

	public async getUserProfile(forceRefresh = false): Promise<{
		static: string[];
		dynamic: string[];
	} | null> {
		if (!this.supermemoryHelper) return null;

		if (
			!forceRefresh &&
			this.cachedProfile &&
			Date.now() - this.cachedProfileAt < this.PROFILE_CACHE_MS
		) {
			return this.cachedProfile;
		}

		try {
			const result = await this.supermemoryHelper.getProfile();
			this.cachedProfile = result.profile;
			this.cachedProfileAt = Date.now();
			this.syncAdditionalContextToLlm();
			return result.profile;
		} catch (error) {
			console.error("[ProcessingHelper] Error getting user profile:", error);
			return this.cachedProfile;
		}
	}

	// ==================== Knowledge Base / Connections ====================

		public async getKnowledgeBaseOverview(options?: {
			list?: ListDocumentsOptions;
		}): Promise<
		| {
				ready: ListedDocument[];
				processing: Array<{
					id: string;
					status: string;
					title?: string | null;
				}>;
				list: ListDocumentsResponse;
		  }
		| null
		> {
			if (!this.supermemoryHelper) return null;

			const containerTag = this.supermemoryHelper.getDefaultContainerTag();
			const aboutYouIds = new Set(
				this.supermemoryHelper
					.getAboutYouEntries()
					.map((entry) => entry.supermemoryId)
					.filter((id): id is string => typeof id === "string" && id.trim().length > 0),
			);
			const [list, processing] = await Promise.all([
				this.supermemoryHelper.listDocuments(options?.list),
				this.supermemoryHelper.getProcessingDocuments(),
			]);

				const ready = list.memories.filter((doc) => {
					if (!doc || doc.status !== "done") return false;
					if (aboutYouIds.has(doc.id)) return false;
					const meta = (doc.metadata ?? {}) as Record<string, unknown>;
					const source = typeof meta.source === "string" ? meta.source : "";
					const type = typeof meta.type === "string" ? meta.type : "";
					if (source === "about_you" || type === "about_you") return false;
					if (source === "call" || type === "call_utterance" || type === "call_summary") {
						return false;
					}
					if (type === "text_context") return false;
					return true;
				});
			const processingForContainer = processing.documents
				.filter(
					(doc) =>
						!aboutYouIds.has(doc.id) &&
						Array.isArray(doc.containerTags) &&
						doc.containerTags.includes(containerTag),
				)
				.map((doc) => ({
					id: doc.id,
					status: doc.status,
					title: doc.title ?? null,
			}));

		return {
			ready,
			processing: processingForContainer,
			list,
		};
	}

	public async getDocumentStatus(documentId: string): Promise<{
		id: string;
		status: string;
		title?: string | null;
	} | null> {
		if (!this.supermemoryHelper) return null;
		const doc = await this.supermemoryHelper.getDocument(documentId);
		return {
			id: doc.id,
			status: typeof doc.status === "string" ? doc.status : "unknown",
			title: doc.title ?? null,
		};
	}

	public async addKnowledgeUrl(params: {
		url: string;
		title?: string;
	}): Promise<{ id: string; status: string } | null> {
		if (!this.supermemoryHelper) return null;
		const url = params.url.trim();
		if (!url) throw new Error("URL is required");

		const customId = this.supermemoryHelper.createStableCustomId("kb_url", url);
		return await this.supermemoryHelper.addMemory({
			content: url,
			customId,
			metadata: {
				type: "knowledge_url",
				source: "url",
				...(params.title ? { title: params.title } : {}),
			},
		});
	}

	public async addKnowledgeText(params: {
		title: string;
		content: string;
	}): Promise<{ id: string; status: string } | null> {
		if (!this.supermemoryHelper) return null;
		const title = params.title.trim();
		const content = params.content.trim();
		if (!title) throw new Error("Title is required");
		if (!content) throw new Error("Content is required");

		const customId = this.supermemoryHelper.createStableCustomId(
			"kb_note",
			title.toLowerCase(),
		);
		return await this.supermemoryHelper.addMemory({
			content,
			customId,
			metadata: {
				type: "knowledge_note",
				source: "note",
				title,
			},
		});
	}

	public async listConnections(): Promise<SupermemoryConnection[] | null> {
		if (!this.supermemoryHelper) return null;
		return await this.supermemoryHelper.listConnections();
	}

	public async createConnection(
		provider: SupermemoryProvider,
		params?: {
			documentLimit?: number;
			metadata?: Record<string, string | number | boolean>;
			redirectUrl?: string;
		},
	): Promise<CreateConnectionResponse | null> {
		if (!this.supermemoryHelper) return null;
		return await this.supermemoryHelper.createConnection(provider, params);
	}

	public async syncConnection(
		provider: SupermemoryProvider,
	): Promise<{ message: string } | null> {
		if (!this.supermemoryHelper) return null;
		return await this.supermemoryHelper.syncConnection(provider);
	}

	public async deleteConnection(
		provider: SupermemoryProvider,
	): Promise<DeleteConnectionResponse | null> {
		if (!this.supermemoryHelper) return null;
		return await this.supermemoryHelper.deleteConnection(provider);
	}

	public async listConnectionDocuments(
		provider: SupermemoryProvider,
	): Promise<ConnectionDocument[] | null> {
		if (!this.supermemoryHelper) return null;
		return await this.supermemoryHelper.listConnectionDocuments(provider);
	}

	public resetCustomization(): void {
		this.llmHelper.resetCustomization();
		if (this.supermemoryHelper) {
			this.supermemoryHelper.reset();
			// Re-apply persisted About You context (preserved by reset()).
			const effectivePrompt = this.supermemoryHelper.getEffectiveSystemPrompt();
			this.llmHelper.setCustomSystemPrompt(effectivePrompt);
			this.syncAdditionalContextToLlm();
		}
	}

	// ==================== About You Methods ====================

	public getAboutYouEntries(): AboutYouEntry[] {
		return this.supermemoryHelper?.getAboutYouEntries() || [];
	}

	public async addAboutYouTextEntry(
		title: string,
		content: string,
	): Promise<AboutYouEntry | null> {
		if (!this.supermemoryHelper) {
			console.error("[ProcessingHelper] Supermemory not initialized");
			return null;
		}
		try {
			const entry = await this.supermemoryHelper.addAboutYouTextEntry(title, content);
			this.syncAdditionalContextToLlm();
			return entry;
		} catch (error) {
			console.error("[ProcessingHelper] Error adding About You text entry:", error);
			throw error;
		}
	}

	public async addAboutYouFileEntry(
		title: string,
		filePath: string,
	): Promise<AboutYouEntry | null> {
		if (!this.supermemoryHelper) {
			console.error("[ProcessingHelper] Supermemory not initialized");
			return null;
		}
		try {
			const entry = await this.supermemoryHelper.addAboutYouFileEntry(title, filePath);
			this.syncAdditionalContextToLlm();
			return entry;
		} catch (error) {
			console.error("[ProcessingHelper] Error adding About You file entry:", error);
			throw error;
		}
	}

	public async addAboutYouFileEntryData(
		title: string,
		fileName: string,
		data: Uint8Array,
		mimeType?: string,
	): Promise<AboutYouEntry | null> {
		if (!this.supermemoryHelper) {
			console.error("[ProcessingHelper] Supermemory not initialized");
			return null;
		}
		try {
			const entry = await this.supermemoryHelper.addAboutYouFileEntryData(
				title,
				fileName,
				data,
				mimeType,
			);
			this.syncAdditionalContextToLlm();
			return entry;
		} catch (error) {
			console.error(
				"[ProcessingHelper] Error adding About You file entry (bytes):",
				error,
			);
			throw error;
		}
	}

	public async updateAboutYouEntry(
		id: string,
		title: string,
		content: string,
	): Promise<AboutYouEntry | null> {
		if (!this.supermemoryHelper) {
			console.error("[ProcessingHelper] Supermemory not initialized");
			return null;
		}
		try {
			const entry = await this.supermemoryHelper.updateAboutYouEntry(id, title, content);
			this.syncAdditionalContextToLlm();
			return entry;
		} catch (error) {
			console.error("[ProcessingHelper] Error updating About You entry:", error);
			throw error;
		}
	}

	public async deleteAboutYouEntry(id: string): Promise<boolean> {
		if (!this.supermemoryHelper) {
			return false;
		}
		await this.supermemoryHelper.deleteAboutYouEntry(id);
		this.syncAdditionalContextToLlm();
		return true;
	}

	// Full reset - deletes all Supermemory data and resets all customization
	public async fullResetCustomization(): Promise<void> {
		try {
			if (this.supermemoryHelper) {
				await this.supermemoryHelper.fullReset();
			}
		} finally {
			// Always remove local persisted customization data, even if Supermemory isn't configured.
			await this.deleteLocalCustomizationFiles();
			this.llmHelper.resetCustomization();
			this.resetConversation();
			this.cachedProfile = null;
			this.cachedProfileAt = 0;
			console.log("[ProcessingHelper] Full reset completed");
		}
	}

	private async deleteLocalCustomizationFiles(): Promise<void> {
		try {
			const userData = app.getPath("userData");
			const files = [
				path.join(userData, "about-you.json"),
				path.join(userData, "customize-config.json"),
			];
			for (const filePath of files) {
				try {
					await fs.promises.unlink(filePath);
				} catch (error: unknown) {
					const code = (error as { code?: string } | null)?.code;
					if (code !== "ENOENT") {
						console.warn(
							`[ProcessingHelper] Failed to delete local file: ${filePath}`,
							error,
						);
					}
				}
			}
		} catch (error) {
			console.warn(
				"[ProcessingHelper] Failed to delete local customization files:",
				error,
			);
		}
	}
}
