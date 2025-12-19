// ipcHandlers.ts

import { app, ipcMain, shell } from "electron";
import nodePath from "node:path";
import type { AppState } from "./main";

export function initializeIpcHandlers(appState: AppState): void {
	const PERSONALIZATION_UNAVAILABLE =
		"Personalization unavailable (no Supermemory API key)";
	const CONNECTION_PROVIDERS = new Set([
		"notion",
		"google-drive",
		"onedrive",
	]);

	const coerceToUint8Array = (data: unknown): Uint8Array | null => {
		if (data instanceof Uint8Array) return data;
		if (data instanceof ArrayBuffer) return new Uint8Array(data);
		if (ArrayBuffer.isView(data)) {
			return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
		}
		return null;
	};

	ipcMain.handle(
		"update-content-dimensions",
		async (_event, { width, height }: { width: number; height: number }) => {
			if (
				Number.isFinite(width) &&
				Number.isFinite(height) &&
				width > 0 &&
				height > 0
			) {
				appState.setWindowDimensions(width, height);
			}
		},
	);

	ipcMain.handle("delete-screenshot", async (_event, path: string) => {
		return appState.deleteScreenshot(path);
	});

	ipcMain.handle("take-screenshot", async () => {
		try {
			const screenshotPath = await appState.takeScreenshot();
			const preview = await appState.getImagePreview(screenshotPath);
			return { path: screenshotPath, preview };
		} catch (error) {
			console.error("Error taking screenshot:", error);
			throw error;
		}
	});

	ipcMain.handle("get-screenshots", async () => {
		try {
			let previews = [];
			if (appState.getView() === "queue") {
				previews = await Promise.all(
					appState.getScreenshotQueue().map(async (path) => ({
						path,
						preview: await appState.getImagePreview(path),
					})),
				);
			} else {
				previews = await Promise.all(
					appState.getExtraScreenshotQueue().map(async (path) => ({
						path,
						preview: await appState.getImagePreview(path),
					})),
				);
			}
			return previews;
		} catch (error) {
			console.error("Error getting screenshots:", error);
			throw error;
		}
	});

	ipcMain.handle("toggle-window", async () => {
		appState.toggleMainWindow();
	});

	ipcMain.handle("reset-queues", async () => {
		try {
			appState.clearQueues();
			console.log("Screenshot queues have been cleared.");
			return { success: true };
		} catch (error: unknown) {
			console.error("Error resetting queues:", error);
			const message =
				error instanceof Error ? error.message : "Unknown error occurred";
			return { success: false, error: message };
		}
	});

	// IPC handler for analyzing image from file path
	ipcMain.handle("analyze-image-file", async (_event, path: string) => {
		try {
			// Only allow analysis of files created by the app (prevents arbitrary file reads).
			const userData = app.getPath("userData");
			const allowedDirs = [
				nodePath.resolve(nodePath.join(userData, "screenshots")) + nodePath.sep,
				nodePath.resolve(nodePath.join(userData, "extra_screenshots")) +
					nodePath.sep,
			];
			const resolved = nodePath.resolve(path);
			const normalizedResolved =
				process.platform === "win32" ? resolved.toLowerCase() : resolved;
			const normalizedAllowed = allowedDirs.map((dir) =>
				process.platform === "win32" ? dir.toLowerCase() : dir,
			);
			if (!normalizedAllowed.some((dir) => normalizedResolved.startsWith(dir))) {
				throw new Error("Invalid image path");
			}

			const result = await appState.processingHelper.analyzeImageFile(path);
			return result;
		} catch (error: unknown) {
			console.error("Error in analyze-image-file handler:", error);
			throw error;
		}
	});

	ipcMain.handle("groq-chat", async (_event, message: string) => {
		try {
			return await appState.processingHelper.chat(message);
		} catch (error: unknown) {
			console.error("Error in groq-chat handler:", error);
			throw error;
		}
	});

	ipcMain.handle("reset-chat-history", async () => {
		try {
			appState.processingHelper.resetConversation();
			return { success: true };
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			console.error("Error in reset-chat-history handler:", error);
			return { success: false, error: message };
		}
	});

	ipcMain.handle("live-what-do-i-say", async () => {
		try {
			const response = await appState.processingHelper.generateLiveWhatDoISay();
			return { success: true, data: response };
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			console.error("Error in live-what-do-i-say handler:", error);
			return { success: false, error: message };
		}
	});

	ipcMain.handle("call-assist-get-active-session", async () => {
		try {
			return appState.callAssistManager.getActiveSession();
		} catch (error) {
			console.error("Error in call-assist-get-active-session handler:", error);
			return null;
		}
	});

	ipcMain.handle(
		"call-assist-start",
		async (
			_event,
			params: {
				mode: "multichannel" | "diarize";
				sampleRate: number;
				channels: number;
				model?: string;
				language?: string;
				endpointingMs?: number;
				utteranceEndMs?: number;
				keywords?: string[];
				keyterms?: string[];
				youChannelIndex?: number;
				diarizeYouSpeakerId?: number | null;
				autoSaveToMemory?: boolean;
				autoSuggest?: boolean;
				autoSummary?: boolean;
			},
		) => {
			try {
				const info = await appState.callAssistManager.start(params);
				return { success: true, data: info };
			} catch (error: unknown) {
				const message = error instanceof Error ? error.message : String(error);
				console.error("Error in call-assist-start handler:", error);
				return { success: false, error: message };
			}
		},
	);

	ipcMain.handle("call-assist-stop", async (_event, sessionId: string) => {
		try {
			await appState.callAssistManager.stop(sessionId);
			return { success: true };
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			console.error("Error in call-assist-stop handler:", error);
			return { success: false, error: message };
		}
	});

	ipcMain.on(
		"call-assist-audio-frame",
		(_event, payload: { sessionId: string; pcm: ArrayBuffer }) => {
			try {
				if (!payload?.sessionId || typeof payload.sessionId !== "string") return;
				const bytes = coerceToUint8Array(payload.pcm);
				if (!bytes || bytes.length === 0) return;
				appState.callAssistManager.handleAudioFrame({
					sessionId: payload.sessionId,
					pcm: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
				});
			} catch (error) {
				console.error("Error in call-assist-audio-frame handler:", error);
			}
		},
	);

	ipcMain.handle("quit-app", () => {
		app.quit();
	});

	// Window movement handlers
	ipcMain.handle("move-window-left", async () => {
		appState.moveWindowLeft();
	});

	ipcMain.handle("move-window-right", async () => {
		appState.moveWindowRight();
	});

	ipcMain.handle("move-window-up", async () => {
		appState.moveWindowUp();
	});

	ipcMain.handle("move-window-down", async () => {
		appState.moveWindowDown();
	});

	ipcMain.handle("center-and-show-window", async () => {
		appState.centerAndShowWindow();
	});

	// LLM Model Management Handlers
	ipcMain.handle("get-current-llm-config", async () => {
		try {
			const llmHelper = appState.processingHelper.getLLMHelper();
			return {
				provider: "groq",
				model: llmHelper.getCurrentModel(),
				visionModel: llmHelper.getVisionModel(),
				availableModels: llmHelper.getAvailableModels(),
			};
		} catch (error: unknown) {
			console.error("Error getting current LLM config:", error);
			throw error;
		}
	});

	ipcMain.handle("get-available-models", async () => {
		try {
			const llmHelper = appState.processingHelper.getLLMHelper();
			return llmHelper.getAvailableModels();
		} catch (error: unknown) {
			console.error("Error getting available models:", error);
			throw error;
		}
	});

	ipcMain.handle("switch-model", async (_, model: string) => {
		try {
			const llmHelper = appState.processingHelper.getLLMHelper();
			const allowed = new Set(llmHelper.getAvailableModels());
			if (!allowed.has(model)) {
				return { success: false, error: "Invalid model" };
			}
			llmHelper.switchModel(model as never);
			return { success: true };
		} catch (error: unknown) {
			console.error("Error switching model:", error);
			const message =
				error instanceof Error ? error.message : "Unknown error occurred";
			return { success: false, error: message };
		}
	});

	ipcMain.handle("test-llm-connection", async () => {
		try {
			const llmHelper = appState.processingHelper.getLLMHelper();
			const result = await llmHelper.testConnection();
			return result;
		} catch (error: unknown) {
			console.error("Error testing LLM connection:", error);
			const message =
				error instanceof Error ? error.message : "Unknown error occurred";
			return { success: false, error: message };
		}
	});

	// Customization Handlers

	ipcMain.handle("get-customize-config", async () => {
		try {
			const config = appState.processingHelper.getCustomizeConfig();
			return config;
		} catch (error: unknown) {
			console.error("Error getting customize config:", error);
			return null;
		}
	});

	ipcMain.handle("get-role-presets", async () => {
		try {
			return appState.processingHelper.getRolePresets();
		} catch (error: unknown) {
			console.error("Error getting role presets:", error);
			return {};
		}
	});

	ipcMain.handle(
		"set-role",
		async (_, role: string, customText?: string) => {
			try {
				const result = appState.processingHelper.setRole(role, customText);
				if (!result) {
					return { success: false, error: PERSONALIZATION_UNAVAILABLE };
				}
				return { success: true };
			} catch (error: unknown) {
				console.error("Error setting role:", error);
				const message =
					error instanceof Error ? error.message : "Unknown error occurred";
				return { success: false, error: message };
			}
		},
	);

	ipcMain.handle("set-text-context", async (_, text: string) => {
		try {
			const result = appState.processingHelper.setTextContext(text);
			if (!result) {
				return { success: false, error: PERSONALIZATION_UNAVAILABLE };
			}
			return { success: true };
		} catch (error: unknown) {
			console.error("Error setting text context:", error);
			const message =
				error instanceof Error ? error.message : "Unknown error occurred";
			return { success: false, error: message };
		}
	});

	ipcMain.handle("set-user-facts", async (_, facts: string[]) => {
		try {
			const result = appState.processingHelper.setUserFacts(facts);
			if (!result) {
				return { success: false, error: PERSONALIZATION_UNAVAILABLE };
			}
			return { success: true };
		} catch (error: unknown) {
			console.error("Error setting user facts:", error);
			const message =
				error instanceof Error ? error.message : "Unknown error occurred";
			return { success: false, error: message };
		}
	});

	ipcMain.handle(
		"upload-document-data",
		async (_, payload: unknown) => {
			try {
				if (!appState.processingHelper.getSupermemoryHelper()) {
					return { success: false, error: PERSONALIZATION_UNAVAILABLE };
				}
				if (!payload || typeof payload !== "object") {
					return { success: false, error: "Invalid upload payload" };
				}

				const obj = payload as {
					name?: unknown;
					data?: unknown;
					mimeType?: unknown;
				};
				const name = typeof obj.name === "string" ? obj.name : "";
				const data = coerceToUint8Array(obj.data);
				const mimeType = typeof obj.mimeType === "string" ? obj.mimeType : undefined;
				if (!name || !data) {
					return { success: false, error: "Invalid upload payload" };
				}

				const result = await appState.processingHelper.uploadDocumentData(
					name,
					data,
					mimeType,
				);
				if (!result) {
					return { success: false, error: PERSONALIZATION_UNAVAILABLE };
				}
				return { success: true, data: result };
			} catch (error: unknown) {
				console.error("Error uploading document (bytes):", error);
				const message =
					error instanceof Error ? error.message : "Unknown error occurred";
				return { success: false, error: message };
			}
		},
	);

	ipcMain.handle("add-text-memory", async (_, content: string) => {
		try {
			if (!appState.processingHelper.getSupermemoryHelper()) {
				return { success: false, error: PERSONALIZATION_UNAVAILABLE };
			}
			const result = await appState.processingHelper.addTextMemory(content);
			if (!result) {
				return { success: false, error: PERSONALIZATION_UNAVAILABLE };
			}
			return { success: true, data: result };
		} catch (error: unknown) {
			console.error("Error adding text memory:", error);
			const message =
				error instanceof Error ? error.message : "Unknown error occurred";
			return { success: false, error: message };
		}
	});

	ipcMain.handle("search-memories", async (_, query: string) => {
		try {
			if (!appState.processingHelper.getSupermemoryHelper()) {
				return { success: false, error: PERSONALIZATION_UNAVAILABLE };
			}
			const result = await appState.processingHelper.searchMemories(query);
			if (!result) {
				return { success: false, error: PERSONALIZATION_UNAVAILABLE };
			}
			return { success: true, data: result };
		} catch (error: unknown) {
			console.error("Error searching memories:", error);
			const message =
				error instanceof Error ? error.message : "Unknown error occurred";
			return { success: false, error: message };
		}
	});

	ipcMain.handle("delete-document", async (_, documentId: string) => {
		try {
			if (!appState.processingHelper.getSupermemoryHelper()) {
				return { success: false, error: PERSONALIZATION_UNAVAILABLE };
			}
			const result = await appState.processingHelper.deleteDocument(documentId);
			if (!result) {
				return { success: false, error: "Failed to delete document" };
			}
			return { success: true };
		} catch (error: unknown) {
			console.error("Error deleting document:", error);
			const message =
				error instanceof Error ? error.message : "Unknown error occurred";
			return { success: false, error: message };
		}
	});

	ipcMain.handle("get-documents", async () => {
		try {
			const documents = appState.processingHelper.getDocuments();
			return documents;
		} catch (error: unknown) {
			console.error("Error getting documents:", error);
			return [];
		}
	});

	ipcMain.handle("get-user-profile", async () => {
		try {
			const profile = await appState.processingHelper.getUserProfile(true);
			return profile;
		} catch (error: unknown) {
			console.error("Error getting user profile:", error);
			return null;
		}
	});

	ipcMain.handle("get-supermemory-container-tag", async () => {
		try {
			return appState.processingHelper.getSupermemoryContainerTag();
		} catch (error: unknown) {
			console.error("Error getting Supermemory container tag:", error);
			return null;
		}
	});

	ipcMain.handle("reset-customization", async () => {
		try {
			appState.processingHelper.resetCustomization();
			return { success: true };
		} catch (error: unknown) {
			console.error("Error resetting customization:", error);
			const message =
				error instanceof Error ? error.message : "Unknown error occurred";
			return { success: false, error: message };
		}
	});

	// ==================== Knowledge Base / Connections ====================

	ipcMain.handle("get-knowledge-base-overview", async () => {
		try {
			if (!appState.processingHelper.getSupermemoryHelper()) {
				return { success: false, error: PERSONALIZATION_UNAVAILABLE };
			}
			const result = await appState.processingHelper.getKnowledgeBaseOverview();
			if (!result) return { success: false, error: PERSONALIZATION_UNAVAILABLE };
			return { success: true, data: result };
		} catch (error: unknown) {
			console.error("Error getting knowledge base overview:", error);
			const message = error instanceof Error ? error.message : "Unknown error occurred";
			return { success: false, error: message };
		}
	});

	ipcMain.handle("get-document-status", async (_event, documentId: unknown) => {
		try {
			if (!appState.processingHelper.getSupermemoryHelper()) {
				return { success: false, error: PERSONALIZATION_UNAVAILABLE };
			}
			if (typeof documentId !== "string" || !documentId.trim()) {
				return { success: false, error: "Document id is required" };
			}
			const result = await appState.processingHelper.getDocumentStatus(documentId);
			if (!result) return { success: false, error: PERSONALIZATION_UNAVAILABLE };
			return { success: true, data: result };
		} catch (error: unknown) {
			console.error("Error getting document status:", error);
			const message = error instanceof Error ? error.message : "Unknown error occurred";
			return { success: false, error: message };
		}
	});

	ipcMain.handle("add-knowledge-url", async (_, payload: unknown) => {
		try {
			if (!appState.processingHelper.getSupermemoryHelper()) {
				return { success: false, error: PERSONALIZATION_UNAVAILABLE };
			}
			if (!payload || typeof payload !== "object") {
				return { success: false, error: "Invalid payload" };
			}
			const obj = payload as { url?: unknown; title?: unknown };
			const url = typeof obj.url === "string" ? obj.url : "";
			const title = typeof obj.title === "string" ? obj.title : undefined;
			if (!url.trim()) return { success: false, error: "URL is required" };

			const result = await appState.processingHelper.addKnowledgeUrl({
				url,
				title,
			});
			if (!result) return { success: false, error: PERSONALIZATION_UNAVAILABLE };
			return { success: true, data: result };
		} catch (error: unknown) {
			console.error("Error adding knowledge URL:", error);
			const message = error instanceof Error ? error.message : "Unknown error occurred";
			return { success: false, error: message };
		}
	});

	ipcMain.handle("add-knowledge-text", async (_, payload: unknown) => {
		try {
			if (!appState.processingHelper.getSupermemoryHelper()) {
				return { success: false, error: PERSONALIZATION_UNAVAILABLE };
			}
			if (!payload || typeof payload !== "object") {
				return { success: false, error: "Invalid payload" };
			}
			const obj = payload as { title?: unknown; content?: unknown };
			const title = typeof obj.title === "string" ? obj.title : "";
			const content = typeof obj.content === "string" ? obj.content : "";
			if (!title.trim()) return { success: false, error: "Title is required" };
			if (!content.trim()) return { success: false, error: "Content is required" };

			const result = await appState.processingHelper.addKnowledgeText({
				title,
				content,
			});
			if (!result) return { success: false, error: PERSONALIZATION_UNAVAILABLE };
			return { success: true, data: result };
		} catch (error: unknown) {
			console.error("Error adding knowledge text:", error);
			const message = error instanceof Error ? error.message : "Unknown error occurred";
			return { success: false, error: message };
		}
	});

	ipcMain.handle("list-connections", async () => {
		try {
			if (!appState.processingHelper.getSupermemoryHelper()) {
				return { success: false, error: PERSONALIZATION_UNAVAILABLE };
			}
			const result = await appState.processingHelper.listConnections();
			if (!result) return { success: false, error: PERSONALIZATION_UNAVAILABLE };
			return { success: true, data: result };
		} catch (error: unknown) {
			console.error("Error listing connections:", error);
			const message = error instanceof Error ? error.message : "Unknown error occurred";
			return { success: false, error: message };
		}
	});

	ipcMain.handle("create-connection", async (_, payload: unknown) => {
		try {
			if (!appState.processingHelper.getSupermemoryHelper()) {
				return { success: false, error: PERSONALIZATION_UNAVAILABLE };
			}
			if (!payload || typeof payload !== "object") {
				return { success: false, error: "Invalid payload" };
			}
			const obj = payload as {
				provider?: unknown;
				documentLimit?: unknown;
				metadata?: unknown;
				redirectUrl?: unknown;
			};
			const provider = typeof obj.provider === "string" ? obj.provider : "";
			if (!CONNECTION_PROVIDERS.has(provider)) {
				return { success: false, error: "Invalid provider" };
			}

			const documentLimit =
				typeof obj.documentLimit === "number" && Number.isFinite(obj.documentLimit)
					? obj.documentLimit
					: undefined;
			const redirectUrl = typeof obj.redirectUrl === "string" ? obj.redirectUrl : undefined;
			const metadata =
				obj.metadata && typeof obj.metadata === "object" && !Array.isArray(obj.metadata)
					? (obj.metadata as Record<string, string | number | boolean>)
					: undefined;

			const result = await appState.processingHelper.createConnection(
				provider as never,
				{
					documentLimit,
					metadata,
					redirectUrl,
				},
			);
			if (!result) return { success: false, error: PERSONALIZATION_UNAVAILABLE };
			return { success: true, data: result };
		} catch (error: unknown) {
			console.error("Error creating connection:", error);
			const message = error instanceof Error ? error.message : "Unknown error occurred";
			return { success: false, error: message };
		}
	});

	ipcMain.handle("sync-connection", async (_, provider: unknown) => {
		try {
			if (!appState.processingHelper.getSupermemoryHelper()) {
				return { success: false, error: PERSONALIZATION_UNAVAILABLE };
			}
			const p = typeof provider === "string" ? provider : "";
			if (!CONNECTION_PROVIDERS.has(p)) {
				return { success: false, error: "Invalid provider" };
			}
			const result = await appState.processingHelper.syncConnection(p as never);
			if (!result) return { success: false, error: PERSONALIZATION_UNAVAILABLE };
			return { success: true, data: result };
		} catch (error: unknown) {
			console.error("Error syncing connection:", error);
			const message = error instanceof Error ? error.message : "Unknown error occurred";
			return { success: false, error: message };
		}
	});

	ipcMain.handle("delete-connection", async (_, provider: unknown) => {
		try {
			if (!appState.processingHelper.getSupermemoryHelper()) {
				return { success: false, error: PERSONALIZATION_UNAVAILABLE };
			}
			const p = typeof provider === "string" ? provider : "";
			if (!CONNECTION_PROVIDERS.has(p)) {
				return { success: false, error: "Invalid provider" };
			}
			const result = await appState.processingHelper.deleteConnection(p as never);
			if (!result) return { success: false, error: PERSONALIZATION_UNAVAILABLE };
			return { success: true, data: result };
		} catch (error: unknown) {
			console.error("Error deleting connection:", error);
			const message = error instanceof Error ? error.message : "Unknown error occurred";
			return { success: false, error: message };
		}
	});

	ipcMain.handle("list-connection-documents", async (_, provider: unknown) => {
		try {
			if (!appState.processingHelper.getSupermemoryHelper()) {
				return { success: false, error: PERSONALIZATION_UNAVAILABLE };
			}
			const p = typeof provider === "string" ? provider : "";
			if (!CONNECTION_PROVIDERS.has(p)) {
				return { success: false, error: "Invalid provider" };
			}
			const result = await appState.processingHelper.listConnectionDocuments(p as never);
			if (!result) return { success: false, error: PERSONALIZATION_UNAVAILABLE };
			return { success: true, data: result };
		} catch (error: unknown) {
			console.error("Error listing connection documents:", error);
			const message = error instanceof Error ? error.message : "Unknown error occurred";
			return { success: false, error: message };
		}
	});

	ipcMain.handle("open-external-url", async (_, url: unknown) => {
		try {
			const raw = typeof url === "string" ? url.trim() : "";
			if (!raw) return { success: false, error: "URL is required" };
			let parsed: URL;
			try {
				parsed = new URL(raw);
			} catch {
				return { success: false, error: "Invalid URL" };
			}

			if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
				return { success: false, error: "Unsupported URL protocol" };
			}

			await shell.openExternal(parsed.toString());
			return { success: true };
		} catch (error: unknown) {
			console.error("Error opening external URL:", error);
			const message = error instanceof Error ? error.message : "Unknown error occurred";
			return { success: false, error: message };
		}
	});

	// ==================== About You Handlers ====================

	ipcMain.handle("get-about-you-entries", async () => {
		try {
			const entries = appState.processingHelper.getAboutYouEntries();
			return entries;
		} catch (error: unknown) {
			console.error("Error getting About You entries:", error);
			return [];
		}
	});

	ipcMain.handle(
		"add-about-you-text-entry",
		async (_, title: string, content: string) => {
			try {
				if (!appState.processingHelper.getSupermemoryHelper()) {
					return { success: false, error: PERSONALIZATION_UNAVAILABLE };
				}
				const entry = await appState.processingHelper.addAboutYouTextEntry(
					title,
					content,
				);
				if (!entry) {
					return { success: false, error: PERSONALIZATION_UNAVAILABLE };
				}
				return { success: true, data: entry };
			} catch (error: unknown) {
				console.error("Error adding About You text entry:", error);
				const message =
					error instanceof Error ? error.message : "Unknown error occurred";
				return { success: false, error: message };
			}
		},
	);

	ipcMain.handle(
		"add-about-you-file-entry-data",
		async (_, payload: unknown) => {
			try {
				if (!appState.processingHelper.getSupermemoryHelper()) {
					return { success: false, error: PERSONALIZATION_UNAVAILABLE };
				}
				if (!payload || typeof payload !== "object") {
					return { success: false, error: "Invalid upload payload" };
				}

				const obj = payload as {
					title?: unknown;
					name?: unknown;
					data?: unknown;
					mimeType?: unknown;
				};
				const title = typeof obj.title === "string" ? obj.title : "";
				const name = typeof obj.name === "string" ? obj.name : "";
				const data = coerceToUint8Array(obj.data);
				const mimeType = typeof obj.mimeType === "string" ? obj.mimeType : undefined;
				if (!title || !name || !data) {
					return { success: false, error: "Invalid upload payload" };
				}

				const entry = await appState.processingHelper.addAboutYouFileEntryData(
					title,
					name,
					data,
					mimeType,
				);
				if (!entry) {
					return { success: false, error: PERSONALIZATION_UNAVAILABLE };
				}
				return { success: true, data: entry };
			} catch (error: unknown) {
				console.error("Error adding About You file entry (bytes):", error);
				const message =
					error instanceof Error ? error.message : "Unknown error occurred";
				return { success: false, error: message };
			}
		},
	);

	ipcMain.handle(
		"update-about-you-entry",
		async (_, id: string, title: string, content: string) => {
			try {
				if (!appState.processingHelper.getSupermemoryHelper()) {
					return { success: false, error: PERSONALIZATION_UNAVAILABLE };
				}
				const entry = await appState.processingHelper.updateAboutYouEntry(
					id,
					title,
					content,
				);
				if (!entry) {
					return { success: false, error: PERSONALIZATION_UNAVAILABLE };
				}
				return { success: true, data: entry };
			} catch (error: unknown) {
				console.error("Error updating About You entry:", error);
				const message =
					error instanceof Error ? error.message : "Unknown error occurred";
				return { success: false, error: message };
			}
		},
	);

	ipcMain.handle("delete-about-you-entry", async (_, id: string) => {
		try {
			if (!appState.processingHelper.getSupermemoryHelper()) {
				return { success: false, error: PERSONALIZATION_UNAVAILABLE };
			}
			const result = await appState.processingHelper.deleteAboutYouEntry(id);
			if (!result) {
				return { success: false, error: "Failed to delete entry" };
			}
			return { success: true };
		} catch (error: unknown) {
			console.error("Error deleting About You entry:", error);
			const message =
				error instanceof Error ? error.message : "Unknown error occurred";
			return { success: false, error: message };
		}
	});

	// Full reset - deletes all Supermemory data
	ipcMain.handle("full-reset-customization", async () => {
		try {
			await appState.processingHelper.fullResetCustomization();
			return { success: true };
		} catch (error: unknown) {
			console.error("Error performing full reset:", error);
			const message =
				error instanceof Error ? error.message : "Unknown error occurred";
			return { success: false, error: message };
		}
	});
}
