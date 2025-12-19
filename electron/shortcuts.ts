import { app, globalShortcut } from "electron";
import type { AppState } from "./main"; // Adjust the import path if necessary

export class ShortcutsHelper {
	private appState: AppState;

	constructor(appState: AppState) {
		this.appState = appState;
	}

	public registerGlobalShortcuts(): void {
		const register = (
			accelerator: string,
			callback: () => void | Promise<void>,
		): boolean => {
			globalShortcut.register(accelerator, callback);
			const registered = globalShortcut.isRegistered(accelerator);
			if (!registered) {
				console.warn(
					`[ShortcutsHelper] Failed to register global shortcut: ${accelerator}`,
				);
			}
			return registered;
		};

		// Add global shortcut to show/center window
		register("CommandOrControl+Shift+Space", () => {
			console.log("Show/Center window shortcut pressed...");
			this.appState.centerAndShowWindow();
		});

		const screenshotAccelerator =
			process.platform === "darwin"
				? "CommandOrControl+Shift+H"
				: "CommandOrControl+H";
		register(screenshotAccelerator, async () => {
			const mainWindow = this.appState.getMainWindow();
			if (!mainWindow || mainWindow.isDestroyed()) return;

			console.log("Taking screenshot...");
			try {
				const screenshotPath = await this.appState.takeScreenshot();
				const preview = await this.appState.getImagePreview(screenshotPath);
				mainWindow.webContents.send("screenshot-taken", {
					path: screenshotPath,
					preview,
				});
			} catch (error) {
				console.error("Error capturing screenshot:", error);
			}
		});

		register("CommandOrControl+Enter", async () => {
			// Make results visible even if the window is currently hidden.
			if (!this.appState.isVisible()) {
				this.appState.showMainWindow();
			}
			await this.appState.processingHelper.processScreenshots();
		});

		register("CommandOrControl+R", () => {
			console.log(
				"Command + R pressed. Canceling requests and resetting queues...",
			);

			// Cancel ongoing API requests
			this.appState.processingHelper.cancelOngoingRequests();

			// Clear both screenshot queues
			this.appState.clearQueues();

			console.log("Cleared queues.");

			// Update the view state to 'queue'
			this.appState.setView("queue");

			// Notify renderer process to switch view to 'queue'
			const mainWindow = this.appState.getMainWindow();
			if (mainWindow && !mainWindow.isDestroyed()) {
				mainWindow.webContents.send("reset-view");
			}
		});

		// New shortcuts for moving the window
		register("CommandOrControl+Left", () => {
			console.log("Command/Ctrl + Left pressed. Moving window left.");
			this.appState.moveWindowLeft();
		});

		register("CommandOrControl+Right", () => {
			console.log("Command/Ctrl + Right pressed. Moving window right.");
			this.appState.moveWindowRight();
		});
		register("CommandOrControl+Down", () => {
			console.log("Command/Ctrl + down pressed. Moving window down.");
			this.appState.moveWindowDown();
		});
		register("CommandOrControl+Up", () => {
			console.log("Command/Ctrl + Up pressed. Moving window Up.");
			this.appState.moveWindowUp();
		});

		register("CommandOrControl+B", () => {
			this.appState.toggleMainWindow();
			// If window exists and we're showing it, bring it to front
			const mainWindow = this.appState.getMainWindow();
			if (mainWindow && this.appState.isVisible()) {
				// Force the window to the front on macOS
				if (process.platform === "darwin") {
					mainWindow.setAlwaysOnTop(true, "normal");
					// Reset alwaysOnTop after a brief delay
					setTimeout(() => {
						if (mainWindow && !mainWindow.isDestroyed()) {
							mainWindow.setAlwaysOnTop(true, "floating");
						}
					}, 100);
				}
			}
		});

		register("CommandOrControl+K", () => {
			const mainWindow = this.appState.getMainWindow();
			if (mainWindow && !mainWindow.isDestroyed()) {
				// Show window first if hidden
				if (!this.appState.isVisible()) {
					this.appState.toggleMainWindow();
				}
				mainWindow.webContents.send("focus-chat");
			}
		});

		// Unregister shortcuts when quitting
		app.on("will-quit", () => {
			globalShortcut.unregisterAll();
		});
	}
}
