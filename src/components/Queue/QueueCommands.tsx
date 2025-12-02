import type React from "react";
import { IoLogOutOutline } from "react-icons/io5";
import { HelpModal } from "../ui/HelpModal";

interface QueueCommandsProps {
	screenshots: Array<{ path: string; preview: string }>;
	onChatToggle: () => void;
	onSettingsToggle: () => void;
}

const QueueCommands: React.FC<QueueCommandsProps> = ({
	screenshots,
	onChatToggle,
	onSettingsToggle,
}) => {
	return (
		<div className="w-fit">
			<div className="text-xs text-white/90 liquid-glass-bar py-1 px-4 flex items-center justify-center gap-4 draggable-area">
				{/* Show/Hide */}
				<div className="flex items-center gap-2">
					<span className="text-[11px] leading-none">Show/Hide</span>
					<div className="flex gap-1">
						<span className="bg-white/10 rounded-md px-1.5 py-1 text-[11px] leading-none text-white/70">
							⌘
						</span>
						<span className="bg-white/10 rounded-md px-1.5 py-1 text-[11px] leading-none text-white/70">
							B
						</span>
					</div>
				</div>

				{/* Solve Command */}
				{screenshots.length > 0 && (
					<div className="flex items-center gap-2">
						<span className="text-[11px] leading-none">Solve</span>
						<div className="flex gap-1">
							<span className="bg-white/10 rounded-md px-1.5 py-1 text-[11px] leading-none text-white/70">
								⌘
							</span>
							<span className="bg-white/10 rounded-md px-1.5 py-1 text-[11px] leading-none text-white/70">
								↵
							</span>
						</div>
					</div>
				)}

				{/* Chat Button */}
				<div className="flex items-center gap-2">
					<button
						className="bg-white/10 hover:bg-white/20 transition-colors rounded-md px-2 py-1 text-[11px] leading-none text-white/70 flex items-center gap-1"
						onClick={onChatToggle}
						type="button"
					>
						Chat
					</button>
				</div>

				{/* Settings Button */}
				<div className="flex items-center gap-2">
					<button
						className="bg-white/10 hover:bg-white/20 transition-colors rounded-md px-2 py-1 text-[11px] leading-none text-white/70 flex items-center gap-1"
						onClick={onSettingsToggle}
						type="button"
					>
						Models
					</button>
				</div>

				{/* Help Modal */}
				<HelpModal variant="queue" />

				{/* Separator */}
				<div className="mx-2 h-4 w-px bg-white/20" />

				{/* Sign Out Button - Moved to end */}
				<button
					type="button"
					className="text-red-500/70 hover:text-red-500/90 transition-colors hover:cursor-pointer"
					title="Sign Out"
					onClick={() => window.electronAPI.quitApp()}
				>
					<IoLogOutOutline className="w-4 h-4" />
				</button>
			</div>
		</div>
	);
};

export default QueueCommands;
