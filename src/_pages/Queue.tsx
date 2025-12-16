import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "react-query";
import QueueCommands from "../components/Queue/QueueCommands";
import ScreenshotQueue from "../components/Queue/ScreenshotQueue";
import CustomizePanel from "../components/ui/CustomizePanel";
import { HelpPanel } from "../components/ui/HelpModal";
import MarkdownRenderer from "../components/ui/MarkdownRenderer";
import ModelSelector from "../components/ui/ModelSelector";
import {
	Toast,
	ToastDescription,
	type ToastMessage,
	ToastTitle,
	type ToastVariant,
} from "../components/ui/toast";

interface QueueProps {
	setView: React.Dispatch<
		React.SetStateAction<"queue" | "solutions">
	>;
}

const Queue: React.FC<QueueProps> = ({ setView }) => {
	const [toastOpen, setToastOpen] = useState(false);
	const [toastMessage, setToastMessage] = useState<ToastMessage>({
		title: "",
		description: "",
		variant: "neutral",
	});

	const contentRef = useRef<HTMLDivElement>(null);

	const [chatInput, setChatInput] = useState("");
	const [chatMessages, setChatMessages] = useState<
		{ role: "user" | "assistant"; text: string }[]
	>([]);
	const [chatLoading, setChatLoading] = useState(false);
	const [isChatOpen, setIsChatOpen] = useState(false);
	const chatInputRef = useRef<HTMLInputElement>(null);

	const [isSettingsOpen, setIsSettingsOpen] = useState(false);
	const [isCustomizeOpen, setIsCustomizeOpen] = useState(false);
	const [isHelpOpen, setIsHelpOpen] = useState(false);
	const [currentModel, setCurrentModel] = useState<{
		provider: string;
		model: string;
	}>({ provider: "groq", model: "openai/gpt-oss-20b" });

	const barRef = useRef<HTMLDivElement>(null);

	const showToast = useCallback(
		(title: string, description: string, variant: ToastVariant) => {
			setToastMessage({ title, description, variant });
			setToastOpen(true);
		},
		[],
	);

	const { data: screenshots = [], refetch } = useQuery<
		Array<{ path: string; preview: string }>,
		Error
	>(
		["screenshots"],
		async () => {
			try {
				const existing = await window.electronAPI.getScreenshots();
				return existing;
			} catch (error) {
				console.error("Error loading screenshots:", error);
				showToast("Error", "Failed to load existing screenshots", "error");
				return [];
			}
		},
		{
			staleTime: Infinity,
			cacheTime: Infinity,
			refetchOnWindowFocus: true,
			refetchOnMount: true,
		},
	);

	const handleDeleteScreenshot = async (index: number) => {
		const screenshotToDelete = screenshots[index];

		try {
			const response = await window.electronAPI.deleteScreenshot(
				screenshotToDelete.path,
			);

			if (response.success) {
				refetch();
			} else {
				console.error("Failed to delete screenshot:", response.error);
				showToast("Error", "Failed to delete the screenshot file", "error");
			}
		} catch (error) {
			console.error("Error deleting screenshot:", error);
		}
	};

	const handleChatSend = async () => {
		if (!chatInput.trim()) return;
		setChatMessages((msgs) => [...msgs, { role: "user", text: chatInput }]);
		setChatLoading(true);
		setChatInput("");
		try {
			const response = await window.electronAPI.groqChat(chatInput);
			setChatMessages((msgs) => [
				...msgs,
				{ role: "assistant", text: String(response) },
			]);
		} catch (err) {
			setChatMessages((msgs) => [
				...msgs,
				{ role: "assistant", text: `Error: ${String(err)}` },
			]);
		} finally {
			setChatLoading(false);
			chatInputRef.current?.focus();
		}
	};

	// Load current model configuration on mount
	useEffect(() => {
		const loadCurrentModel = async () => {
			try {
				const config = await window.electronAPI.getCurrentLlmConfig();
				setCurrentModel({ provider: config.provider, model: config.model });
			} catch (error) {
				console.error("Error loading current model config:", error);
			}
		};
		loadCurrentModel();
	}, []);

	useEffect(() => {
		const updateDimensions = () => {
			if (contentRef.current) {
				const contentHeight = contentRef.current.scrollHeight;
				const contentWidth = contentRef.current.scrollWidth;
				window.electronAPI.updateContentDimensions({
					width: contentWidth,
					height: contentHeight,
				});
			}
		};

		const resizeObserver = new ResizeObserver(updateDimensions);
		if (contentRef.current) {
			resizeObserver.observe(contentRef.current);
		}
		updateDimensions();

		const cleanupFunctions = [
			window.electronAPI.onResetView(() => refetch()),
			window.electronAPI.onSolutionError((error: string) => {
				showToast(
					"Processing Failed",
					"There was an error processing your screenshots.",
					"error",
				);
				setView("queue");
				console.error("Processing error:", error);
			}),
			window.electronAPI.onProcessingNoScreenshots(() => {
				showToast(
					"No Screenshots",
					"There are no screenshots to process.",
					"neutral",
				);
			}),
			window.electronAPI.onFocusChat(() => {
				setIsChatOpen(true);
				// Use setTimeout to ensure chat is rendered before focusing
				setTimeout(() => {
					chatInputRef.current?.focus();
				}, 50);
			}),
		];

		return () => {
			resizeObserver.disconnect();
			for (const cleanup of cleanupFunctions) {
				cleanup();
			}
		};
	}, [refetch, setView, showToast]);

	// Seamless screenshot-to-LLM flow
	useEffect(() => {
		// Listen for screenshot taken event
		const unsubscribe = window.electronAPI.onScreenshotTaken(async (data) => {
			// Surface chat immediately so the user sees the context grow
			setIsChatOpen(true);
			setChatMessages((msgs) => [
				...msgs,
				{
					role: "assistant",
					text: "📸 Added your screenshot to this session. Reading it now...",
				},
			]);

			// Refetch screenshots to update the queue
			await refetch();
			// Show loading in chat
			setChatLoading(true);
			try {
				// Get the latest screenshot path
				const latest =
					data?.path ||
					(Array.isArray(data) &&
						data.length > 0 &&
						data[data.length - 1]?.path);
				if (latest) {
					// Call the LLM to process the screenshot
					const response = (await window.electronAPI.analyzeImageFile(
						latest,
					)) as { text: string; timestamp: number };
					setChatMessages((msgs) => [
						...msgs,
						{ role: "assistant", text: response.text },
					]);
				} else {
					setChatMessages((msgs) => [
						...msgs,
						{
							role: "assistant",
							text: "I captured a screenshot but could not locate the file to analyze it.",
						},
					]);
				}
			} catch (err) {
				setChatMessages((msgs) => [
					...msgs,
					{
						role: "assistant",
						text: `Error while analyzing the screenshot: ${String(err)}`,
					},
				]);
			} finally {
				setChatLoading(false);
			}
		});
		return () => {
			unsubscribe?.();
		};
	}, [refetch]);

	const handleChatToggle = () => {
		setIsChatOpen(!isChatOpen);
	};

	const handleSettingsToggle = () => {
		setIsSettingsOpen(!isSettingsOpen);
		// Close other panels when opening settings
		if (!isSettingsOpen) {
			setIsCustomizeOpen(false);
			setIsHelpOpen(false);
		}
	};

	const handleCustomizeToggle = () => {
		setIsCustomizeOpen(!isCustomizeOpen);
		// Close other panels when opening customize
		if (!isCustomizeOpen) {
			setIsSettingsOpen(false);
			setIsHelpOpen(false);
		}
	};

	const handleHelpToggle = () => {
		setIsHelpOpen(!isHelpOpen);
		// Close other panels when opening help
		if (!isHelpOpen) {
			setIsSettingsOpen(false);
			setIsCustomizeOpen(false);
		}
	};

	const handleModelChange = (model: string) => {
		setCurrentModel({ provider: "groq", model });
		setChatMessages((msgs) => [
			...msgs,
			{
				role: "assistant",
				text: `🔄 Switched to ${model}. Ready for your questions!`,
			},
		]);
	};

	return (
		<div
			ref={barRef}
			style={{
				position: "relative",
				width: "100%",
				pointerEvents: "auto",
			}}
			className="select-none"
		>
			<div className="bg-transparent w-full">
				<div className="px-2 py-1">
					<Toast
						open={toastOpen}
						onOpenChange={setToastOpen}
						variant={toastMessage.variant}
						duration={3000}
					>
						<ToastTitle>{toastMessage.title}</ToastTitle>
						<ToastDescription>{toastMessage.description}</ToastDescription>
					</Toast>
					<div className="inline-block">
						<QueueCommands
							screenshots={screenshots}
							onChatToggle={handleChatToggle}
							onSettingsToggle={handleSettingsToggle}
							onCustomizeToggle={handleCustomizeToggle}
							onHelpToggle={handleHelpToggle}
						/>
					</div>
					{/* Screenshot Queue Display */}
					{screenshots.length > 0 && (
						<div className="mt-4">
							<ScreenshotQueue
								isLoading={false}
								screenshots={screenshots}
								onDeleteScreenshot={handleDeleteScreenshot}
							/>
						</div>
					)}
					{/* Conditional Settings Interface */}
					{isSettingsOpen && (
						<div className="mt-4 w-full mx-auto">
							<ModelSelector
								onModelChange={handleModelChange}
								onChatOpen={() => setIsChatOpen(true)}
							/>
						</div>
					)}

					{/* Conditional Customize Interface */}
					{isCustomizeOpen && (
						<div className="mt-4 w-full mx-auto">
							<CustomizePanel onClose={() => setIsCustomizeOpen(false)} />
						</div>
					)}

					{/* Conditional Help Panel */}
					{isHelpOpen && (
						<div className="mt-4 w-full mx-auto">
							<HelpPanel variant="queue" onClose={() => setIsHelpOpen(false)} />
						</div>
					)}

					{/* Conditional Chat Interface */}
					{isChatOpen && (
						<div className="mt-4 w-full mx-auto bg-black/60 backdrop-blur-xl border border-white/20 rounded-2xl p-4 flex flex-col">
							<div className="flex-1 overflow-y-auto mb-3 p-3 rounded-lg bg-white/5 max-h-64 min-h-[120px]">
								{chatMessages.length === 0 ? (
									<div className="text-xs text-white/60 text-center mt-8">
										Chat with {currentModel.model}
										<br />
										<span className="text-[10px] text-white/40">
											Take a screenshot (Cmd+H) for automatic analysis
										</span>
										<br />
										<span className="text-[10px] text-white/40">
											Click Models to switch AI models
										</span>
									</div>
								) : (
									chatMessages.map((msg, idx) => (
										<div
											key={`${msg.role}-${idx}-${msg.text.substring(0, 20)}`}
											className={`w-full flex ${msg.role === "user" ? "justify-end" : "justify-start"} mb-3`}
										>
											<div
												className={`max-w-[85%] px-3 py-2 rounded-lg ${
													msg.role === "user"
														? "bg-white/20 text-white ml-8"
														: "bg-white/5 text-white/90 mr-8"
												}`}
												style={{ wordBreak: "break-word" }}
											>
												{msg.role === "assistant" ? (
													<MarkdownRenderer
														content={msg.text}
														variant="glass"
														className="text-xs"
													/>
												) : (
													<span className="text-xs">{msg.text}</span>
												)}
											</div>
										</div>
									))
								)}
								{chatLoading && (
									<div className="flex justify-start mb-3">
										<div className="bg-white/5 text-white/90 px-3 py-2 rounded-lg mr-8">
											<span className="inline-flex items-center text-xs">
												<span className="loading-dots">
													<span className="text-white/40">●</span>
													<span className="text-white/40">●</span>
													<span className="text-white/40">●</span>
												</span>
												<span className="ml-2 text-white/50">
													{currentModel.model} is replying...
												</span>
											</span>
										</div>
									</div>
								)}
							</div>
							<form
								className="flex gap-2 items-center"
								onSubmit={(e) => {
									e.preventDefault();
									handleChatSend();
								}}
							>
								<input
									ref={chatInputRef}
									className="flex-1 rounded-lg px-3 py-2 bg-white/10 text-white text-xs placeholder-white/40 border border-white/20 focus:outline-none focus:border-white/40 transition-colors"
									placeholder="Type your message..."
									value={chatInput}
									onChange={(e) => setChatInput(e.target.value)}
									disabled={chatLoading}
								/>
								<button
									type="submit"
									className="p-2 rounded-lg bg-white/10 hover:bg-white/20 border border-white/20 flex items-center justify-center transition-colors disabled:opacity-50"
									disabled={chatLoading || !chatInput.trim()}
									tabIndex={-1}
									aria-label="Send"
								>
									<svg
										xmlns="http://www.w3.org/2000/svg"
										fill="none"
										viewBox="0 0 24 24"
										strokeWidth={2}
										stroke="currentColor"
										className="w-4 h-4 text-white/70"
										aria-hidden="true"
									>
										<path
											strokeLinecap="round"
											strokeLinejoin="round"
											d="M4.5 19.5l15-7.5-15-7.5v6l10 1.5-10 1.5v6z"
										/>
									</svg>
								</button>
							</form>
						</div>
					)}
				</div>
			</div>
		</div>
	);
};

export default Queue;
