import { contextBridge, type IpcRendererEvent, ipcRenderer } from "electron";

// Debug success data structure
interface DebugSuccessData {
	solution: {
		old_code: string;
		new_code: string;
		thoughts: string[];
		time_complexity: string;
		space_complexity: string;
	};
}

// Problem extracted data structure
interface ProblemExtractedData {
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

// Solution success data structure
interface SolutionSuccessData {
	solution: {
		code: string;
		problem_statement: string;
		context?: string;
		suggested_responses?: string[];
		reasoning?: string;
	};
}

// Customization config types
interface StoredDocument {
	id: string;
	name: string;
	type: string;
	addedAt: number;
}

// About You entry - persisted locally
interface AboutYouEntry {
	id: string;
	title: string;
	content: string;
	type: "text" | "file";
	filePath?: string;
	fileName?: string;
	supermemoryId?: string;
	addedAt: number;
}

interface CustomizeConfig {
	role: string;
	customRoleText: string;
	textContext: string;
	documents: StoredDocument[];
	userFacts: string[];
	aboutYou: AboutYouEntry[];
}

type SupermemoryProvider =
	| "notion"
	| "google-drive"
	| "onedrive";

interface ListedDocument {
	id: string;
	title?: string | null;
	type?: string | null;
	status?: string | null;
	summary?: string | null;
	metadata?: Record<string, unknown> | null;
	containerTags?: string[] | null;
	connectionId?: string | null;
	customId?: string | null;
	createdAt?: string | null;
	updatedAt?: string | null;
}

interface ListDocumentsResponse {
	memories: ListedDocument[];
	pagination?: {
		currentPage?: number;
		limit?: number;
		totalItems?: number;
		totalPages?: number;
	} | null;
}

interface KnowledgeBaseOverview {
	ready: ListedDocument[];
	processing: Array<{
		id: string;
		status: string;
		title?: string | null;
	}>;
	list: ListDocumentsResponse;
}

interface SupermemoryConnection {
	id: string;
	provider: string;
	email?: string | null;
	documentLimit?: number | null;
	createdAt?: string | null;
	expiresAt?: string | null;
	metadata?: Record<string, unknown> | null;
}

interface CreateConnectionResponse {
	id: string;
	authLink: string;
	expiresIn: string;
	redirectsTo?: string | null;
}

interface DeleteConnectionResponse {
	id: string;
	provider: string;
}

interface ConnectionDocument {
	id: string;
	status: string;
	type: string;
	title?: string | null;
	summary?: string | null;
	createdAt?: string | null;
	updatedAt?: string | null;
}

// Call Assist (Deepgram) types
interface CallAssistSessionInfo {
	sessionId: string;
	recordingPath: string;
	startedAt: number;
}

type CallAssistStatusEvent =
	| { sessionId: string; state: "idle" }
	| { sessionId: string; state: "connecting" }
	| { sessionId: string; state: "open" }
	| { sessionId: string; state: "closing" }
	| { sessionId: string; state: "closed"; code?: number; reason?: string }
	| { sessionId: string; state: "error"; message: string };

interface CallAssistCaptionEvent {
	sessionId: string;
	channelIndex: number;
	speakerLabel: string;
	text: string;
}

interface CallAssistUtteranceEvent {
	sessionId: string;
	utteranceId: string;
	channelIndex: number;
	speakerId: number | null;
	speakerLabel: string;
	text: string;
	startMs: number | null;
	endMs: number | null;
}

interface CallAssistMetadataEvent {
	sessionId: string;
	requestId?: string;
	channels?: number;
	duration?: number;
}

interface CallAssistSuggestionEvent {
	sessionId: string;
	utteranceId: string;
	suggestion: string;
}

interface CallAssistSummaryEvent {
	sessionId: string;
	summary: string;
}

interface CallAssistErrorEvent {
	sessionId: string;
	message: string;
}

// Types for the exposed Electron API
interface ElectronAPI {
	updateContentDimensions: (dimensions: {
		width: number;
		height: number;
	}) => Promise<void>;
	getScreenshots: () => Promise<Array<{ path: string; preview: string }>>;
	deleteScreenshot: (
		path: string,
	) => Promise<{ success: boolean; error?: string }>;
	onScreenshotTaken: (
		callback: (data: { path: string; preview: string }) => void,
	) => () => void;
	onResetView: (callback: () => void) => () => void;
	onSolutionStart: (callback: () => void) => () => void;
	onDebugStart: (callback: () => void) => () => void;
	onDebugSuccess: (callback: (data: DebugSuccessData) => void) => () => void;
	onSolutionError: (callback: (error: string) => void) => () => void;
	onProcessingNoScreenshots: (callback: () => void) => () => void;
	onProblemExtracted: (
		callback: (data: ProblemExtractedData) => void,
	) => () => void;
	onSolutionSuccess: (
		callback: (data: SolutionSuccessData) => void,
	) => () => void;

	onUnauthorized: (callback: () => void) => () => void;
	onDebugError: (callback: (error: string) => void) => () => void;
	onFocusChat: (callback: () => void) => () => void;
	takeScreenshot: () => Promise<{ path: string; preview: string }>;
	moveWindowLeft: () => Promise<void>;
	moveWindowRight: () => Promise<void>;
	moveWindowUp: () => Promise<void>;
	moveWindowDown: () => Promise<void>;
	analyzeImageFile: (
		path: string,
	) => Promise<{ text: string; timestamp: number }>;
	groqChat: (message: string) => Promise<string>;
	resetChatHistory: () => Promise<{ success: boolean; error?: string }>;
	liveWhatDoISay: () => Promise<{
		success: boolean;
		data?: string;
		error?: string;
	}>;
	quitApp: () => Promise<void>;

	// LLM Model Management
	getCurrentLlmConfig: () => Promise<{
		provider: string;
		model: string;
		visionModel: string;
		availableModels: string[];
	}>;
	getAvailableModels: () => Promise<string[]>;
	switchModel: (model: string) => Promise<{ success: boolean; error?: string }>;
	testLlmConnection: () => Promise<{ success: boolean; error?: string }>;

	// Customization APIs
	getCustomizeConfig: () => Promise<CustomizeConfig | null>;
	getRolePresets: () => Promise<Record<string, string>>;
	setRole: (
		role: string,
		customText?: string,
	) => Promise<{ success: boolean; error?: string }>;
	setTextContext: (
		text: string,
	) => Promise<{ success: boolean; error?: string }>;
	setUserFacts: (
		facts: string[],
	) => Promise<{ success: boolean; error?: string }>;
	uploadDocumentData: (payload: {
		name: string;
		data: Uint8Array;
		mimeType?: string;
	}) => Promise<{
		success: boolean;
		data?: { id: string; status: string };
		error?: string;
	}>;
	addTextMemory: (
		content: string,
	) => Promise<{
		success: boolean;
		data?: { id: string; status: string };
		error?: string;
	}>;
	searchMemories: (
		query: string,
	) => Promise<{
		success: boolean;
		data?: { results: unknown[]; total: number };
		error?: string;
	}>;
	getDocumentStatus: (documentId: string) => Promise<{
		success: boolean;
		data?: { id: string; status: string; title?: string | null };
		error?: string;
	}>;
	deleteDocument: (
		documentId: string,
	) => Promise<{ success: boolean; error?: string }>;
	getDocuments: () => Promise<StoredDocument[]>;
	getUserProfile: () => Promise<{
		static: string[];
		dynamic: string[];
	} | null>;
	getSupermemoryContainerTag: () => Promise<string | null>;
	resetCustomization: () => Promise<{ success: boolean; error?: string }>;

	// About You APIs
	getAboutYouEntries: () => Promise<AboutYouEntry[]>;
	addAboutYouTextEntry: (
		title: string,
		content: string,
	) => Promise<{
		success: boolean;
		data?: AboutYouEntry;
		error?: string;
	}>;
	addAboutYouFileEntryData: (payload: {
		title: string;
		name: string;
		data: Uint8Array;
		mimeType?: string;
	}) => Promise<{
		success: boolean;
		data?: AboutYouEntry;
		error?: string;
	}>;
	updateAboutYouEntry: (
		id: string,
		title: string,
		content: string,
	) => Promise<{
		success: boolean;
		data?: AboutYouEntry;
		error?: string;
	}>;
	deleteAboutYouEntry: (
		id: string,
	) => Promise<{ success: boolean; error?: string }>;

	// Full reset (deletes all Supermemory data)
	fullResetCustomization: () => Promise<{ success: boolean; error?: string }>;

	// Knowledge Base / Connections
	getKnowledgeBaseOverview: () => Promise<{
		success: boolean;
		data?: KnowledgeBaseOverview;
		error?: string;
	}>;
	addKnowledgeUrl: (payload: {
		url: string;
		title?: string;
	}) => Promise<{
		success: boolean;
		data?: { id: string; status: string };
		error?: string;
	}>;
	addKnowledgeText: (payload: {
		title: string;
		content: string;
	}) => Promise<{
		success: boolean;
		data?: { id: string; status: string };
		error?: string;
	}>;
	listConnections: () => Promise<{
		success: boolean;
		data?: SupermemoryConnection[];
		error?: string;
	}>;
	createConnection: (payload: {
		provider: SupermemoryProvider;
		documentLimit?: number;
		metadata?: Record<string, string | number | boolean>;
		redirectUrl?: string;
	}) => Promise<{
		success: boolean;
		data?: CreateConnectionResponse;
		error?: string;
	}>;
	syncConnection: (provider: SupermemoryProvider) => Promise<{
		success: boolean;
		data?: { message: string };
		error?: string;
	}>;
	deleteConnection: (provider: SupermemoryProvider) => Promise<{
		success: boolean;
		data?: DeleteConnectionResponse;
		error?: string;
	}>;
	listConnectionDocuments: (provider: SupermemoryProvider) => Promise<{
		success: boolean;
		data?: ConnectionDocument[];
		error?: string;
	}>;
	openExternalUrl: (
		url: string,
	) => Promise<{ success: boolean; error?: string }>;

	// Call Assist (Deepgram)
	callAssistStart: (payload: {
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
	}) => Promise<{
		success: boolean;
		data?: CallAssistSessionInfo;
		error?: string;
	}>;
	callAssistStop: (sessionId: string) => Promise<{ success: boolean; error?: string }>;
	callAssistGetActiveSession: () => Promise<CallAssistSessionInfo | null>;
	callAssistSendAudioFrame: (payload: { sessionId: string; pcm: ArrayBuffer }) => void;
	onCallAssistStatus: (callback: (evt: CallAssistStatusEvent) => void) => () => void;
	onCallAssistCaption: (callback: (evt: CallAssistCaptionEvent) => void) => () => void;
	onCallAssistUtterance: (callback: (evt: CallAssistUtteranceEvent) => void) => () => void;
	onCallAssistMetadata: (callback: (evt: CallAssistMetadataEvent) => void) => () => void;
	onCallAssistSuggestion: (callback: (evt: CallAssistSuggestionEvent) => void) => () => void;
	onCallAssistSummary: (callback: (evt: CallAssistSummaryEvent) => void) => () => void;
	onCallAssistError: (callback: (evt: CallAssistErrorEvent) => void) => () => void;
	onCallAssistStarted: (callback: (info: CallAssistSessionInfo) => void) => () => void;
	onCallAssistStopped: (callback: (evt: { sessionId: string }) => void) => () => void;
}

export const PROCESSING_EVENTS = {
	//global states
	UNAUTHORIZED: "processing-unauthorized",
	NO_SCREENSHOTS: "processing-no-screenshots",

	//states for generating the initial solution
	INITIAL_START: "initial-start",
	PROBLEM_EXTRACTED: "problem-extracted",
	SOLUTION_SUCCESS: "solution-success",
	INITIAL_SOLUTION_ERROR: "solution-error",

	//states for processing the debugging
	DEBUG_START: "debug-start",
	DEBUG_SUCCESS: "debug-success",
	DEBUG_ERROR: "debug-error",
} as const;

// Expose the Electron API to the renderer process
contextBridge.exposeInMainWorld("electronAPI", {
	updateContentDimensions: (dimensions: { width: number; height: number }) =>
		ipcRenderer.invoke("update-content-dimensions", dimensions),
	takeScreenshot: () => ipcRenderer.invoke("take-screenshot"),
	getScreenshots: () => ipcRenderer.invoke("get-screenshots"),
	deleteScreenshot: (path: string) =>
		ipcRenderer.invoke("delete-screenshot", path),

	// Event listeners
	onScreenshotTaken: (
		callback: (data: { path: string; preview: string }) => void,
	) => {
		const subscription = (
			_: IpcRendererEvent,
			data: { path: string; preview: string },
		) => callback(data);
		ipcRenderer.on("screenshot-taken", subscription);
		return () => {
			ipcRenderer.removeListener("screenshot-taken", subscription);
		};
	},
	onResetView: (callback: () => void) => {
		const subscription = () => callback();
		ipcRenderer.on("reset-view", subscription);
		return () => {
			ipcRenderer.removeListener("reset-view", subscription);
		};
	},
	onSolutionStart: (callback: () => void) => {
		const subscription = () => callback();
		ipcRenderer.on(PROCESSING_EVENTS.INITIAL_START, subscription);
		return () => {
			ipcRenderer.removeListener(PROCESSING_EVENTS.INITIAL_START, subscription);
		};
	},
	onDebugStart: (callback: () => void) => {
		const subscription = () => callback();
		ipcRenderer.on(PROCESSING_EVENTS.DEBUG_START, subscription);
		return () => {
			ipcRenderer.removeListener(PROCESSING_EVENTS.DEBUG_START, subscription);
		};
	},

	onDebugSuccess: (callback: (data: DebugSuccessData) => void) => {
		const subscription = (_: IpcRendererEvent, data: DebugSuccessData) =>
			callback(data);
		ipcRenderer.on("debug-success", subscription);
		return () => {
			ipcRenderer.removeListener("debug-success", subscription);
		};
	},
	onDebugError: (callback: (error: string) => void) => {
		const subscription = (_: IpcRendererEvent, error: string) =>
			callback(error);
		ipcRenderer.on(PROCESSING_EVENTS.DEBUG_ERROR, subscription);
		return () => {
			ipcRenderer.removeListener(PROCESSING_EVENTS.DEBUG_ERROR, subscription);
		};
	},
	onSolutionError: (callback: (error: string) => void) => {
		const subscription = (_: IpcRendererEvent, error: string) =>
			callback(error);
		ipcRenderer.on(PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR, subscription);
		return () => {
			ipcRenderer.removeListener(
				PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
				subscription,
			);
		};
	},
	onProcessingNoScreenshots: (callback: () => void) => {
		const subscription = () => callback();
		ipcRenderer.on(PROCESSING_EVENTS.NO_SCREENSHOTS, subscription);
		return () => {
			ipcRenderer.removeListener(
				PROCESSING_EVENTS.NO_SCREENSHOTS,
				subscription,
			);
		};
	},

	onProblemExtracted: (callback: (data: ProblemExtractedData) => void) => {
		const subscription = (_: IpcRendererEvent, data: ProblemExtractedData) =>
			callback(data);
		ipcRenderer.on(PROCESSING_EVENTS.PROBLEM_EXTRACTED, subscription);
		return () => {
			ipcRenderer.removeListener(
				PROCESSING_EVENTS.PROBLEM_EXTRACTED,
				subscription,
			);
		};
	},
	onSolutionSuccess: (callback: (data: SolutionSuccessData) => void) => {
		const subscription = (_: IpcRendererEvent, data: SolutionSuccessData) =>
			callback(data);
		ipcRenderer.on(PROCESSING_EVENTS.SOLUTION_SUCCESS, subscription);
		return () => {
			ipcRenderer.removeListener(
				PROCESSING_EVENTS.SOLUTION_SUCCESS,
				subscription,
			);
		};
	},
	onUnauthorized: (callback: () => void) => {
		const subscription = () => callback();
		ipcRenderer.on(PROCESSING_EVENTS.UNAUTHORIZED, subscription);
		return () => {
			ipcRenderer.removeListener(PROCESSING_EVENTS.UNAUTHORIZED, subscription);
		};
	},
	onFocusChat: (callback: () => void) => {
		const subscription = () => callback();
		ipcRenderer.on("focus-chat", subscription);
		return () => {
			ipcRenderer.removeListener("focus-chat", subscription);
		};
	},
	moveWindowLeft: () => ipcRenderer.invoke("move-window-left"),
	moveWindowRight: () => ipcRenderer.invoke("move-window-right"),
	moveWindowUp: () => ipcRenderer.invoke("move-window-up"),
	moveWindowDown: () => ipcRenderer.invoke("move-window-down"),
	analyzeImageFile: (path: string) =>
		ipcRenderer.invoke("analyze-image-file", path),
	groqChat: (message: string) => ipcRenderer.invoke("groq-chat", message),
	resetChatHistory: () => ipcRenderer.invoke("reset-chat-history"),
	liveWhatDoISay: () => ipcRenderer.invoke("live-what-do-i-say"),
	quitApp: () => ipcRenderer.invoke("quit-app"),

	// LLM Model Management
	getCurrentLlmConfig: () => ipcRenderer.invoke("get-current-llm-config"),
	getAvailableModels: () => ipcRenderer.invoke("get-available-models"),
	switchModel: (model: string) => ipcRenderer.invoke("switch-model", model),
	testLlmConnection: () => ipcRenderer.invoke("test-llm-connection"),

	// Customization APIs
	getCustomizeConfig: () => ipcRenderer.invoke("get-customize-config"),
	getRolePresets: () => ipcRenderer.invoke("get-role-presets"),
	setRole: (role: string, customText?: string) =>
		ipcRenderer.invoke("set-role", role, customText),
	setTextContext: (text: string) =>
		ipcRenderer.invoke("set-text-context", text),
	setUserFacts: (facts: string[]) =>
		ipcRenderer.invoke("set-user-facts", facts),
	uploadDocumentData: (payload: {
		name: string;
		data: Uint8Array;
		mimeType?: string;
	}) => ipcRenderer.invoke("upload-document-data", payload),
	addTextMemory: (content: string) =>
		ipcRenderer.invoke("add-text-memory", content),
	searchMemories: (query: string) =>
		ipcRenderer.invoke("search-memories", query),
	getDocumentStatus: (documentId: string) =>
		ipcRenderer.invoke("get-document-status", documentId),
	deleteDocument: (documentId: string) =>
		ipcRenderer.invoke("delete-document", documentId),
	getDocuments: () => ipcRenderer.invoke("get-documents"),
	getUserProfile: () => ipcRenderer.invoke("get-user-profile"),
	getSupermemoryContainerTag: () =>
		ipcRenderer.invoke("get-supermemory-container-tag"),
	resetCustomization: () => ipcRenderer.invoke("reset-customization"),

	// About You APIs
	getAboutYouEntries: () => ipcRenderer.invoke("get-about-you-entries"),
	addAboutYouTextEntry: (title: string, content: string) =>
		ipcRenderer.invoke("add-about-you-text-entry", title, content),
	addAboutYouFileEntryData: (payload: {
		title: string;
		name: string;
		data: Uint8Array;
		mimeType?: string;
	}) => ipcRenderer.invoke("add-about-you-file-entry-data", payload),
	updateAboutYouEntry: (id: string, title: string, content: string) =>
		ipcRenderer.invoke("update-about-you-entry", id, title, content),
	deleteAboutYouEntry: (id: string) =>
		ipcRenderer.invoke("delete-about-you-entry", id),

	// Full reset (deletes all Supermemory data)
	fullResetCustomization: () => ipcRenderer.invoke("full-reset-customization"),

	// Knowledge Base / Connections
	getKnowledgeBaseOverview: () =>
		ipcRenderer.invoke("get-knowledge-base-overview"),
	addKnowledgeUrl: (payload: { url: string; title?: string }) =>
		ipcRenderer.invoke("add-knowledge-url", payload),
	addKnowledgeText: (payload: { title: string; content: string }) =>
		ipcRenderer.invoke("add-knowledge-text", payload),
	listConnections: () => ipcRenderer.invoke("list-connections"),
	createConnection: (payload: {
		provider: SupermemoryProvider;
		documentLimit?: number;
		metadata?: Record<string, string | number | boolean>;
		redirectUrl?: string;
	}) => ipcRenderer.invoke("create-connection", payload),
	syncConnection: (provider: SupermemoryProvider) =>
		ipcRenderer.invoke("sync-connection", provider),
	deleteConnection: (provider: SupermemoryProvider) =>
		ipcRenderer.invoke("delete-connection", provider),
	listConnectionDocuments: (provider: SupermemoryProvider) =>
		ipcRenderer.invoke("list-connection-documents", provider),
	openExternalUrl: (url: string) => ipcRenderer.invoke("open-external-url", url),

	// Call Assist (Deepgram)
	callAssistStart: (payload) => ipcRenderer.invoke("call-assist-start", payload),
	callAssistStop: (sessionId: string) => ipcRenderer.invoke("call-assist-stop", sessionId),
	callAssistGetActiveSession: () => ipcRenderer.invoke("call-assist-get-active-session"),
	callAssistSendAudioFrame: (payload: { sessionId: string; pcm: ArrayBuffer }) => {
		ipcRenderer.send("call-assist-audio-frame", payload);
	},
	onCallAssistStatus: (callback: (evt: CallAssistStatusEvent) => void) => {
		const subscription = (_: IpcRendererEvent, evt: CallAssistStatusEvent) => callback(evt);
		ipcRenderer.on("call-assist-status", subscription);
		return () => ipcRenderer.removeListener("call-assist-status", subscription);
	},
	onCallAssistCaption: (callback: (evt: CallAssistCaptionEvent) => void) => {
		const subscription = (_: IpcRendererEvent, evt: CallAssistCaptionEvent) => callback(evt);
		ipcRenderer.on("call-assist-caption", subscription);
		return () => ipcRenderer.removeListener("call-assist-caption", subscription);
	},
	onCallAssistUtterance: (callback: (evt: CallAssistUtteranceEvent) => void) => {
		const subscription = (_: IpcRendererEvent, evt: CallAssistUtteranceEvent) => callback(evt);
		ipcRenderer.on("call-assist-utterance", subscription);
		return () => ipcRenderer.removeListener("call-assist-utterance", subscription);
	},
	onCallAssistMetadata: (callback: (evt: CallAssistMetadataEvent) => void) => {
		const subscription = (_: IpcRendererEvent, evt: CallAssistMetadataEvent) => callback(evt);
		ipcRenderer.on("call-assist-metadata", subscription);
		return () => ipcRenderer.removeListener("call-assist-metadata", subscription);
	},
	onCallAssistSuggestion: (callback: (evt: CallAssistSuggestionEvent) => void) => {
		const subscription = (_: IpcRendererEvent, evt: CallAssistSuggestionEvent) => callback(evt);
		ipcRenderer.on("call-assist-suggestion", subscription);
		return () => ipcRenderer.removeListener("call-assist-suggestion", subscription);
	},
	onCallAssistSummary: (callback: (evt: CallAssistSummaryEvent) => void) => {
		const subscription = (_: IpcRendererEvent, evt: CallAssistSummaryEvent) => callback(evt);
		ipcRenderer.on("call-assist-summary", subscription);
		return () => ipcRenderer.removeListener("call-assist-summary", subscription);
	},
	onCallAssistError: (callback: (evt: CallAssistErrorEvent) => void) => {
		const subscription = (_: IpcRendererEvent, evt: CallAssistErrorEvent) => callback(evt);
		ipcRenderer.on("call-assist-error", subscription);
		return () => ipcRenderer.removeListener("call-assist-error", subscription);
	},
	onCallAssistStarted: (callback: (info: CallAssistSessionInfo) => void) => {
		const subscription = (_: IpcRendererEvent, info: CallAssistSessionInfo) => callback(info);
		ipcRenderer.on("call-assist-started", subscription);
		return () => ipcRenderer.removeListener("call-assist-started", subscription);
	},
	onCallAssistStopped: (callback: (evt: { sessionId: string }) => void) => {
		const subscription = (_: IpcRendererEvent, evt: { sessionId: string }) => callback(evt);
		ipcRenderer.on("call-assist-stopped", subscription);
		return () => ipcRenderer.removeListener("call-assist-stopped", subscription);
	},
} as ElectronAPI);
