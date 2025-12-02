import fs from "fs"

interface GroqChatResponse {
  id: string
  object: string
  created: number
  model: string
  choices: Array<{
    index: number
    message: {
      role: string
      content: string
    }
    finish_reason: string
  }>
  usage: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

type TextModel = "openai/gpt-oss-20b" | "openai/gpt-oss-120b"

export class LLMHelper {
  private apiKey: string
  private textModel: TextModel
  private readonly visionModel: string
  private readonly apiUrl = "https://api.groq.com/openai/v1/chat/completions"
  private readonly systemPrompt = `You are Wingman AI, a helpful, proactive assistant for any kind of problem or situation (not just coding). For any user input, analyze the situation, provide a clear problem statement, relevant context, and suggest several possible responses or actions the user could take next. Always explain your reasoning. Present your suggestions as a list of options or next steps.`

  constructor(apiKey: string, textModel?: TextModel, visionModel?: string) {
    if (!apiKey) {
      throw new Error("GROQ_API_KEY is required")
    }
    this.apiKey = apiKey
    this.textModel = textModel || "openai/gpt-oss-20b"
    this.visionModel = visionModel || "meta-llama/llama-4-scout-17b-16e-instruct"
    console.log(`[LLMHelper] Initialized with Groq API`)
    console.log(`[LLMHelper] Text model: ${this.textModel}`)
    console.log(`[LLMHelper] Vision model: ${this.visionModel}`)
  }

  private async callGroq(
    model: string,
    messages: Array<{ role: string; content: string | Array<any> }>,
    options?: {
      temperature?: number
      responseFormat?: { type: string }
      signal?: AbortSignal
    }
  ): Promise<string> {
    try {
      const body: any = {
        model,
        messages,
        temperature: options?.temperature ?? 0.7
        // No max_completion_tokens - let API use maximum available
      }

      if (options?.responseFormat) {
        body.response_format = options.responseFormat
      }

      const response = await fetch(this.apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify(body),
        signal: options?.signal
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error("[LLMHelper] Groq API error:", response.status, errorText)

        // Throw specific error for auth failures (401/403)
        if (response.status === 401 || response.status === 403) {
          const authError = new Error(`Groq API authentication error: ${response.status} - ${errorText}`)
          ;(authError as any).isAuthError = true
          throw authError
        }

        throw new Error(`Groq API error: ${response.status} - ${errorText}`)
      }

      const data: GroqChatResponse = await response.json()
      return data.choices[0]?.message?.content || ""
    } catch (error: any) {
      console.error("[LLMHelper] Error calling Groq:", error)
      throw new Error(`Failed to call Groq API: ${error.message}`)
    }
  }

  private async imageToBase64(imagePath: string): Promise<string> {
    const imageData = await fs.promises.readFile(imagePath)
    return imageData.toString("base64")
  }

  private cleanJsonResponse(text: string): string {
    // Remove markdown code block syntax if present
    text = text.replace(/^```(?:json)?\n/, "").replace(/\n```$/, "")
    // Remove any leading/trailing whitespace
    text = text.trim()
    return text
  }

  public async extractProblemFromImages(imagePaths: string[], signal?: AbortSignal) {
    try {
      // Build content array with text and images
      const content: Array<any> = [
        {
          type: "text",
          text: `${this.systemPrompt}\n\nYou are a wingman. Please analyze these images and extract the following information in JSON format:\n{
  "problem_statement": "A clear statement of the problem or situation depicted in the images.",
  "context": "Relevant background or context from the images.",
  "suggested_responses": ["First possible answer or action", "Second possible answer or action", "..."],
  "reasoning": "Explanation of why these suggestions are appropriate."
}\nImportant: Return ONLY the JSON object, without any markdown formatting or code blocks.`
        }
      ]

      // Add images (max 5 per Groq limits)
      const imagesToProcess = imagePaths.slice(0, 5)
      for (const imagePath of imagesToProcess) {
        const base64Image = await this.imageToBase64(imagePath)
        content.push({
          type: "image_url",
          image_url: {
            url: `data:image/png;base64,${base64Image}`
          }
        })
      }

      const response = await this.callGroq(
        this.visionModel,
        [{ role: "user", content }],
        { temperature: 1, responseFormat: { type: "json_object" }, signal }
      )

      const text = this.cleanJsonResponse(response)
      try {
        const parsed = JSON.parse(text)
        return parsed
      } catch (e: any) {
        console.error("[LLMHelper] JSON parse error:", e, "Raw response:", text)
        throw new Error(`Failed to parse Groq response as JSON: ${e.message}`)
      }
    } catch (error) {
      console.error("[LLMHelper] Error extracting problem from images:", error)
      throw error
    }
  }

  public async generateSolution(problemInfo: any, signal?: AbortSignal) {
    const prompt = `${this.systemPrompt}\n\nGiven this problem or situation:\n${JSON.stringify(problemInfo, null, 2)}\n\nPlease provide your response in the following JSON format:\n{
  "solution": {
    "code": "The code or main answer here.",
    "problem_statement": "Restate the problem or situation.",
    "context": "Relevant background/context.",
    "suggested_responses": ["First possible answer or action", "Second possible answer or action", "..."],
    "reasoning": "Explanation of why these suggestions are appropriate."
  }
}\nImportant: Return ONLY the JSON object, without any markdown formatting or code blocks.`

    console.log("[LLMHelper] Calling Groq for solution...")
    try {
      const response = await this.callGroq(
        this.textModel,
        [{ role: "user", content: prompt }],
        { temperature: 0.7, signal }
      )
      console.log("[LLMHelper] Groq returned result.")
      const text = this.cleanJsonResponse(response)
      try {
        const parsed = JSON.parse(text)
        console.log("[LLMHelper] Parsed response:", parsed)
        return parsed
      } catch (e: any) {
        console.error("[LLMHelper] JSON parse error:", e, "Raw response:", text)
        throw new Error(`Failed to parse Groq response as JSON: ${e.message}`)
      }
    } catch (error) {
      console.error("[LLMHelper] Error in generateSolution:", error)
      throw error
    }
  }

  public async debugSolutionWithImages(
    problemInfo: any,
    currentCode: string,
    debugImagePaths: string[],
    signal?: AbortSignal
  ) {
    try {
      // Build content array with text and images
      const content: Array<any> = [
        {
          type: "text",
          text: `${this.systemPrompt}\n\nYou are a wingman. Given:\n1. The original problem or situation: ${JSON.stringify(problemInfo, null, 2)}\n2. The current response or approach: ${currentCode}\n3. The debug information in the provided images\n\nPlease analyze the debug information and provide feedback in this JSON format:\n{
  "solution": {
    "code": "The code or main answer here.",
    "problem_statement": "Restate the problem or situation.",
    "context": "Relevant background/context.",
    "suggested_responses": ["First possible answer or action", "Second possible answer or action", "..."],
    "reasoning": "Explanation of why these suggestions are appropriate."
  }
}\nImportant: Return ONLY the JSON object, without any markdown formatting or code blocks.`
        }
      ]

      // Add images (max 5 per Groq limits)
      const imagesToProcess = debugImagePaths.slice(0, 5)
      for (const imagePath of imagesToProcess) {
        const base64Image = await this.imageToBase64(imagePath)
        content.push({
          type: "image_url",
          image_url: {
            url: `data:image/png;base64,${base64Image}`
          }
        })
      }

      const response = await this.callGroq(
        this.visionModel,
        [{ role: "user", content }],
        { temperature: 1, responseFormat: { type: "json_object" }, signal }
      )

      const text = this.cleanJsonResponse(response)
      try {
        const parsed = JSON.parse(text)
        console.log("[LLMHelper] Parsed debug response:", parsed)
        return parsed
      } catch (e: any) {
        console.error("[LLMHelper] JSON parse error:", e, "Raw response:", text)
        throw new Error(`Failed to parse Groq response as JSON: ${e.message}`)
      }
    } catch (error) {
      console.error("[LLMHelper] Error debugging solution with images:", error)
      throw error
    }
  }

  public async analyzeImageFile(imagePath: string, signal?: AbortSignal) {
    try {
      const base64Image = await this.imageToBase64(imagePath)

      const content: Array<any> = [
        {
          type: "text",
          text: `${this.systemPrompt}\n\nDescribe the content of this image in a short, concise answer. In addition to your main answer, suggest several possible actions or responses the user could take next based on the image. Do not return a structured JSON object, just answer naturally as you would to a user. Be concise and brief.`
        },
        {
          type: "image_url",
          image_url: {
            url: `data:image/png;base64,${base64Image}`
          }
        }
      ]

      const response = await this.callGroq(
        this.visionModel,
        [{ role: "user", content }],
        { temperature: 1, signal }
      )

      return { text: response, timestamp: Date.now() }
    } catch (error) {
      console.error("[LLMHelper] Error analyzing image file:", error)
      throw error
    }
  }

  public async chat(message: string): Promise<string> {
    try {
      const response = await this.callGroq(
        this.textModel,
        [{ role: "user", content: message }],
        { temperature: 0.7 }
      )
      return response
    } catch (error) {
      console.error("[LLMHelper] Error in chat:", error)
      throw error
    }
  }

  public getCurrentModel(): string {
    return this.textModel
  }

  public getVisionModel(): string {
    return this.visionModel
  }

  public getAvailableModels(): string[] {
    return ["openai/gpt-oss-20b", "openai/gpt-oss-120b"]
  }

  public switchModel(model: TextModel): void {
    if (model !== "openai/gpt-oss-20b" && model !== "openai/gpt-oss-120b") {
      throw new Error(`Invalid model: ${model}. Must be openai/gpt-oss-20b or openai/gpt-oss-120b`)
    }
    this.textModel = model
    console.log(`[LLMHelper] Switched to model: ${this.textModel}`)
  }

  public async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      // Test with a simple prompt
      await this.callGroq(
        this.textModel,
        [{ role: "user", content: "Hello" }],
        { temperature: 0.7 }
      )
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }
}
