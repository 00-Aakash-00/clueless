// Solutions.tsx
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "react-query";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { dracula } from "react-syntax-highlighter/dist/esm/styles/prism";

import ScreenshotQueue from "../components/Queue/ScreenshotQueue";
import SolutionCommands from "../components/Solutions/SolutionCommands";
import {
	Toast,
	ToastDescription,
	type ToastMessage,
	ToastTitle,
	type ToastVariant,
} from "../components/ui/toast";
import type { ProblemStatementData } from "../types/solutions";
import Debug from "./Debug";

// (Using global ElectronAPI type from src/types/electron.d.ts)

export const ContentSection = ({
	title,
	content,
	isLoading,
}: {
	title: string;
	content: React.ReactNode;
	isLoading: boolean;
}) => (
	<div className="space-y-2">
		<h2 className="text-[13px] font-medium text-white/95 tracking-wide">
			{title}
		</h2>
		{isLoading ? (
			<div className="mt-4 flex">
				<p className="text-xs text-gray-300/80">
					Extracting problem statement...
				</p>
			</div>
		) : (
			<div className="text-[13px] leading-[1.5] text-gray-100/90 max-w-[600px]">
				{content}
			</div>
		)}
	</div>
);
const SolutionSection = ({
	title,
	content,
	isLoading,
}: {
	title: string;
	content: React.ReactNode;
	isLoading: boolean;
}) => (
	<div className="space-y-2">
		<h2 className="text-[13px] font-medium text-white/95 tracking-wide">
			{title}
		</h2>
		{isLoading ? (
			<div className="space-y-1.5">
				<div className="mt-4 flex">
					<p className="text-xs text-gray-300/80">Loading solutions...</p>
				</div>
			</div>
		) : (
			<div className="w-full rounded-lg overflow-hidden">
				<SyntaxHighlighter
					showLineNumbers
					language="python"
					style={dracula}
					customStyle={{
						maxWidth: "100%",
						margin: 0,
						padding: "1rem",
						whiteSpace: "pre-wrap",
						wordBreak: "break-all",
						borderRadius: "12px",
					}}
					wrapLongLines={true}
				>
					{content as string}
				</SyntaxHighlighter>
			</div>
		)}
	</div>
);

export const ComplexitySection = ({
	timeComplexity,
	spaceComplexity,
	isLoading,
}: {
	timeComplexity: string | null;
	spaceComplexity: string | null;
	isLoading: boolean;
}) => (
	<div className="space-y-2">
		<h2 className="text-[13px] font-medium text-white/95 tracking-wide">
			Complexity
		</h2>
		{isLoading ? (
			<p className="text-xs text-gray-300/80">Calculating complexity...</p>
		) : (
			<div className="space-y-1">
				<div className="flex items-start gap-2 text-[13px] leading-[1.5] text-gray-100/90">
					<div className="w-1.5 h-1.5 rounded-full bg-blue-400/80 mt-1.5 shrink-0" />
					<div>
						<strong className="text-white/95">Time:</strong> {timeComplexity}
					</div>
				</div>
				<div className="flex items-start gap-2 text-[13px] leading-[1.5] text-gray-100/90">
					<div className="w-1.5 h-1.5 rounded-full bg-blue-400/80 mt-1.5 shrink-0" />
					<div>
						<strong className="text-white/95">Space:</strong> {spaceComplexity}
					</div>
				</div>
			</div>
		)}
	</div>
);

interface SolutionsProps {
	setView: React.Dispatch<
		React.SetStateAction<"queue" | "solutions" | "debug">
	>;
}
const Solutions: React.FC<SolutionsProps> = ({ setView }) => {
	const queryClient = useQueryClient();
	const contentRef = useRef<HTMLDivElement>(null);

	const [debugProcessing, setDebugProcessing] = useState(false);
	const [problemStatementData, setProblemStatementData] =
		useState<ProblemStatementData | null>(null);
	const [solutionData, setSolutionData] = useState<string | null>(null);
	const [thoughtsData, setThoughtsData] = useState<string[] | null>(null);
	const [timeComplexityData, setTimeComplexityData] = useState<string | null>(
		null,
	);
	const [spaceComplexityData, setSpaceComplexityData] = useState<string | null>(
		null,
	);
	const [_customContent, setCustomContent] = useState<string | null>(null);

	const [toastOpen, setToastOpen] = useState(false);
	const [toastMessage, setToastMessage] = useState<ToastMessage>({
		title: "",
		description: "",
		variant: "neutral",
	});

	const [isTooltipVisible, setIsTooltipVisible] = useState(false);
	const [tooltipHeight, setTooltipHeight] = useState(0);

	const [isResetting, setIsResetting] = useState(false);

	const { data: extraScreenshots = [], refetch } = useQuery<
		Array<{ path: string; preview: string }>,
		Error
	>(
		["extras"],
		async () => {
			try {
				const existing = await window.electronAPI.getScreenshots();
				return existing;
			} catch (error) {
				console.error("Error loading extra screenshots:", error);
				return [];
			}
		},
		{
			staleTime: Infinity,
			cacheTime: Infinity,
		},
	);

	const showToast = useCallback(
		(title: string, description: string, variant: ToastVariant) => {
			setToastMessage({ title, description, variant });
			setToastOpen(true);
		},
		[],
	);

	const handleDeleteExtraScreenshot = async (index: number) => {
		const screenshotToDelete = extraScreenshots[index];

		try {
			const response = await window.electronAPI.deleteScreenshot(
				screenshotToDelete.path,
			);

			if (response.success) {
				refetch(); // Refetch screenshots instead of managing state directly
			} else {
				console.error("Failed to delete extra screenshot:", response.error);
			}
		} catch (error) {
			console.error("Error deleting extra screenshot:", error);
		}
	};

	useEffect(() => {
		// Height update logic
		const updateDimensions = () => {
			if (contentRef.current) {
				let contentHeight = contentRef.current.scrollHeight;
				const contentWidth = contentRef.current.scrollWidth;
				if (isTooltipVisible) {
					contentHeight += tooltipHeight;
				}
				window.electronAPI.updateContentDimensions({
					width: contentWidth,
					height: contentHeight,
				});
			}
		};

		// Initialize resize observer
		const resizeObserver = new ResizeObserver(updateDimensions);
		if (contentRef.current) {
			resizeObserver.observe(contentRef.current);
		}
		updateDimensions();

		// Set up event listeners
		const cleanupFunctions = [
			window.electronAPI.onScreenshotTaken(() => refetch()),
			window.electronAPI.onResetView(() => {
				// Set resetting state first
				setIsResetting(true);

				// Clear the queries
				queryClient.removeQueries(["solution"]);
				queryClient.removeQueries(["new_solution"]);

				// Reset other states
				refetch();

				// After a small delay, clear the resetting state
				setTimeout(() => {
					setIsResetting(false);
				}, 0);
			}),
			window.electronAPI.onSolutionStart(async () => {
				// Reset UI state for a new solution
				setSolutionData(null);
				setThoughtsData(null);
				setTimeComplexityData(null);
				setSpaceComplexityData(null);
				setCustomContent(null);
			}),
			//if there was an error processing the initial solution
			window.electronAPI.onSolutionError((error: string) => {
				showToast(
					"Processing Failed",
					"There was an error processing your extra screenshots.",
					"error",
				);
				// Reset solutions in the cache (even though this shouldn't ever happen) and complexities to previous states
				const solution = queryClient.getQueryData(["solution"]) as {
					code: string;
					thoughts: string[];
					time_complexity: string;
					space_complexity: string;
				} | null;
				if (!solution) {
					setView("queue"); //make sure that this is correct. or like make sure there's a toast or something
				}
				setSolutionData(solution?.code || null);
				setThoughtsData(solution?.thoughts || null);
				setTimeComplexityData(solution?.time_complexity || null);
				setSpaceComplexityData(solution?.space_complexity || null);
				console.error("Processing error:", error);
			}),
			//when the initial solution is generated, we'll set the solution data to that
			window.electronAPI.onSolutionSuccess((data) => {
				if (!data?.solution) {
					console.warn("Received empty or invalid solution data");
					return;
				}

				// Map backend fields to frontend expected structure
				// Backend returns: code, problem_statement, context, suggested_responses, reasoning
				// Frontend expects: code, thoughts, time_complexity, space_complexity
				const solutionData = {
					code: data.solution.code,
					thoughts: data.solution.suggested_responses || [], // Map suggested_responses to thoughts
					time_complexity: "N/A", // Not provided by current backend
					space_complexity: "N/A", // Not provided by current backend
				};

				queryClient.setQueryData(["solution"], solutionData);
				setSolutionData(solutionData.code || null);
				setThoughtsData(solutionData.thoughts || null);
				setTimeComplexityData(solutionData.time_complexity || null);
				setSpaceComplexityData(solutionData.space_complexity || null);
			}),

			//########################################################
			//DEBUG EVENTS
			//########################################################
			window.electronAPI.onDebugStart(() => {
				//we'll set the debug processing state to true and use that to render a little loader
				setDebugProcessing(true);
			}),
			//the first time debugging works, we'll set the view to debug and populate the cache with the data
			window.electronAPI.onDebugSuccess((data) => {
				queryClient.setQueryData(["new_solution"], data.solution);
				setDebugProcessing(false);
			}),
			//when there was an error in the initial debugging, we'll show a toast and stop the little generating pulsing thing.
			window.electronAPI.onDebugError(() => {
				showToast(
					"Processing Failed",
					"There was an error debugging your code.",
					"error",
				);
				setDebugProcessing(false);
			}),
			window.electronAPI.onProcessingNoScreenshots(() => {
				showToast(
					"No Screenshots",
					"There are no extra screenshots to process.",
					"neutral",
				);
			}),
		];

		return () => {
			resizeObserver.disconnect();
			for (const cleanup of cleanupFunctions) {
				cleanup();
			}
		};
	}, [
		isTooltipVisible,
		tooltipHeight,
		queryClient.getQueryData,
		queryClient.removeQueries,
		queryClient.setQueryData, // Reset other states
		refetch,
		setView,
		showToast,
	]);

	useEffect(() => {
		setProblemStatementData(
			queryClient.getQueryData(["problem_statement"]) || null,
		);
		setSolutionData(queryClient.getQueryData(["solution"]) || null);

		const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
			if (event?.query.queryKey[0] === "problem_statement") {
				setProblemStatementData(
					queryClient.getQueryData(["problem_statement"]) || null,
				);
			}
			if (event?.query.queryKey[0] === "solution") {
				const solution = queryClient.getQueryData(["solution"]) as {
					code: string;
					thoughts: string[];
					time_complexity: string;
					space_complexity: string;
				} | null;

				setSolutionData(solution?.code ?? null);
				setThoughtsData(solution?.thoughts ?? null);
				setTimeComplexityData(solution?.time_complexity ?? null);
				setSpaceComplexityData(solution?.space_complexity ?? null);
			}
		});
		return () => unsubscribe();
	}, [queryClient]);

	const handleTooltipVisibilityChange = (visible: boolean, height: number) => {
		setIsTooltipVisible(visible);
		setTooltipHeight(height);
	};

	return (
		<>
			{!isResetting && queryClient.getQueryData(["new_solution"]) ? (
				<Debug
					isProcessing={debugProcessing}
					setIsProcessing={setDebugProcessing}
				/>
			) : (
				<div ref={contentRef} className="relative space-y-3 px-4 py-3">
					<Toast
						open={toastOpen}
						onOpenChange={setToastOpen}
						variant={toastMessage.variant}
						duration={3000}
					>
						<ToastTitle>{toastMessage.title}</ToastTitle>
						<ToastDescription>{toastMessage.description}</ToastDescription>
					</Toast>

					{/* Conditionally render the screenshot queue if solutionData is available */}
					{solutionData && (
						<div className="bg-transparent w-fit">
							<div className="pb-3">
								<div className="space-y-3 w-fit">
									<ScreenshotQueue
										isLoading={debugProcessing}
										screenshots={extraScreenshots}
										onDeleteScreenshot={handleDeleteExtraScreenshot}
									/>
								</div>
							</div>
						</div>
					)}

					{/* Navbar of commands with the SolutionsHelper */}
					<SolutionCommands
						extraScreenshots={extraScreenshots}
						onTooltipVisibilityChange={handleTooltipVisibilityChange}
					/>

					{/* Main Content - Modified width constraints */}
					<div className="w-full text-sm glass-card-dark">
						<div className="rounded-xl overflow-hidden">
							<div className="px-4 py-4 space-y-4 max-w-full">
								{/* Show Screenshot Result as main output if validation_type is manual */}
								{problemStatementData?.validation_type === "manual" ? (
									<ContentSection
										title="Screenshot Result"
										content={problemStatementData.problem_statement}
										isLoading={false}
									/>
								) : (
									<>
										{/* Problem Statement Section - Only for non-manual */}
										<ContentSection
											title="Problem Statement"
											content={problemStatementData?.problem_statement}
											isLoading={!problemStatementData}
										/>
										{/* Show loading state when waiting for solution */}
										{problemStatementData && !solutionData && (
											<div className="mt-4 flex">
												<p className="text-xs text-gray-300/80">
													Generating solutions...
												</p>
											</div>
										)}
										{/* Solution Sections (legacy, only for non-manual) */}
										{solutionData && (
											<>
												<ContentSection
													title="Analysis"
													content={
														thoughtsData && (
															<div className="space-y-3">
																<div className="space-y-1">
																	{thoughtsData.map((thought, index) => (
																		<div
																			key={`thought-${index}-${thought.substring(0, 20)}`}
																			className="flex items-start gap-2"
																		>
																			<div className="w-1 h-1 rounded-full bg-blue-400/80 mt-2 shrink-0" />
																			<div>{thought}</div>
																		</div>
																	))}
																</div>
															</div>
														)
													}
													isLoading={!thoughtsData}
												/>
												<SolutionSection
													title="Solution"
													content={solutionData}
													isLoading={!solutionData}
												/>
												{timeComplexityData &&
													timeComplexityData !== "N/A" &&
													spaceComplexityData &&
													spaceComplexityData !== "N/A" && (
														<ComplexitySection
															timeComplexity={timeComplexityData}
															spaceComplexity={spaceComplexityData}
															isLoading={false}
														/>
													)}
											</>
										)}
									</>
								)}
							</div>
						</div>
					</div>
				</div>
			)}
		</>
	);
};

export default Solutions;
