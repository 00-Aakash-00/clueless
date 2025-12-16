// src/components/ui/dialog.tsx

import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as React from "react";
import { cn } from "../../lib/utils";

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;

const DialogOverlay = React.forwardRef<
	React.ElementRef<typeof DialogPrimitive.Overlay>,
	React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
	<DialogPrimitive.Overlay
		ref={ref}
		className={cn("fixed inset-0 z-50 bg-black/40 backdrop-blur-sm", className)}
		{...props}
	/>
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
	React.ElementRef<typeof DialogPrimitive.Content>,
	React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
	<DialogPortal>
		<DialogOverlay />
		<DialogPrimitive.Content
			ref={ref}
			className={cn(
				"fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2",
				"bg-black/60 backdrop-blur-xl border border-white/20 rounded-2xl p-5 shadow-2xl max-w-[90vw]",
				className,
			)}
			{...props}
		>
			{children}
		</DialogPrimitive.Content>
	</DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogClose = DialogPrimitive.Close;

export { Dialog, DialogTrigger, DialogContent, DialogClose };
