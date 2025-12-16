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
	deleteDocument: (
		documentId: string,
	) => Promise<{ success: boolean; error?: string }>;
	getDocuments: () => Promise<StoredDocument[]>;
	getUserProfile: () => Promise<{
		static: string[];
		dynamic: string[];
	} | null>;
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
	deleteDocument: (documentId: string) =>
		ipcRenderer.invoke("delete-document", documentId),
	getDocuments: () => ipcRenderer.invoke("get-documents"),
	getUserProfile: () => ipcRenderer.invoke("get-user-profile"),
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
} as ElectronAPI);
