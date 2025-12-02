import type React from "react";
import { IoLogOutOutline } from "react-icons/io5";
import { HelpModal } from "../ui/HelpModal";

interface SolutionCommandsProps {
	extraScreenshots: Array<{ path: string; preview: string }>;
}

const SolutionCommands: React.FC<SolutionCommandsProps> = ({
	extraScreenshots,
}) => {
	return (
		<div>
			<div className="pt-2 w-fit">
				<div className="text-xs text-white/90 backdrop-blur-md bg-black/60 rounded-lg py-2 px-4 flex items-center justify-center gap-4">
					{/* Show/Hide */}
					<div className="flex items-center gap-2 whitespace-nowrap">
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

					{/* Screenshot */}
					<div className="flex items-center gap-2 whitespace-nowrap">
						<span className="text-[11px] leading-none truncate">
							{extraScreenshots.length === 0
								? "Screenshot your code"
								: "Screenshot"}
						</span>
						<div className="flex gap-1">
							<span className="bg-white/10 rounded-md px-1.5 py-1 text-[11px] leading-none text-white/70">
								⌘
							</span>
							<span className="bg-white/10 rounded-md px-1.5 py-1 text-[11px] leading-none text-white/70">
								H
							</span>
						</div>
					</div>
					{extraScreenshots.length > 0 && (
						<div className="flex items-center gap-2 whitespace-nowrap">
							<span className="text-[11px] leading-none">Debug</span>
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

					{/* Start Over */}
					<div className="flex items-center gap-2 whitespace-nowrap">
						<span className="text-[11px] leading-none">Start over</span>
						<div className="flex gap-1">
							<span className="bg-white/10 rounded-md px-1.5 py-1 text-[11px] leading-none text-white/70">
								⌘
							</span>
							<span className="bg-white/10 rounded-md px-1.5 py-1 text-[11px] leading-none text-white/70">
								R
							</span>
						</div>
					</div>

					{/* Help Modal */}
					<HelpModal variant="solutions" />

					{/* Sign Out Button */}
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
		</div>
	);
};

export default SolutionCommands;
