import type React from "react";
import { useEffect, useState } from "react";

interface ModelConfig {
	model: string;
	visionModel: string;
	availableModels: string[];
}

interface ModelSelectorProps {
	onModelChange?: (model: string) => void;
	onChatOpen?: () => void;
}

const ModelSelector: React.FC<ModelSelectorProps> = ({
	onModelChange,
	onChatOpen,
}) => {
	const [currentConfig, setCurrentConfig] = useState<ModelConfig | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [connectionStatus, setConnectionStatus] = useState<
		"testing" | "success" | "error" | null
	>(null);
	const [errorMessage, setErrorMessage] = useState<string>("");
	const [selectedModel, setSelectedModel] =
		useState<string>("openai/gpt-oss-20b");

	const loadCurrentConfig = async () => {
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
	};

	useEffect(() => {
		loadCurrentConfig();
	}, []);

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
				return "text-yellow-600";
			case "success":
				return "text-green-600";
			case "error":
				return "text-red-600";
			default:
				return "text-gray-600";
		}
	};

	const getStatusText = () => {
		switch (connectionStatus) {
			case "testing":
				return "Testing connection...";
			case "success":
				return "Connected successfully";
			case "error":
				return `Error: ${errorMessage}`;
			default:
				return "Ready";
		}
	};

	const getModelDisplayName = (model: string) => {
		switch (model) {
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
			<div className="p-4 glass-card">
				<div className="text-sm text-gray-600">
					Loading model configuration...
				</div>
			</div>
		);
	}

	return (
		<div className="p-4 glass-card space-y-4">
			<div className="flex items-center justify-between">
				<h3 className="text-sm font-semibold text-gray-800">
					AI Model Selection
				</h3>
				<div className={`text-xs ${getStatusColor()}`}>{getStatusText()}</div>
			</div>

			{/* Current Status */}
			{currentConfig && (
				<div className="text-xs text-gray-600 bg-white/30 p-2 rounded-lg space-y-1">
					<div>Text Model: {getModelDisplayName(currentConfig.model)}</div>
					<div>Vision Model: {currentConfig.visionModel}</div>
				</div>
			)}

			{/* Model Selection */}
			<div className="space-y-2">
				<label className="text-xs font-medium text-gray-700">Text Model</label>
				<div className="flex gap-2">
					<button
						onClick={() => setSelectedModel("openai/gpt-oss-20b")}
						className={`flex-1 px-3 py-2 rounded-xl text-xs transition-all ${
							selectedModel === "openai/gpt-oss-20b"
								? "bg-blue-500/90 text-white shadow-md"
								: "bg-white/30 text-gray-700 hover:bg-white/50"
						}`}
					>
						GPT-OSS 20B (Fast)
					</button>
					<button
						onClick={() => setSelectedModel("openai/gpt-oss-120b")}
						className={`flex-1 px-3 py-2 rounded-xl text-xs transition-all ${
							selectedModel === "openai/gpt-oss-120b"
								? "bg-purple-500/90 text-white shadow-md"
								: "bg-white/30 text-gray-700 hover:bg-white/50"
						}`}
					>
						GPT-OSS 120B (Powerful)
					</button>
				</div>
			</div>

			{/* Vision Model Info */}
			<div className="text-xs text-gray-600 bg-white/30 p-2 rounded-lg">
				Vision: Llama 4 Scout 17B (used for image analysis)
			</div>

			{/* Action buttons */}
			<div className="flex gap-2 pt-2">
				<button
					onClick={handleModelSwitch}
					disabled={
						connectionStatus === "testing" ||
						selectedModel === currentConfig?.model
					}
					className="flex-1 px-3 py-2 bg-blue-500/90 hover:bg-blue-600/90 disabled:bg-gray-400/80 text-white text-xs rounded-xl transition-all shadow-md backdrop-blur-sm"
				>
					{connectionStatus === "testing" ? "Switching..." : "Apply Changes"}
				</button>

				<button
					onClick={testConnection}
					disabled={connectionStatus === "testing"}
					className="px-3 py-2 bg-gray-600/80 hover:bg-gray-700/80 disabled:bg-gray-400/80 text-white text-xs rounded-xl transition-all shadow-md backdrop-blur-sm"
				>
					Test
				</button>
			</div>

			{/* Help text */}
			<div className="text-xs text-gray-600 space-y-1">
				<div>GPT-OSS 20B: Faster responses, good for most tasks</div>
				<div>GPT-OSS 120B: More powerful, better for complex problems</div>
			</div>
		</div>
	);
};

export default ModelSelector;
