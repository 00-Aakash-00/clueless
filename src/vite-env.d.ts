/// <reference types="vite/client" />

// Global type definitions for IPC event data
declare global {
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

	// Customization types
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

		// Call Assist (Deepgram)
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

		interface ElectronAPI {
		updateContentDimensions: (dimensions: {
			width: number;
			height: number;
		}) => Promise<void>;
		getScreenshots: () => Promise<Array<{ path: string; preview: string }>>;
		getCurrentView: () => Promise<"queue" | "solutions">;
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
		getDocumentStatus: (
			documentId: string,
		) => Promise<{
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
			callAssistStop: (
				sessionId: string,
			) => Promise<{ success: boolean; error?: string }>;
			callAssistGetActiveSession: () => Promise<CallAssistSessionInfo | null>;
			callAssistSendAudioFrame: (payload: {
				sessionId: string;
				pcm: ArrayBuffer;
			}) => void;
			onCallAssistStatus: (callback: (evt: CallAssistStatusEvent) => void) => () => void;
			onCallAssistCaption: (callback: (evt: CallAssistCaptionEvent) => void) => () => void;
			onCallAssistUtterance: (
				callback: (evt: CallAssistUtteranceEvent) => void,
			) => () => void;
			onCallAssistMetadata: (
				callback: (evt: CallAssistMetadataEvent) => void,
			) => () => void;
			onCallAssistSuggestion: (
				callback: (evt: CallAssistSuggestionEvent) => void,
			) => () => void;
			onCallAssistSummary: (
				callback: (evt: CallAssistSummaryEvent) => void,
			) => () => void;
			onCallAssistError: (callback: (evt: CallAssistErrorEvent) => void) => () => void;
			onCallAssistStarted: (
				callback: (info: CallAssistSessionInfo) => void,
			) => () => void;
			onCallAssistStopped: (
				callback: (evt: { sessionId: string }) => void,
			) => () => void;
		}

	interface Window {
		electronAPI: ElectronAPI;
	}
}

// This export makes this file a module, required for declare global
export {};
