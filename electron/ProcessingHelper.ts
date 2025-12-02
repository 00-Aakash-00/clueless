// ProcessingHelper.ts

import { AppState } from "./main"
import { LLMHelper } from "./LLMHelper"
import dotenv from "dotenv"

dotenv.config()

type TextModel = "openai/gpt-oss-20b" | "openai/gpt-oss-120b"

export class ProcessingHelper {
  private appState: AppState
  private llmHelper: LLMHelper
  private currentProcessingAbortController: AbortController | null = null
  private currentExtraProcessingAbortController: AbortController | null = null

  constructor(appState: AppState) {
    this.appState = appState

    // Get Groq API key from environment
    const apiKey = process.env.GROQ_API_KEY
    if (!apiKey) {
      throw new Error("GROQ_API_KEY not found in environment variables")
    }

    // Get text model from environment (default to gpt-oss-20b)
    const textModel = (process.env.GROQ_TEXT_MODEL || "openai/gpt-oss-20b") as TextModel

    console.log("[ProcessingHelper] Initializing with Groq Cloud")
    this.llmHelper = new LLMHelper(apiKey, textModel)
  }

  public async processScreenshots(): Promise<void> {
    const mainWindow = this.appState.getMainWindow()
    if (!mainWindow) return

    const view = this.appState.getView()

    if (view === "queue") {
      const screenshotQueue = this.appState.getScreenshotHelper().getScreenshotQueue()
      if (screenshotQueue.length === 0) {
        mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.NO_SCREENSHOTS)
        return
      }

      const allPaths = this.appState.getScreenshotHelper().getScreenshotQueue()
      const lastPath = allPaths[allPaths.length - 1]

      // Handle screenshot as image analysis
      mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.INITIAL_START)
      this.appState.setView("solutions")
      this.currentProcessingAbortController = new AbortController()
      const signal = this.currentProcessingAbortController.signal
      try {
        const imageResult = await this.llmHelper.analyzeImageFile(lastPath, signal)
        const problemInfo = {
          problem_statement: imageResult.text,
          input_format: { description: "Generated from screenshot", parameters: [] as any[] },
          output_format: { description: "Generated from screenshot", type: "string", subtype: "text" },
          complexity: { time: "N/A", space: "N/A" },
          test_cases: [] as any[],
          validation_type: "manual",
          difficulty: "custom"
        }
        mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.PROBLEM_EXTRACTED, problemInfo)
        this.appState.setProblemInfo(problemInfo)

        // Generate solution and emit SOLUTION_SUCCESS
        const solution = await this.llmHelper.generateSolution(problemInfo, signal)
        mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.SOLUTION_SUCCESS, solution)
      } catch (error: any) {
        console.error("Image processing error:", error)
        mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR, error.message)
      } finally {
        this.currentProcessingAbortController = null
      }
      return
    } else {
      // Debug mode
      const extraScreenshotQueue = this.appState.getScreenshotHelper().getExtraScreenshotQueue()
      if (extraScreenshotQueue.length === 0) {
        console.log("No extra screenshots to process")
        mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.NO_SCREENSHOTS)
        return
      }

      mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.DEBUG_START)
      this.currentExtraProcessingAbortController = new AbortController()
      const debugSignal = this.currentExtraProcessingAbortController.signal

      try {
        // Get problem info and current solution
        const problemInfo = this.appState.getProblemInfo()
        if (!problemInfo) {
          throw new Error("No problem info available")
        }

        // Get current solution from state
        const currentSolution = await this.llmHelper.generateSolution(problemInfo, debugSignal)
        const oldCode = currentSolution.solution.code

        // Debug the solution using vision model
        const debugResult = await this.llmHelper.debugSolutionWithImages(
          problemInfo,
          oldCode,
          extraScreenshotQueue,
          debugSignal
        )

        this.appState.setHasDebugged(true)

        // Send data in the format the frontend expects: { solution: { old_code, new_code, thoughts, time_complexity, space_complexity } }
        // Solutions.tsx accesses data.solution, then sets it to queryClient cache
        // Debug.tsx reads from cache expecting { old_code, new_code, thoughts, time_complexity, space_complexity }
        mainWindow.webContents.send(
          this.appState.PROCESSING_EVENTS.DEBUG_SUCCESS,
          {
            solution: {
              old_code: oldCode,
              new_code: debugResult.solution.code,
              thoughts: debugResult.solution.suggested_responses || [],
              time_complexity: "N/A",
              space_complexity: "N/A"
            }
          }
        )
      } catch (error: any) {
        console.error("Debug processing error:", error)
        mainWindow.webContents.send(
          this.appState.PROCESSING_EVENTS.DEBUG_ERROR,
          error.message
        )
      } finally {
        this.currentExtraProcessingAbortController = null
      }
    }
  }

  public cancelOngoingRequests(): void {
    if (this.currentProcessingAbortController) {
      this.currentProcessingAbortController.abort()
      this.currentProcessingAbortController = null
    }

    if (this.currentExtraProcessingAbortController) {
      this.currentExtraProcessingAbortController.abort()
      this.currentExtraProcessingAbortController = null
    }

    this.appState.setHasDebugged(false)
  }

  public getLLMHelper() {
    return this.llmHelper
  }
}
