import type React from "react";
import { useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { IoClose, IoHelpCircleOutline } from "react-icons/io5";

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
			<span className="text-[11px] text-white/90">{label}</span>
			{description && (
				<span className="text-[10px] text-white/50">{description}</span>
			)}
		</div>
		<div className="flex gap-1">
			{keys.map((key) => (
				<kbd
					key={`${label}-${key}`}
					className="bg-white/10 rounded-md px-1.5 py-0.5 text-[10px] text-white/70"
				>
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

interface HelpPanelProps {
	variant?: "queue" | "solutions";
	onClose?: () => void;
}

export const HelpPanel: React.FC<HelpPanelProps> = ({
	variant = "queue",
	onClose,
}) => {
	return (
		<div className="bg-black/60 backdrop-blur-xl border border-white/20 rounded-2xl p-4 w-full min-w-[300px] max-w-[420px]">
			{/* Header */}
			<div className="flex items-center justify-between mb-3 pb-3 border-b border-white/10">
				<h3 className="text-sm font-medium text-white/90">
					How to Use Clueless
				</h3>
				{onClose && (
					<button
						type="button"
						onClick={onClose}
						className="text-white/50 hover:text-white/80 transition-colors"
					>
						<IoClose className="w-4 h-4" />
					</button>
				)}
			</div>

			{/* Content */}
			<div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
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
					<div className="space-y-2 text-[11px] text-white/80">
						<div className="flex gap-2">
							<span className="text-white/40 font-medium">1.</span>
							<span>
								Take a screenshot of the problem using{" "}
								<kbd className="bg-white/10 rounded px-1 py-0.5 text-[10px] text-white/70">⌘</kbd>{" "}
								<kbd className="bg-white/10 rounded px-1 py-0.5 text-[10px] text-white/70">H</kbd>
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
								Press{" "}
								<kbd className="bg-white/10 rounded px-1 py-0.5 text-[10px] text-white/70">⌘</kbd>{" "}
								<kbd className="bg-white/10 rounded px-1 py-0.5 text-[10px] text-white/70">↵</kbd>{" "}
								to generate a solution
							</span>
						</div>
						<div className="flex gap-2">
							<span className="text-white/40 font-medium">4.</span>
							<span>
								Debug by adding more screenshots and pressing{" "}
								<kbd className="bg-white/10 rounded px-1 py-0.5 text-[10px] text-white/70">⌘</kbd>{" "}
								<kbd className="bg-white/10 rounded px-1 py-0.5 text-[10px] text-white/70">↵</kbd>{" "}
								again
							</span>
						</div>
					</div>
				</Section>

				{/* Tips */}
				<Section title="Tips">
					<div className="space-y-1.5 text-[11px] text-white/70">
						<div className="flex items-start gap-2">
							<div className="w-1 h-1 rounded-full bg-white/40 mt-1.5 shrink-0" />
							<span>The window stays on top for easy reference</span>
						</div>
						<div className="flex items-start gap-2">
							<div className="w-1 h-1 rounded-full bg-white/40 mt-1.5 shrink-0" />
							<span>Drag the top bar to move the window</span>
						</div>
						<div className="flex items-start gap-2">
							<div className="w-1 h-1 rounded-full bg-white/40 mt-1.5 shrink-0" />
							<span>Up to 5 screenshots are saved in the queue</span>
						</div>
						<div className="flex items-start gap-2">
							<div className="w-1 h-1 rounded-full bg-white/40 mt-1.5 shrink-0" />
							<span>Click on screenshots to preview or delete them</span>
						</div>
					</div>
				</Section>
			</div>
		</div>
	);
};

interface HelpModalProps {
	variant?: "queue" | "solutions";
	triggerLabel?: string;
}

export const HelpModal: React.FC<HelpModalProps> = ({
	variant = "queue",
	triggerLabel = "Help",
}) => {
	const [open, setOpen] = useState(false);

	return (
		<DialogPrimitive.Root open={open} onOpenChange={setOpen}>
			<DialogPrimitive.Trigger asChild>
				<button
					type="button"
					className="bg-white/10 hover:bg-white/20 transition-colors rounded-md px-2 py-1 text-[11px] leading-none text-white/70 flex items-center gap-1"
				>
					<IoHelpCircleOutline className="w-3.5 h-3.5" />
					{triggerLabel}
				</button>
			</DialogPrimitive.Trigger>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" />
				<DialogPrimitive.Content className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
					<HelpPanel variant={variant} onClose={() => setOpen(false)} />
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
};

export default HelpPanel;
