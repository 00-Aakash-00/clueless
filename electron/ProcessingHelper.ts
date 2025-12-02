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

    // Get vision model from environment (optional)
    const visionModel = process.env.GROQ_VISION_MODEL

    console.log("[ProcessingHelper] Initializing with Groq Cloud")
    this.llmHelper = new LLMHelper(apiKey, textModel, visionModel)
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

      // Handle screenshots as batch image analysis (processes all screenshots, up to 5)
      mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.INITIAL_START)
      this.appState.setView("solutions")
      this.currentProcessingAbortController = new AbortController()
      const signal = this.currentProcessingAbortController.signal
      try {
        // Use extractProblemFromImages for batch processing all screenshots
        const extractedProblem = await this.llmHelper.extractProblemFromImages(allPaths, signal)
        const problemInfo = {
          problem_statement: extractedProblem.problem_statement,
          context: extractedProblem.context,
          suggested_responses: extractedProblem.suggested_responses,
          reasoning: extractedProblem.reasoning,
          input_format: { description: "Generated from screenshots", parameters: [] as any[] },
          output_format: { description: "Generated from screenshots", type: "string", subtype: "text" },
          complexity: { time: "N/A", space: "N/A" },
          test_cases: [] as any[],
          validation_type: "manual",
          difficulty: "custom"
        }
        mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.PROBLEM_EXTRACTED, problemInfo)
        this.appState.setProblemInfo(problemInfo)

        // Generate solution and emit SOLUTION_SUCCESS
        const solution = await this.llmHelper.generateSolution(problemInfo, signal)

        // Store the solution code for accurate debug diffs later
        if (solution?.solution?.code) {
          this.appState.setCurrentSolutionCode(solution.solution.code)
        }

        mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.SOLUTION_SUCCESS, solution)
      } catch (error: any) {
        console.error("Image processing error:", error)

        // Check for auth errors and emit UNAUTHORIZED event
        if (error.isAuthError) {
          mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.UNAUTHORIZED)
        } else {
          mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR, error.message)
        }
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

        // Get stored solution code (don't regenerate - use what was displayed)
        const oldCode = this.appState.getCurrentSolutionCode()
        if (!oldCode) {
          throw new Error("No current solution available for debugging")
        }

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

        // Check for auth errors and emit UNAUTHORIZED event
        if (error.isAuthError) {
          mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.UNAUTHORIZED)
        } else {
          mainWindow.webContents.send(
            this.appState.PROCESSING_EVENTS.DEBUG_ERROR,
            error.message
          )
        }
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
