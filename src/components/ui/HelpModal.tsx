import type React from "react";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "./dialog";

interface ShortcutRowProps {
	label: string;
	keys: string[];
	description?: string;
}

const ShortcutRow: React.FC<ShortcutRowProps> = ({
	label,
	keys,
	description,
}) => (
	<div className="flex items-center justify-between py-2 border-b border-white/5 last:border-b-0">
		<div className="flex flex-col gap-0.5">
			<span className="text-[13px] text-white/90">{label}</span>
			{description && (
				<span className="text-[11px] text-white/50">{description}</span>
			)}
		</div>
		<div className="flex gap-1">
			{keys.map((key) => (
				<kbd key={`${label}-${key}`} className="kbd">
					{key}
				</kbd>
			))}
		</div>
	</div>
);

interface SectionProps {
	title: string;
	children: React.ReactNode;
}

const Section: React.FC<SectionProps> = ({ title, children }) => (
	<div className="space-y-2">
		<h3 className="text-[11px] font-semibold uppercase tracking-wider text-white/50">
			{title}
		</h3>
		{children}
	</div>
);

interface HelpModalProps {
	variant?: "queue" | "solutions";
}

export const HelpModal: React.FC<HelpModalProps> = ({ variant = "queue" }) => {
	return (
		<Dialog>
			<DialogTrigger asChild>
				<button
					type="button"
					className="w-6 h-6 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-sm transition-colors flex items-center justify-center cursor-pointer"
					aria-label="Help and keyboard shortcuts"
				>
					<span className="text-xs text-white/70">?</span>
				</button>
			</DialogTrigger>

			<DialogContent className="w-[380px]">
				{/* Header */}
				<div className="flex items-center justify-between mb-5">
					<h2 className="text-[15px] font-medium text-white/95">
						How to Use Clueless
					</h2>
					<DialogClose asChild>
						<button
							type="button"
							className="w-6 h-6 rounded-full bg-white/10 hover:bg-white/20 transition-colors flex items-center justify-center"
							aria-label="Close"
						>
							<span className="text-white/70 text-sm">&times;</span>
						</button>
					</DialogClose>
				</div>

				{/* Content */}
				<div className="space-y-5">
					{/* Keyboard Shortcuts */}
					<Section title="Keyboard Shortcuts">
						<div className="bg-white/5 rounded-lg px-3">
							<ShortcutRow
								label="Toggle Window"
								keys={["⌘", "B"]}
								description="Show or hide the overlay"
							/>
							<ShortcutRow
								label="Take Screenshot"
								keys={["⌘", "H"]}
								description="Capture screen content"
							/>
							<ShortcutRow
								label={
									variant === "queue" ? "Solve Problem" : "Debug / Process"
								}
								keys={["⌘", "↵"]}
								description={
									variant === "queue"
										? "Generate solution from screenshots"
										: "Debug with new screenshots"
								}
							/>
							<ShortcutRow
								label="Start Over"
								keys={["⌘", "R"]}
								description="Clear everything and start fresh"
							/>
							<ShortcutRow
								label="Focus Chat"
								keys={["⌘", "K"]}
								description="Open chat and start typing"
							/>
						</div>
					</Section>

					{/* Workflow */}
					<Section title="Workflow">
						<div className="space-y-2 text-[12px] text-white/80">
							<div className="flex gap-2">
								<span className="text-white/40 font-medium">1.</span>
								<span>
									Take a screenshot of the problem using{" "}
									<kbd className="kbd">⌘</kbd> <kbd className="kbd">H</kbd>
								</span>
							</div>
							<div className="flex gap-2">
								<span className="text-white/40 font-medium">2.</span>
								<span>
									Add more context with additional screenshots if needed
								</span>
							</div>
							<div className="flex gap-2">
								<span className="text-white/40 font-medium">3.</span>
								<span>
									Press <kbd className="kbd">⌘</kbd>{" "}
									<kbd className="kbd">↵</kbd> to generate a solution
								</span>
							</div>
							<div className="flex gap-2">
								<span className="text-white/40 font-medium">4.</span>
								<span>
									Debug by adding more screenshots and pressing{" "}
									<kbd className="kbd">⌘</kbd> <kbd className="kbd">↵</kbd>{" "}
									again
								</span>
							</div>
						</div>
					</Section>

					{/* Tips */}
					<Section title="Tips">
						<div className="space-y-1.5 text-[12px] text-white/70">
							<div className="flex items-start gap-2">
								<div className="w-1 h-1 rounded-full bg-blue-400/80 mt-1.5 shrink-0" />
								<span>The window stays on top for easy reference</span>
							</div>
							<div className="flex items-start gap-2">
								<div className="w-1 h-1 rounded-full bg-blue-400/80 mt-1.5 shrink-0" />
								<span>Drag the top bar to move the window</span>
							</div>
							<div className="flex items-start gap-2">
								<div className="w-1 h-1 rounded-full bg-blue-400/80 mt-1.5 shrink-0" />
								<span>Up to 5 screenshots are saved in the queue</span>
							</div>
							<div className="flex items-start gap-2">
								<div className="w-1 h-1 rounded-full bg-blue-400/80 mt-1.5 shrink-0" />
								<span>Click on screenshots to preview or delete them</span>
							</div>
						</div>
					</Section>
				</div>
			</DialogContent>
		</Dialog>
	);
};

export default HelpModal;
