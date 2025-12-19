import type React from "react";
import { useCallback, useEffect, useState } from "react";

interface ModelConfig {
	model: string;
	visionModel: string;
	availableModels: string[];
}

interface ModelSelectorProps {
	onModelChange?: (model: string) => void;
	onChatOpen?: () => void;
	onClearChat?: () => void;
}

const ModelSelector: React.FC<ModelSelectorProps> = ({
	onModelChange,
	onChatOpen,
	onClearChat,
}) => {
	const [currentConfig, setCurrentConfig] = useState<ModelConfig | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [connectionStatus, setConnectionStatus] = useState<
		"testing" | "success" | "error" | null
	>(null);
	const [errorMessage, setErrorMessage] = useState<string>("");
	const [selectedModel, setSelectedModel] =
		useState<string>("openai/gpt-oss-20b");

	const loadCurrentConfig = useCallback(async () => {
		try {
			setIsLoading(true);
			const config = await window.electronAPI.getCurrentLlmConfig();
			setCurrentConfig(config);
			setSelectedModel(config.model);
		} catch (error) {
			console.error("Error loading current config:", error);
		} finally {
			setIsLoading(false);
		}
	}, []);

	useEffect(() => {
		loadCurrentConfig();
	}, [loadCurrentConfig]);

	const testConnection = async () => {
		try {
			setConnectionStatus("testing");
			const result = await window.electronAPI.testLlmConnection();
			setConnectionStatus(result.success ? "success" : "error");
			if (!result.success) {
				setErrorMessage(result.error || "Unknown error");
			}
		} catch (error) {
			setConnectionStatus("error");
			setErrorMessage(String(error));
		}
	};

	const handleModelSwitch = async () => {
		try {
			setConnectionStatus("testing");
			const result = await window.electronAPI.switchModel(selectedModel);

			if (result.success) {
				await loadCurrentConfig();
				setConnectionStatus("success");
				onModelChange?.(selectedModel);
				// Auto-open chat window after successful model change
				setTimeout(() => {
					onChatOpen?.();
				}, 500);
			} else {
				setConnectionStatus("error");
				setErrorMessage(result.error || "Switch failed");
			}
		} catch (error) {
			setConnectionStatus("error");
			setErrorMessage(String(error));
		}
	};

	const getStatusColor = () => {
		switch (connectionStatus) {
			case "testing":
				return "text-yellow-300";
			case "success":
				return "text-green-300";
			case "error":
				return "text-red-300";
			default:
				return "text-white/50";
		}
	};

	const getStatusText = () => {
		switch (connectionStatus) {
			case "testing":
				return "Testing...";
			case "success":
				return "Connected";
			case "error":
				return `Error: ${errorMessage}`;
			default:
				return "Ready";
		}
	};

	const getModelDisplayName = (model: string) => {
		switch (model) {
			case "auto":
				return "Auto (Smart)";
			case "openai/gpt-oss-20b":
				return "GPT-OSS 20B (Fast)";
			case "openai/gpt-oss-120b":
				return "GPT-OSS 120B (Powerful)";
			default:
				return model;
		}
	};

	if (isLoading) {
		return (
			<div className="bg-black/60 backdrop-blur-xl border border-white/20 rounded-2xl p-4">
				<div className="text-xs text-white/60">
					Loading model configuration...
				</div>
			</div>
		);
	}

	return (
		<div className="bg-black/60 backdrop-blur-xl border border-white/20 rounded-2xl p-4 space-y-4">
			<div className="flex items-center justify-between">
				<h3 className="text-sm font-medium text-white/90">
					AI Model Selection
				</h3>
				<div className={`text-xs ${getStatusColor()}`}>{getStatusText()}</div>
			</div>

			{/* Current Status */}
			{currentConfig && (
				<div className="text-xs text-white/60 bg-white/5 p-2 rounded-lg space-y-1">
					<div>Text Model: {getModelDisplayName(currentConfig.model)}</div>
					<div>Vision Model: {currentConfig.visionModel}</div>
				</div>
			)}

			{/* Model Selection */}
			<div className="space-y-2">
				<span className="text-xs font-medium text-white/80 block">
					Text Model
				</span>
				<div className="flex gap-2">
					<button
						type="button"
						onClick={() => setSelectedModel("auto")}
						className={`flex-1 px-3 py-2 rounded-lg text-xs transition-all ${
							selectedModel === "auto"
								? "bg-white/20 text-white border border-white/30"
								: "bg-white/5 text-white/70 hover:bg-white/10"
						}`}
					>
						Auto (Smart)
					</button>
					<button
						type="button"
						onClick={() => setSelectedModel("openai/gpt-oss-20b")}
						className={`flex-1 px-3 py-2 rounded-lg text-xs transition-all ${
							selectedModel === "openai/gpt-oss-20b"
								? "bg-white/20 text-white border border-white/30"
								: "bg-white/5 text-white/70 hover:bg-white/10"
						}`}
					>
						GPT-OSS 20B (Fast)
					</button>
					<button
						type="button"
						onClick={() => setSelectedModel("openai/gpt-oss-120b")}
						className={`flex-1 px-3 py-2 rounded-lg text-xs transition-all ${
							selectedModel === "openai/gpt-oss-120b"
								? "bg-white/20 text-white border border-white/30"
								: "bg-white/5 text-white/70 hover:bg-white/10"
						}`}
					>
						GPT-OSS 120B (Powerful)
					</button>
				</div>
			</div>

			{/* Vision Model Info */}
			<div className="text-xs text-white/60 bg-white/5 p-2 rounded-lg">
				Vision: Llama 4 Scout 17B (used for image analysis)
			</div>

			{/* Action buttons */}
			<div className="flex gap-2 pt-2">
				<button
					type="button"
					onClick={handleModelSwitch}
					disabled={
						connectionStatus === "testing" ||
						selectedModel === currentConfig?.model
					}
					className="flex-1 px-3 py-2 bg-white/10 hover:bg-white/20 disabled:bg-white/5 disabled:text-white/30 text-white/90 text-xs rounded-lg transition-all"
				>
					{connectionStatus === "testing" ? "Switching..." : "Apply Changes"}
				</button>

				<button
					type="button"
					onClick={testConnection}
					disabled={connectionStatus === "testing"}
					className="px-3 py-2 bg-white/10 hover:bg-white/20 disabled:bg-white/5 disabled:text-white/30 text-white/90 text-xs rounded-lg transition-all"
				>
					Test
				</button>
			</div>

			<div className="flex gap-2">
				<button
					type="button"
					onClick={() => onClearChat?.()}
					className="flex-1 px-3 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-200 text-xs rounded-lg transition-all"
				>
					Clear chat history
				</button>
			</div>

			{/* Help text */}
			<div className="text-xs text-white/40 space-y-1">
				<div>Auto: Picks the best model per message</div>
				<div>GPT-OSS 20B: Faster responses, good for most tasks</div>
				<div>GPT-OSS 120B: More powerful, better for complex problems</div>
			</div>
		</div>
	);
};

export default ModelSelector;
