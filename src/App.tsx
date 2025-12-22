import { useEffect, useRef, useState } from "react";
import { QueryClient, QueryClientProvider } from "react-query";
import Queue from "./_pages/Queue";
import Solutions from "./_pages/Solutions";
import { ToastProvider, ToastViewport } from "./components/ui/toast";

// Type definitions are in vite-env.d.ts

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			staleTime: Infinity,
			cacheTime: Infinity,
		},
	},
});

const App: React.FC = () => {
	const [view, setView] = useState<"queue" | "solutions">("queue");
	const [pendingSolutionError, setPendingSolutionError] = useState<string | null>(
		null,
	);
	const containerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		let cancelled = false;
		window.electronAPI
			.getCurrentView()
			.then((currentView) => {
				if (cancelled) return;
				setView(currentView);
			})
			.catch(() => {
				// ignore
			});
		return () => {
			cancelled = true;
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
	}, []);

	useEffect(() => {
		const cleanupFunctions = [
			window.electronAPI.onSolutionStart(() => {
				setPendingSolutionError(null);
				setView("solutions");
			}),
			window.electronAPI.onSolutionSuccess((data: SolutionSuccessData) => {
				if (!data?.solution) return;
				const solutionData = {
					code: data.solution.code,
					thoughts: data.solution.suggested_responses || [],
					time_complexity: "N/A",
					space_complexity: "N/A",
				};
				queryClient.setQueryData(["solution"], solutionData);
			}),
			window.electronAPI.onSolutionError((error: string) => {
				setPendingSolutionError(error);
				queryClient.removeQueries(["solution"]);
				queryClient.removeQueries(["new_solution"]);
				queryClient.removeQueries(["problem_statement"]);
				setView("queue");
			}),

			window.electronAPI.onUnauthorized(() => {
				setPendingSolutionError(null);
				queryClient.removeQueries(["screenshots"]);
				queryClient.removeQueries(["extras"]);
				queryClient.removeQueries(["solution"]);
				queryClient.removeQueries(["new_solution"]);
				queryClient.removeQueries(["problem_statement"]);
				setView("queue");
			}),
			// Update this reset handler
			window.electronAPI.onResetView(() => {
				setPendingSolutionError(null);
				queryClient.removeQueries(["screenshots"]);
				queryClient.removeQueries(["extras"]);
				queryClient.removeQueries(["solution"]);
				queryClient.removeQueries(["new_solution"]);
				queryClient.removeQueries(["problem_statement"]);
				setView("queue");
			}),
			window.electronAPI.onProblemExtracted((data: ProblemExtractedData) => {
				queryClient.setQueryData(["problem_statement"], data);
			}),
		];
		return () => {
			for (const cleanup of cleanupFunctions) {
				cleanup();
			}
		};
	}, []);

	return (
		<div ref={containerRef} className="min-h-0">
			<QueryClientProvider client={queryClient}>
				<ToastProvider>
					{view === "queue" ? (
						<Queue
							pendingSolutionError={pendingSolutionError}
							onConsumeSolutionError={() => setPendingSolutionError(null)}
						/>
					) : view === "solutions" ? (
						<Solutions />
					) : null}
					<ToastViewport />
				</ToastProvider>
			</QueryClientProvider>
		</div>
	);
};

export default App;
