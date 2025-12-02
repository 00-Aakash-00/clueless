// src/components/ScreenshotItem.tsx

import { X } from "lucide-react";
import type React from "react";

interface Screenshot {
	path: string;
	preview: string;
}

interface ScreenshotItemProps {
	screenshot: Screenshot;
	onDelete: (index: number) => void;
	index: number;
	isLoading: boolean;
}

const ScreenshotItem: React.FC<ScreenshotItemProps> = ({
	screenshot,
	onDelete,
	index,
	isLoading,
}) => {
	const handleDelete = async () => {
		await onDelete(index);
	};

	return (
		<div
			className={`glass-card border border-white/30 relative overflow-hidden ${isLoading ? "" : "group"}`}
		>
			<div className="w-full h-full relative">
				{isLoading && (
					<div className="absolute inset-0 bg-black/40 backdrop-blur-sm z-10 flex items-center justify-center">
						<div className="text-xs text-white/80">Processing...</div>
					</div>
				)}
				<img
					src={screenshot.preview}
					alt="Screenshot"
					className={`w-full h-full object-cover transition-all duration-300 ${
						isLoading
							? "opacity-60"
							: "cursor-pointer group-hover:scale-105 group-hover:brightness-90"
					}`}
				/>
			</div>
			{!isLoading && (
				<button
					type="button"
					onClick={(e) => {
						e.stopPropagation();
						handleDelete();
					}}
					className="absolute top-2 left-2 p-1.5 rounded-full bg-black/60 backdrop-blur-sm text-white opacity-0 group-hover:opacity-100 transition-opacity duration-300 hover:bg-black/80"
					aria-label="Delete screenshot"
				>
					<X size={14} />
				</button>
			)}
		</div>
	);
};

export default ScreenshotItem;
