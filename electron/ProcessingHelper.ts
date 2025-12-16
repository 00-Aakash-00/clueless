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
} from "./SupermemoryHelper";
import type { AppState } from "./main";

dotenv.config();

type TextModel = "openai/gpt-oss-20b" | "openai/gpt-oss-120b";

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

	constructor(appState: AppState) {
		this.appState = appState;

		// Get Groq API key from environment
		const apiKey = process.env.GROQ_API_KEY;
		if (!apiKey) {
			throw new Error("GROQ_API_KEY not found in environment variables");
		}

		// Get text model from environment (default to gpt-oss-20b)
		const textModel = (process.env.GROQ_TEXT_MODEL ||
			"openai/gpt-oss-20b") as TextModel;

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

			// Sync initial context to LLMHelper (persisted About You data)
			const additionalContext = this.supermemoryHelper.getAdditionalContext();
			if (additionalContext) {
				this.llmHelper.setAdditionalContext(additionalContext);
				console.log("[ProcessingHelper] Initial context synced to LLM");
			}
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

	public async chat(message: string): Promise<string> {
		const trimmed = message.trim();
		if (!trimmed) return "";

		await this.prepareMemoryContext(trimmed);

		const history = this.chatHistory.map((m) => ({
			role: m.role,
			content: m.content,
		}));

		const response = await this.llmHelper.chat(trimmed, history);
		this.addToChatHistory("user", trimmed);
		this.addToChatHistory("assistant", response);
		return response;
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
			console.log(`[ProcessingHelper] Searching memories for: "${query.substring(0, 50)}..."`);
			const result = await this.supermemoryHelper.searchMemories(query);
			if (result?.results?.length > 0) {
				const memoryContext = result.results
					.map((r: { memory?: string }) => r.memory || "")
					.filter(Boolean)
					.join("\n\n");
				const capped =
					memoryContext.length > this.MAX_MEMORY_CONTEXT_CHARS
						? `${memoryContext.slice(0, this.MAX_MEMORY_CONTEXT_CHARS)}\n\n...[truncated]`
						: memoryContext;
				this.llmHelper.setMemoryContext(capped);
				console.log(`[ProcessingHelper] Memory context set from ${result.results.length} results (${memoryContext.length} chars)`);
			} else {
				this.llmHelper.setMemoryContext("");
				console.log("[ProcessingHelper] No relevant memories found");
			}
		} catch (error) {
			console.error("[ProcessingHelper] Error preparing memory context:", error);
			this.llmHelper.setMemoryContext("");
			// Don't throw - continue without memory context
		}
	}

	public getLLMHelper() {
		return this.llmHelper;
	}

	public getSupermemoryHelper() {
		return this.supermemoryHelper;
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
		// Sync to LLMHelper
		const additionalContext = this.supermemoryHelper.getAdditionalContext();
		this.llmHelper.setAdditionalContext(additionalContext);
		return true;
	}

	public setUserFacts(facts: string[]): boolean {
		if (!this.supermemoryHelper) {
			console.warn("[ProcessingHelper] Supermemory not initialized, cannot set user facts");
			return false;
		}
		this.supermemoryHelper.setUserFacts(facts);
		// Sync to LLMHelper
		const additionalContext = this.supermemoryHelper.getAdditionalContext();
		this.llmHelper.setAdditionalContext(additionalContext);
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
		try {
			await this.supermemoryHelper.deleteMemory(documentId);
			return true;
		} catch (error) {
			console.error("[ProcessingHelper] Error deleting document:", error);
			return false;
		}
	}

	public getDocuments(): StoredDocument[] {
		return this.supermemoryHelper?.getDocuments() || [];
	}

	public async getUserProfile(): Promise<{
		static: string[];
		dynamic: string[];
	} | null> {
		if (!this.supermemoryHelper) {
			return null;
		}
		try {
			const result = await this.supermemoryHelper.getProfile();
			return result.profile;
		} catch (error) {
			console.error("[ProcessingHelper] Error getting user profile:", error);
			return null;
		}
	}

	public resetCustomization(): void {
		this.llmHelper.resetCustomization();
		if (this.supermemoryHelper) {
			this.supermemoryHelper.reset();
			// Re-apply persisted About You context (preserved by reset()).
			const effectivePrompt = this.supermemoryHelper.getEffectiveSystemPrompt();
			this.llmHelper.setCustomSystemPrompt(effectivePrompt);
			this.llmHelper.setAdditionalContext(
				this.supermemoryHelper.getAdditionalContext(),
			);
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
			// Sync to LLMHelper
			const additionalContext = this.supermemoryHelper.getAdditionalContext();
			this.llmHelper.setAdditionalContext(additionalContext);
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
			// Sync to LLMHelper
			const additionalContext = this.supermemoryHelper.getAdditionalContext();
			this.llmHelper.setAdditionalContext(additionalContext);
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
			// Sync to LLMHelper
			const additionalContext = this.supermemoryHelper.getAdditionalContext();
			this.llmHelper.setAdditionalContext(additionalContext);
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
			// Sync to LLMHelper
			const additionalContext = this.supermemoryHelper.getAdditionalContext();
			this.llmHelper.setAdditionalContext(additionalContext);
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
		try {
			await this.supermemoryHelper.deleteAboutYouEntry(id);
			// Sync to LLMHelper
			const additionalContext = this.supermemoryHelper.getAdditionalContext();
			this.llmHelper.setAdditionalContext(additionalContext);
			return true;
		} catch (error) {
			console.error("[ProcessingHelper] Error deleting About You entry:", error);
			return false;
		}
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
