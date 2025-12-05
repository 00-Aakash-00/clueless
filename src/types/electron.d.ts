// Type definitions for IPC event data
interface DebugSuccessData {
	solution: {
		old_code: string;
		new_code: string;
		thoughts: string[];
		time_complexity: string;
		space_complexity: string;
	};
}

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

interface SolutionSuccessData {
	solution: {
		code: string;
		problem_statement: string;
		context?: string;
		suggested_responses?: string[];
		reasoning?: string;
	};
}

export interface ElectronAPI {
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

declare global {
	interface Window {
		electronAPI: ElectronAPI;
	}
}
