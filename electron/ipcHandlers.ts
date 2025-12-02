// ipcHandlers.ts

import { ipcMain, app } from "electron"
import { AppState } from "./main"

export function initializeIpcHandlers(appState: AppState): void {
  ipcMain.handle(
    "update-content-dimensions",
    async (event, { width, height }: { width: number; height: number }) => {
      if (width && height) {
        appState.setWindowDimensions(width, height)
      }
    }
  )

  ipcMain.handle("delete-screenshot", async (event, path: string) => {
    return appState.deleteScreenshot(path)
  })

  ipcMain.handle("take-screenshot", async () => {
    try {
      const screenshotPath = await appState.takeScreenshot()
      const preview = await appState.getImagePreview(screenshotPath)
      return { path: screenshotPath, preview }
    } catch (error) {
      console.error("Error taking screenshot:", error)
      throw error
    }
  })

  ipcMain.handle("get-screenshots", async () => {
    try {
      let previews = []
      if (appState.getView() === "queue") {
        previews = await Promise.all(
          appState.getScreenshotQueue().map(async (path) => ({
            path,
            preview: await appState.getImagePreview(path)
          }))
        )
      } else {
        previews = await Promise.all(
          appState.getExtraScreenshotQueue().map(async (path) => ({
            path,
            preview: await appState.getImagePreview(path)
          }))
        )
      }
      return previews
    } catch (error) {
      console.error("Error getting screenshots:", error)
      throw error
    }
  })

  ipcMain.handle("toggle-window", async () => {
    appState.toggleMainWindow()
  })

  ipcMain.handle("reset-queues", async () => {
    try {
      appState.clearQueues()
      console.log("Screenshot queues have been cleared.")
      return { success: true }
    } catch (error: any) {
      console.error("Error resetting queues:", error)
      return { success: false, error: error.message }
    }
  })

  // IPC handler for analyzing image from file path
  ipcMain.handle("analyze-image-file", async (event, path: string) => {
    try {
      const result = await appState.processingHelper.getLLMHelper().analyzeImageFile(path)
      return result
    } catch (error: any) {
      console.error("Error in analyze-image-file handler:", error)
      throw error
    }
  })

  ipcMain.handle("groq-chat", async (event, message: string) => {
    try {
      const result = await appState.processingHelper.getLLMHelper().chat(message)
      return result
    } catch (error: any) {
      console.error("Error in groq-chat handler:", error)
      throw error
    }
  })

  ipcMain.handle("quit-app", () => {
    app.quit()
  })

  // Window movement handlers
  ipcMain.handle("move-window-left", async () => {
    appState.moveWindowLeft()
  })

  ipcMain.handle("move-window-right", async () => {
    appState.moveWindowRight()
  })

  ipcMain.handle("move-window-up", async () => {
    appState.moveWindowUp()
  })

  ipcMain.handle("move-window-down", async () => {
    appState.moveWindowDown()
  })

  ipcMain.handle("center-and-show-window", async () => {
    appState.centerAndShowWindow()
  })

  // LLM Model Management Handlers
  ipcMain.handle("get-current-llm-config", async () => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper()
      return {
        provider: "groq",
        model: llmHelper.getCurrentModel(),
        visionModel: llmHelper.getVisionModel(),
        availableModels: llmHelper.getAvailableModels()
      }
    } catch (error: any) {
      console.error("Error getting current LLM config:", error)
      throw error
    }
  })

  ipcMain.handle("get-available-models", async () => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper()
      return llmHelper.getAvailableModels()
    } catch (error: any) {
      console.error("Error getting available models:", error)
      throw error
    }
  })

  ipcMain.handle("switch-model", async (_, model: string) => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper()
      llmHelper.switchModel(model as "openai/gpt-oss-20b" | "openai/gpt-oss-120b")
      return { success: true }
    } catch (error: any) {
      console.error("Error switching model:", error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle("test-llm-connection", async () => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper()
      const result = await llmHelper.testConnection()
      return result
    } catch (error: any) {
      console.error("Error testing LLM connection:", error)
      return { success: false, error: error.message }
    }
  })
}
