// ScreenshotHelper.ts

import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import screenshot from "screenshot-desktop";
import { v4 as uuidv4 } from "uuid";

export class ScreenshotHelper {
	private screenshotQueue: string[] = [];
	private screenshotQueueSet = new Set<string>();
	private extraScreenshotQueue: string[] = [];
	private extraScreenshotQueueSet = new Set<string>();
	private readonly MAX_SCREENSHOTS = 5;

	private readonly screenshotDir: string;
	private readonly extraScreenshotDir: string;

	private view: "queue" | "solutions" = "queue";

	constructor(view: "queue" | "solutions" = "queue") {
		this.view = view;

		// Initialize directories
		this.screenshotDir = path.join(app.getPath("userData"), "screenshots");
		this.extraScreenshotDir = path.join(
			app.getPath("userData"),
			"extra_screenshots",
		);

		// Create directories if they don't exist
		if (!fs.existsSync(this.screenshotDir)) {
			fs.mkdirSync(this.screenshotDir, { recursive: true });
		}
		if (!fs.existsSync(this.extraScreenshotDir)) {
			fs.mkdirSync(this.extraScreenshotDir, { recursive: true });
		}
	}

	public getView(): "queue" | "solutions" {
		return this.view;
	}

	public setView(view: "queue" | "solutions"): void {
		this.view = view;
	}

	public getScreenshotQueue(): string[] {
		return this.screenshotQueue;
	}

	public getExtraScreenshotQueue(): string[] {
		return this.extraScreenshotQueue;
	}

	public clearQueues(): void {
		// Clear screenshotQueue
		this.screenshotQueue.forEach((screenshotPath) => {
			fs.unlink(screenshotPath, (err) => {
				if (err)
					console.error(`Error deleting screenshot at ${screenshotPath}:`, err);
			});
		});
		this.screenshotQueue = [];
		this.screenshotQueueSet.clear();

		// Clear extraScreenshotQueue
		this.extraScreenshotQueue.forEach((screenshotPath) => {
			fs.unlink(screenshotPath, (err) => {
				if (err)
					console.error(
						`Error deleting extra screenshot at ${screenshotPath}:`,
						err,
					);
			});
		});
		this.extraScreenshotQueue = [];
		this.extraScreenshotQueueSet.clear();
	}

	public async takeScreenshot(
		hideMainWindow: () => void,
		showMainWindow: () => void,
	): Promise<string> {
		try {
			hideMainWindow();

			// Add a small delay to ensure window is hidden
			await new Promise((resolve) => setTimeout(resolve, 100));

			let screenshotPath = "";

			if (this.view === "queue") {
				screenshotPath = path.join(this.screenshotDir, `${uuidv4()}.png`);
				await screenshot({ filename: screenshotPath });

				this.screenshotQueue.push(screenshotPath);
				this.screenshotQueueSet.add(screenshotPath);
				if (this.screenshotQueue.length > this.MAX_SCREENSHOTS) {
					const removedPath = this.screenshotQueue.shift();
					if (removedPath) {
						this.screenshotQueueSet.delete(removedPath);
						try {
							await fs.promises.unlink(removedPath);
						} catch (error) {
							console.error("Error removing old screenshot:", error);
						}
					}
				}
			} else {
				screenshotPath = path.join(this.extraScreenshotDir, `${uuidv4()}.png`);
				await screenshot({ filename: screenshotPath });

				this.extraScreenshotQueue.push(screenshotPath);
				this.extraScreenshotQueueSet.add(screenshotPath);
				if (this.extraScreenshotQueue.length > this.MAX_SCREENSHOTS) {
					const removedPath = this.extraScreenshotQueue.shift();
					if (removedPath) {
						this.extraScreenshotQueueSet.delete(removedPath);
						try {
							await fs.promises.unlink(removedPath);
						} catch (error) {
							console.error("Error removing old screenshot:", error);
						}
					}
				}
			}

			return screenshotPath;
		} catch (error: unknown) {
			console.error("Error taking screenshot:", error);
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(`Failed to take screenshot: ${message}`);
		} finally {
			// Ensure window is always shown again
			showMainWindow();
		}
	}

	public async getImagePreview(filepath: string): Promise<string> {
		try {
			const data = await fs.promises.readFile(filepath);
			return `data:image/png;base64,${data.toString("base64")}`;
		} catch (error) {
			console.error("Error reading image:", error);
			throw error;
		}
	}

	public async deleteScreenshot(
		filePath: string,
	): Promise<{ success: boolean; error?: string }> {
		try {
			const inMainQueue = this.screenshotQueueSet.has(filePath);
			const inExtraQueue = this.extraScreenshotQueueSet.has(filePath);

			if (!inMainQueue && !inExtraQueue) {
				return { success: false, error: "Screenshot not found in queue" };
			}

			try {
				await fs.promises.unlink(filePath);
			} catch (error: unknown) {
				// Treat missing files as already-deleted so local state can recover.
				const code = (error as { code?: string } | null)?.code;
				if (code !== "ENOENT") {
					throw error;
				}
			}

			if (inMainQueue) {
				this.screenshotQueueSet.delete(filePath);
				this.screenshotQueue = this.screenshotQueue.filter(
					(p) => p !== filePath,
				);
			}
			if (inExtraQueue) {
				this.extraScreenshotQueueSet.delete(filePath);
				this.extraScreenshotQueue = this.extraScreenshotQueue.filter(
					(p) => p !== filePath,
				);
			}
			return { success: true };
		} catch (error: unknown) {
			console.error("Error deleting file:", error);
			const message =
				error instanceof Error ? error.message : "Unknown error occurred";
			return { success: false, error: message };
		}
	}
}
