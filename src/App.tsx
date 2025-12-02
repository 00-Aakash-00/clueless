import { ToastViewport } from "@radix-ui/react-toast";
import { useEffect, useRef, useState } from "react";
import { QueryClient, QueryClientProvider } from "react-query";
import Debug from "./_pages/Debug";
import Queue from "./_pages/Queue";
import Solutions from "./_pages/Solutions";
import { ToastProvider } from "./components/ui/toast";

// Type definitions for IPC event data
interface SolutionSuccessData {
	solution: {
		code: string;
		problem_statement: string;
		context?: string;
		suggested_responses?: string[];
		reasoning?: string;
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

interface DebugSuccessData {
	solution: {
		old_code: string;
		new_code: string;
		thoughts: string[];
		time_complexity: string;
		space_complexity: string;
	};
}

declare global {
	interface Window {
		electronAPI: {
			//RANDOM GETTER/SETTERS
			updateContentDimensions: (dimensions: {
				width: number;
				height: number;
			}) => Promise<void>;
			getScreenshots: () => Promise<Array<{ path: string; preview: string }>>;

			//GLOBAL EVENTS
			onUnauthorized: (callback: () => void) => () => void;
			onScreenshotTaken: (
				callback: (data: { path: string; preview: string }) => void,
			) => () => void;
			onProcessingNoScreenshots: (callback: () => void) => () => void;
			onResetView: (callback: () => void) => () => void;
			takeScreenshot: () => Promise<void>;

			//INITIAL SOLUTION EVENTS
			deleteScreenshot: (
				path: string,
			) => Promise<{ success: boolean; error?: string }>;
			onSolutionStart: (callback: () => void) => () => void;
			onSolutionError: (callback: (error: string) => void) => () => void;
			onSolutionSuccess: (
				callback: (data: SolutionSuccessData) => void,
			) => () => void;
			onProblemExtracted: (
				callback: (data: ProblemExtractedData) => void,
			) => () => void;

			onDebugSuccess: (
				callback: (data: DebugSuccessData) => void,
			) => () => void;

			onDebugStart: (callback: () => void) => () => void;
			onDebugError: (callback: (error: string) => void) => () => void;

			moveWindowLeft: () => Promise<void>;
			moveWindowRight: () => Promise<void>;
			moveWindowUp: () => Promise<void>;
			moveWindowDown: () => Promise<void>;
			quitApp: () => Promise<void>;

			// LLM Model Management
			getCurrentLlmConfig: () => Promise<{
				provider: string;
				model: string;
				visionModel: string;
				availableModels: string[];
			}>;
			getAvailableModels: () => Promise<string[]>;
			switchModel: (
				model: string,
			) => Promise<{ success: boolean; error?: string }>;
			testLlmConnection: () => Promise<{ success: boolean; error?: string }>;

			invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
		};
	}
}

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			staleTime: Infinity,
			cacheTime: Infinity,
		},
	},
});

const App: React.FC = () => {
	const [view, setView] = useState<"queue" | "solutions" | "debug">("queue");
	const [debugProcessing, setDebugProcessing] = useState(false);
	const containerRef = useRef<HTMLDivElement>(null);

	// Effect for height monitoring
	useEffect(() => {
		const cleanup = window.electronAPI.onResetView(() => {
			queryClient.invalidateQueries(["screenshots"]);
			queryClient.invalidateQueries(["problem_statement"]);
			queryClient.invalidateQueries(["solution"]);
			queryClient.invalidateQueries(["new_solution"]);
			setView("queue");
		});

		return () => {
			cleanup();
		};
	}, []);

	useEffect(() => {
		if (!containerRef.current) return;

		const updateHeight = () => {
			if (!containerRef.current) return;
			const height = containerRef.current.scrollHeight;
			const width = containerRef.current.scrollWidth;
			window.electronAPI?.updateContentDimensions({ width, height });
		};

		const resizeObserver = new ResizeObserver(() => {
			updateHeight();
		});

		// Initial height update
		updateHeight();

		// Observe for changes
		resizeObserver.observe(containerRef.current);

		// Also update height when view changes
		const mutationObserver = new MutationObserver(() => {
			updateHeight();
		});

		mutationObserver.observe(containerRef.current, {
			childList: true,
			subtree: true,
			attributes: true,
			characterData: true,
		});

		return () => {
			resizeObserver.disconnect();
			mutationObserver.disconnect();
		};
	}, []); // Re-run when view changes

	useEffect(() => {
		const cleanupFunctions = [
			window.electronAPI.onSolutionStart(() => {
				setView("solutions");
			}),

			window.electronAPI.onUnauthorized(() => {
				queryClient.removeQueries(["screenshots"]);
				queryClient.removeQueries(["solution"]);
				queryClient.removeQueries(["problem_statement"]);
				setView("queue");
			}),
			// Update this reset handler
			window.electronAPI.onResetView(() => {
				queryClient.removeQueries(["screenshots"]);
				queryClient.removeQueries(["solution"]);
				queryClient.removeQueries(["problem_statement"]);
				setView("queue");
			}),
			window.electronAPI.onProblemExtracted((data: ProblemExtractedData) => {
				if (view === "queue") {
					queryClient.invalidateQueries(["problem_statement"]);
					queryClient.setQueryData(["problem_statement"], data);
				}
			}),
		];
		return () => {
			for (const cleanup of cleanupFunctions) {
				cleanup();
			}
		};
	}, [view]);

	return (
		<div ref={containerRef} className="min-h-0">
			<QueryClientProvider client={queryClient}>
				<ToastProvider>
					{view === "queue" ? (
						<Queue setView={setView} />
					) : view === "solutions" ? (
						<Solutions setView={setView} />
					) : view === "debug" ? (
						<Debug
							isProcessing={debugProcessing}
							setIsProcessing={setDebugProcessing}
						/>
					) : null}
					<ToastViewport />
				</ToastProvider>
			</QueryClientProvider>
		</div>
	);
};

export default App;
