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
	onSolutionSuccess: (callback: (data: SolutionSuccessData) => void) => () => void;

	onUnauthorized: (callback: () => void) => () => void;
	onDebugError: (callback: (error: string) => void) => () => void;
	takeScreenshot: () => Promise<void>;
	moveWindowLeft: () => Promise<void>;
	moveWindowRight: () => Promise<void>;
	moveWindowUp: () => Promise<void>;
	moveWindowDown: () => Promise<void>;
	analyzeImageFile: (
		path: string,
	) => Promise<{ text: string; timestamp: number }>;
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

	invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
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
		const subscription = (_: IpcRendererEvent, error: string) => callback(error);
		ipcRenderer.on(PROCESSING_EVENTS.DEBUG_ERROR, subscription);
		return () => {
			ipcRenderer.removeListener(PROCESSING_EVENTS.DEBUG_ERROR, subscription);
		};
	},
	onSolutionError: (callback: (error: string) => void) => {
		const subscription = (_: IpcRendererEvent, error: string) => callback(error);
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
	moveWindowLeft: () => ipcRenderer.invoke("move-window-left"),
	moveWindowRight: () => ipcRenderer.invoke("move-window-right"),
	moveWindowUp: () => ipcRenderer.invoke("move-window-up"),
	moveWindowDown: () => ipcRenderer.invoke("move-window-down"),
	analyzeImageFile: (path: string) =>
		ipcRenderer.invoke("analyze-image-file", path),
	quitApp: () => ipcRenderer.invoke("quit-app"),

	// LLM Model Management
	getCurrentLlmConfig: () => ipcRenderer.invoke("get-current-llm-config"),
	getAvailableModels: () => ipcRenderer.invoke("get-available-models"),
	switchModel: (model: string) => ipcRenderer.invoke("switch-model", model),
	testLlmConnection: () => ipcRenderer.invoke("test-llm-connection"),

	invoke: (channel: string, ...args: unknown[]) =>
		ipcRenderer.invoke(channel, ...args),
} as ElectronAPI);
