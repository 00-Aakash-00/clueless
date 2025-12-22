import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "react-query";
import QueueCommands from "../components/Queue/QueueCommands";
import ScreenshotQueue from "../components/Queue/ScreenshotQueue";
import { CallAssistPanel } from "../components/ui/CallAssistPanel";
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
	pendingSolutionError?: string | null;
	onConsumeSolutionError?: () => void;
}

const Queue: React.FC<QueueProps> = ({
	pendingSolutionError,
	onConsumeSolutionError,
}) => {
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
	const [activeCallSession, setActiveCallSession] = useState<CallAssistSessionInfo | null>(
		null,
	);

	const [isCallAssistOpen, setIsCallAssistOpen] = useState(false);
	const [isSettingsOpen, setIsSettingsOpen] = useState(false);
	const [isCustomizeOpen, setIsCustomizeOpen] = useState(false);
	const [isHelpOpen, setIsHelpOpen] = useState(false);
	const [currentModel, setCurrentModel] = useState<{
		provider: string;
		model: string;
	}>({ provider: "groq", model: "openai/gpt-oss-20b" });
	const screenshotShortcut = useMemo(() => {
		const isMac =
			typeof navigator !== "undefined" &&
			/Mac|iPhone|iPad|iPod/.test(navigator.platform);
		return isMac ? "Cmd+Shift+H" : "Ctrl+H";
	}, []);

	const barRef = useRef<HTMLDivElement>(null);

	const showToast = useCallback(
		(title: string, description: string, variant: ToastVariant) => {
			setToastMessage({ title, description, variant });
			setToastOpen(true);
		},
		[],
	);

	useEffect(() => {
		if (!pendingSolutionError) return;
		showToast("Processing Failed", pendingSolutionError, "error");
		onConsumeSolutionError?.();
	}, [onConsumeSolutionError, pendingSolutionError, showToast]);

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
		const trimmed = chatInput.trim();
		if (!trimmed) return;

		if (trimmed === "/clear") {
			void handleClearChat();
			return;
		}
		setChatMessages((msgs) => [...msgs, { role: "user", text: trimmed }]);
		setChatLoading(true);
		setChatInput("");
		try {
			const response = await window.electronAPI.groqChat(trimmed);
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

	const handleClearChat = async () => {
		try {
			await window.electronAPI.resetChatHistory();
		} catch {
			// ignore
		}
		setChatMessages([]);
		setChatInput("");
		setChatLoading(false);
		showToast("Cleared", "Chat history cleared.", "neutral");
	};

	const handleWhatDoISay = async () => {
		setChatMessages((msgs) => [
			...msgs,
			{ role: "user", text: "What should I say next?" },
		]);
		setChatLoading(true);
		try {
			const result = await window.electronAPI.liveWhatDoISay();
			const reply = result.data;
			if (result.success && typeof reply === "string") {
				setChatMessages((msgs) => [
					...msgs,
					{ role: "assistant", text: reply },
				]);
			} else {
				setChatMessages((msgs) => [
					...msgs,
					{
						role: "assistant",
						text: `Error: ${result.error || "Unable to generate a live reply"}`,
					},
				]);
			}
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
			window.electronAPI.onScreenshotTaken(() => refetch()),
			window.electronAPI.onResetView(() => refetch()),
			window.electronAPI.onProcessingNoScreenshots(() => {
				showToast(
					"No Screenshots",
					"There are no screenshots to process.",
					"neutral",
				);
			}),
			window.electronAPI.onFocusChat(() => {
				setIsCallAssistOpen(false);
				setIsSettingsOpen(false);
				setIsCustomizeOpen(false);
				setIsHelpOpen(false);
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
	}, [refetch, showToast]);

	useEffect(() => {
		let cancelled = false;
		window.electronAPI
			.callAssistGetActiveSession()
			.then((session) => {
				if (cancelled) return;
				setActiveCallSession(session);
			})
			.catch(() => {
				// ignore
			});

		const unsubs = [
			window.electronAPI.onCallAssistStarted((info) => setActiveCallSession(info)),
			window.electronAPI.onCallAssistStopped(() => setActiveCallSession(null)),
		];

		return () => {
			cancelled = true;
			for (const unsub of unsubs) unsub();
		};
	}, []);

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
				setIsChatOpen((open) => {
					const next = !open;
					if (next) {
						setIsCallAssistOpen(false);
						setIsSettingsOpen(false);
						setIsCustomizeOpen(false);
						setIsHelpOpen(false);
					}
					return next;
				});
			};

			const handleCallAssistToggle = () => {
				setIsCallAssistOpen((open) => {
					const next = !open;
					if (next) {
						setIsChatOpen(false);
						setIsSettingsOpen(false);
						setIsCustomizeOpen(false);
						setIsHelpOpen(false);
					}
					return next;
				});
			};

			const handleSettingsToggle = () => {
				setIsSettingsOpen((open) => {
					const next = !open;
					if (next) {
						setIsChatOpen(false);
						setIsCustomizeOpen(false);
						setIsHelpOpen(false);
						setIsCallAssistOpen(false);
					}
					return next;
				});
			};

			const handleCustomizeToggle = () => {
				setIsCustomizeOpen((open) => {
					const next = !open;
					if (next) {
						setIsChatOpen(false);
						setIsSettingsOpen(false);
						setIsHelpOpen(false);
						setIsCallAssistOpen(false);
					}
					return next;
				});
			};

			const handleHelpToggle = () => {
				setIsHelpOpen((open) => {
					const next = !open;
					if (next) {
						setIsChatOpen(false);
						setIsSettingsOpen(false);
						setIsCustomizeOpen(false);
						setIsCallAssistOpen(false);
					}
					return next;
				});
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
								onCallAssistToggle={handleCallAssistToggle}
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
									onClearChat={() => void handleClearChat()}
								/>
							</div>
						)}

						{/* Conditional Call Assist Interface */}
						{isCallAssistOpen && (
							<div className="mt-4 w-full mx-auto">
								<CallAssistPanel onClose={() => setIsCallAssistOpen(false)} />
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
											Take a screenshot ({screenshotShortcut}) for automatic analysis
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
									type="button"
									onClick={() => void handleWhatDoISay()}
									disabled={chatLoading || !activeCallSession}
									title={
										activeCallSession
											? "Generate a speakable reply using the current call + your knowledge base"
											: "Start Call Assist to enable live replies"
									}
									className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 border border-white/20 text-[10px] text-white/80 disabled:opacity-50"
								>
									What do I say
								</button>
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
