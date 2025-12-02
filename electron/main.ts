import { app, type BrowserWindow, Menu, nativeImage, Tray } from "electron";
import { initializeIpcHandlers } from "./ipcHandlers";
import { ProcessingHelper } from "./ProcessingHelper";
import { ScreenshotHelper } from "./ScreenshotHelper";
import { ShortcutsHelper } from "./shortcuts";
import { WindowHelper } from "./WindowHelper";

export class AppState {
	private static instance: AppState | null = null;

	private windowHelper: WindowHelper;
	private screenshotHelper: ScreenshotHelper;
	public shortcutsHelper: ShortcutsHelper;
	public processingHelper: ProcessingHelper;
	private tray: Tray | null = null;

	// View management
	private view: "queue" | "solutions" = "queue";

	private problemInfo: {
		problem_statement: string;
		context?: string;
		suggested_responses?: string[];
		reasoning?: string;
		input_format?: {
			description: string;
			parameters: unknown[];
		};
		output_format?: {
			description: string;
			type: string;
			subtype: string;
		};
		complexity?: { time: string; space: string };
		test_cases?: unknown[];
		validation_type?: string;
		difficulty?: string;
	} | null = null; // Allow null

	private hasDebugged: boolean = false;

	// Store the current solution code for accurate debug diffs
	private currentSolutionCode: string | null = null;

	// Processing events
	public readonly PROCESSING_EVENTS = {
		//global states
		UNAUTHORIZED: "processing-unauthorized",
		NO_SCREENSHOTS: "processing-no-screenshots",

		//states for generating the initial solution
		INITIAL_START: "initial-start",
		PROBLEM_EXTRACTED: "problem-extracted",
		SOLUTION_SUCCESS: "solution-success",
		INITIAL_SOLUTION_ERROR: "solution-error",

		//states for processing the debugging
		DEBUG_START: "debug-start",
		DEBUG_SUCCESS: "debug-success",
		DEBUG_ERROR: "debug-error",
	} as const;

	constructor() {
		// Initialize WindowHelper with this
		this.windowHelper = new WindowHelper(this);

		// Initialize ScreenshotHelper
		this.screenshotHelper = new ScreenshotHelper(this.view);

		// Initialize ProcessingHelper
		this.processingHelper = new ProcessingHelper(this);

		// Initialize ShortcutsHelper
		this.shortcutsHelper = new ShortcutsHelper(this);
	}

	public static getInstance(): AppState {
		if (!AppState.instance) {
			AppState.instance = new AppState();
		}
		return AppState.instance;
	}

	// Getters and Setters
	public getMainWindow(): BrowserWindow | null {
		return this.windowHelper.getMainWindow();
	}

	public getView(): "queue" | "solutions" {
		return this.view;
	}

	public setView(view: "queue" | "solutions"): void {
		this.view = view;
		this.screenshotHelper.setView(view);
	}

	public isVisible(): boolean {
		return this.windowHelper.isVisible();
	}

	public getScreenshotHelper(): ScreenshotHelper {
		return this.screenshotHelper;
	}

	public getProblemInfo(): {
		problem_statement: string;
		context?: string;
		suggested_responses?: string[];
		reasoning?: string;
		input_format?: {
			description: string;
			parameters: unknown[];
		};
		output_format?: {
			description: string;
			type: string;
			subtype: string;
		};
		complexity?: { time: string; space: string };
		test_cases?: unknown[];
		validation_type?: string;
		difficulty?: string;
	} | null {
		return this.problemInfo;
	}

	public setProblemInfo(
		problemInfo: {
			problem_statement: string;
			context?: string;
			suggested_responses?: string[];
			reasoning?: string;
			input_format?: {
				description: string;
				parameters: unknown[];
			};
			output_format?: {
				description: string;
				type: string;
				subtype: string;
			};
			complexity?: { time: string; space: string };
			test_cases?: unknown[];
			validation_type?: string;
			difficulty?: string;
		} | null,
	): void {
		this.problemInfo = problemInfo;
	}

	public getScreenshotQueue(): string[] {
		return this.screenshotHelper.getScreenshotQueue();
	}

	public getExtraScreenshotQueue(): string[] {
		return this.screenshotHelper.getExtraScreenshotQueue();
	}

	// Window management methods
	public createWindow(): void {
		this.windowHelper.createWindow();
	}

	public hideMainWindow(): void {
		this.windowHelper.hideMainWindow();
	}

	public showMainWindow(): void {
		this.windowHelper.showMainWindow();
	}

	public toggleMainWindow(): void {
		console.log(
			"Screenshots: ",
			this.screenshotHelper.getScreenshotQueue().length,
			"Extra screenshots: ",
			this.screenshotHelper.getExtraScreenshotQueue().length,
		);
		this.windowHelper.toggleMainWindow();
	}

	public setWindowDimensions(width: number, height: number): void {
		this.windowHelper.setWindowDimensions(width, height);
	}

	public clearQueues(): void {
		this.screenshotHelper.clearQueues();

		// Clear problem info
		this.problemInfo = null;

		// Clear stored solution code
		this.clearCurrentSolutionCode();

		// Reset view to initial state
		this.setView("queue");
	}

	// Screenshot management methods
	public async takeScreenshot(): Promise<string> {
		if (!this.getMainWindow()) throw new Error("No main window available");

		const screenshotPath = await this.screenshotHelper.takeScreenshot(
			() => this.hideMainWindow(),
			() => this.showMainWindow(),
		);

		return screenshotPath;
	}

	public async getImagePreview(filepath: string): Promise<string> {
		return this.screenshotHelper.getImagePreview(filepath);
	}

	public async deleteScreenshot(
		path: string,
	): Promise<{ success: boolean; error?: string }> {
		return this.screenshotHelper.deleteScreenshot(path);
	}

	// New methods to move the window
	public moveWindowLeft(): void {
		this.windowHelper.moveWindowLeft();
	}

	public moveWindowRight(): void {
		this.windowHelper.moveWindowRight();
	}
	public moveWindowDown(): void {
		this.windowHelper.moveWindowDown();
	}
	public moveWindowUp(): void {
		this.windowHelper.moveWindowUp();
	}

	public centerAndShowWindow(): void {
		this.windowHelper.centerAndShowWindow();
	}

	public createTray(): void {
		// Create a simple tray icon
		const image = nativeImage.createEmpty();

		// Try to use a system template image for better integration
		let trayImage = image;
		try {
			// Create a minimal icon - just use an empty image and set the title
			trayImage = nativeImage.createFromBuffer(Buffer.alloc(0));
		} catch (_error) {
			console.log("Using empty tray image");
			trayImage = nativeImage.createEmpty();
		}

		this.tray = new Tray(trayImage);

		const contextMenu = Menu.buildFromTemplate([
			{
				label: "Show Interview Coder",
				click: () => {
					this.centerAndShowWindow();
				},
			},
			{
				label: "Toggle Window",
				click: () => {
					this.toggleMainWindow();
				},
			},
			{
				type: "separator",
			},
			{
				label: "Take Screenshot (Cmd+H)",
				click: async () => {
					try {
						const screenshotPath = await this.takeScreenshot();
						const preview = await this.getImagePreview(screenshotPath);
						const mainWindow = this.getMainWindow();
						if (mainWindow) {
							mainWindow.webContents.send("screenshot-taken", {
								path: screenshotPath,
								preview,
							});
						}
					} catch (error) {
						console.error("Error taking screenshot from tray:", error);
					}
				},
			},
			{
				type: "separator",
			},
			{
				label: "Quit",
				accelerator: "Command+Q",
				click: () => {
					app.quit();
				},
			},
		]);

		this.tray.setToolTip("Interview Coder - Press Cmd+Shift+Space to show");
		this.tray.setContextMenu(contextMenu);

		// Set a title for macOS (will appear in menu bar)
		if (process.platform === "darwin") {
			this.tray.setTitle("IC");
		}

		// Double-click to show window
		this.tray.on("double-click", () => {
			this.centerAndShowWindow();
		});
	}

	public setHasDebugged(value: boolean): void {
		this.hasDebugged = value;
	}

	public getHasDebugged(): boolean {
		return this.hasDebugged;
	}

	// Current solution code management for accurate debug diffs
	public setCurrentSolutionCode(code: string): void {
		this.currentSolutionCode = code;
	}

	public getCurrentSolutionCode(): string | null {
		return this.currentSolutionCode;
	}

	public clearCurrentSolutionCode(): void {
		this.currentSolutionCode = null;
	}
}

// Application initialization
async function initializeApp() {
	const appState = AppState.getInstance();

	// Initialize IPC handlers before window creation
	initializeIpcHandlers(appState);

	app.whenReady().then(() => {
		console.log("App is ready");
		appState.createWindow();
		appState.createTray();
		// Register global shortcuts using ShortcutsHelper
		appState.shortcutsHelper.registerGlobalShortcuts();
	});

	app.on("activate", () => {
		console.log("App activated");
		if (appState.getMainWindow() === null) {
			appState.createWindow();
		}
	});

	// Quit when all windows are closed, except on macOS
	app.on("window-all-closed", () => {
		if (process.platform !== "darwin") {
			app.quit();
		}
	});

	app.dock?.hide(); // Hide dock icon (optional)
	app.commandLine.appendSwitch("disable-background-timer-throttling");
}

// Start the application
initializeApp().catch(console.error);
