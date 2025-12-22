import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { createHash, randomUUID } from "node:crypto";

// Supermemory API response types
interface AddMemoryResponse {
	id: string;
	status: "queued" | "processing" | "done";
}

interface SearchResult {
	id: string;
	memory: string;
	similarity: number;
	title?: string | null;
	type?: string | null;
	metadata?: Record<string, unknown> | null;
	context?: string | null;
	rootMemoryId?: string | null;
	updatedAt?: string | null;
	version?: number | null;
	documents?: Array<{
		id: string;
		title?: string | null;
		type?: string | null;
		summary?: string | null;
		metadata?: Record<string, unknown> | null;
		createdAt?: string | null;
		updatedAt?: string | null;
	}>;
}

interface SearchResponse {
	results: SearchResult[];
	total: number;
	timing: number;
}

interface DocumentSearchChunk {
	content: string;
	score: number;
	isRelevant?: boolean | null;
	position?: number | null;
}

interface DocumentSearchResult {
	documentId: string;
	title?: string | null;
	type?: string | null;
	score?: number | null;
	summary?: string | null;
	chunks: DocumentSearchChunk[];
	createdAt?: string | null;
	updatedAt?: string | null;
	metadata?: Record<string, unknown> | null;
}

interface DocumentsSearchResponse {
	results: DocumentSearchResult[];
	total: number;
	timing: number;
}

type BulkDeleteResponse = {
	success?: boolean;
	deletedCount?: number;
	errors?: Array<{ id: string; error: string }>;
	containerTags?: string[];
};

type MemorySearchIncludeOptions = {
	documents?: boolean;
	relatedMemories?: boolean;
	summaries?: boolean;
};

export type MemorySearchOptions = {
	limit?: number;
	threshold?: number;
	rerank?: boolean;
	rewriteQuery?: boolean;
	include?: MemorySearchIncludeOptions;
	filters?: unknown;
	/**
	 * Overrides the default container tag for this helper. Use `null` to omit the filter.
	 */
	containerTag?: string | null;
};

export type DocumentsSearchOptions = {
	limit?: number;
	/**
	 * When omitted, defaults to the helper's container tag as a single-element array.
	 * Use `null` to omit the filter.
	 */
	containerTags?: string[] | null;
	filters?: unknown;
	documentThreshold?: number;
	chunkThreshold?: number;
	rewriteQuery?: boolean;
	rerank?: boolean;
	docId?: string;
	includeFullDocs?: boolean;
	includeSummary?: boolean;
	onlyMatchingChunks?: boolean;
};

interface ProfileResponse {
	profile: {
		static: string[];
		dynamic: string[];
	};
	searchResults?: SearchResponse;
}

export type SupermemoryProvider =
	| "notion"
	| "google-drive"
	| "onedrive";

export type SupermemoryDocumentStatus =
	| "unknown"
	| "queued"
	| "extracting"
	| "chunking"
	| "embedding"
	| "indexing"
	| "done"
	| "failed";

type ProcessingDocumentStatus =
	| "unknown"
	| "queued"
	| "extracting"
	| "chunking"
	| "embedding"
	| "indexing"
	| "done"
	| "failed";

const PROCESSING_DOCUMENT_STATUS_SET = new Set<ProcessingDocumentStatus>([
	"unknown",
	"queued",
	"extracting",
	"chunking",
	"embedding",
	"indexing",
	"done",
	"failed",
]);

type ProcessingDocument = {
	id: string;
	status: ProcessingDocumentStatus;
	title?: string | null;
	containerTags?: string[];
};

type ProcessingDocumentsResponse = {
	documents: ProcessingDocument[];
	totalCount: number;
};

export type ListedDocument = {
	id: string;
	title?: string | null;
	type?: string | null;
	status?: SupermemoryDocumentStatus | string | null;
	summary?: string | null;
	metadata?: Record<string, unknown> | null;
	containerTags?: string[] | null;
	connectionId?: string | null;
	customId?: string | null;
	createdAt?: string | null;
	updatedAt?: string | null;
};

export type ListDocumentsResponse = {
	memories: ListedDocument[];
	pagination?: {
		currentPage?: number;
		limit?: number;
		totalItems?: number;
		totalPages?: number;
	} | null;
};

export type ListDocumentsOptions = {
	limit?: number;
	page?: number;
	order?: "asc" | "desc";
	sort?: "createdAt" | "updatedAt";
	/**
	 * When omitted, defaults to the helper's container tag as a single-element array.
	 * Use `null` to omit the filter.
	 */
	containerTags?: string[] | null;
	filters?: unknown;
};

export type SupermemoryConnection = {
	id: string;
	provider: SupermemoryProvider | string;
	email?: string | null;
	documentLimit?: number | null;
	createdAt?: string | null;
	expiresAt?: string | null;
	metadata?: Record<string, unknown> | null;
};

export type CreateConnectionResponse = {
	id: string;
	authLink: string;
	expiresIn: string;
	redirectsTo?: string | null;
};

export type DeleteConnectionResponse = {
	id: string;
	provider: string;
};

export type ConnectionDocument = {
	id: string;
	status: string;
	type: string;
	title?: string | null;
	summary?: string | null;
	createdAt?: string | null;
	updatedAt?: string | null;
};

// Document metadata stored in-memory
export interface StoredDocument {
	id: string;
	name: string;
	type: string;
	addedAt: number;
}

// About You entry - persisted locally
export interface AboutYouEntry {
	id: string;
	title: string;
	content: string;
	type: "text" | "file";
	filePath?: string;
	fileName?: string;
	supermemoryId?: string;
	addedAt: number;
}

// Customization configuration
export interface CustomizeConfig {
	role: string;
	customRoleText: string;
	textContext: string;
	documents: StoredDocument[];
	userFacts: string[];
	aboutYou: AboutYouEntry[];
}

	// Role presets
	export const ROLE_PRESETS: Record<string, string> = {
		default:
			"You are Wingman, a highly capable, proactive assistant for any kind of problem or situation (not just coding). For any user input, infer what the user is trying to accomplish. If unclear, ask 1–3 precise clarifying questions. Provide the best possible answer with strong structure and high signal, grounded in any provided knowledge-base excerpts and the user's preferences. If the answer is not supported by the knowledge base, say so and suggest what to search for next. When you rely on knowledge-base excerpts, include a short Sources section listing the document titles you used (do not invent sources). Be transparent about uncertainty and never fabricate quotes, citations, or facts. Prefer concise but thorough responses with actionable next steps; include a short rationale only when helpful (avoid long, step-by-step internal reasoning).",
	meeting_assistant:
		"You are a Meeting Assistant. Help the user with meeting notes, action items, and summaries. Focus on extracting key decisions, action items with owners, and important discussion points. Be concise and structured. Use any provided knowledge-base excerpts as source material and do not invent details that are not present.",
	technical_expert:
		"You are a Technical Expert. Provide deep technical analysis, code review, and expert-level explanations. Be thorough, identify potential issues, and suggest best practices. Use any provided knowledge-base excerpts as ground truth and clearly label assumptions when information is missing.",
	creative_writer:
		"You are a Creative Writing Assistant. Help with brainstorming, creative content generation, and storytelling. Be imaginative and offer multiple directions. If the user provides reference material in the knowledge base, incorporate it faithfully without inventing facts about it.",
	research_analyst:
		"You are a Research Analyst. Help with research, data analysis, and synthesizing information. Be methodical, cite sources when available, identify patterns, and present findings in a clear, structured manner. Prefer grounded answers using the knowledge base; if sources are missing, ask for what to search next.",
};

export class SupermemoryHelper {
	private apiKey: string;
	private readonly baseUrl = "https://api.supermemory.ai";
	private readonly containerTag: string;
	private readonly aboutYouFilePath: string;
	private readonly configFilePath: string;
	private readonly requestTimeoutMs = 30_000;
	private readonly uploadRequestTimeoutMs = 120_000;

	// In-memory customization state
	private config: CustomizeConfig = {
		role: "default",
		customRoleText: "",
		textContext: "",
		documents: [],
		userFacts: [],
		aboutYou: [],
	};

	constructor(apiKey: string) {
		this.apiKey = apiKey;
		// Set up persistence paths
		this.configFilePath = path.join(app.getPath("userData"), "customize-config.json");
		this.aboutYouFilePath = path.join(app.getPath("userData"), "about-you.json");
		this.containerTag = this.resolveContainerTag();

		// Load persisted config + About You data on startup
		this.loadConfigFromDisk();
		this.loadAboutYouFromDisk();
		console.log(
			`[SupermemoryHelper] Initialized with Supermemory API (containerTag=${this.containerTag})`,
		);
	}

	public getDefaultContainerTag(): string {
		return this.containerTag;
	}

	private static sanitizeContainerTag(input: string): string {
		const cleaned = input.trim().replace(/[^a-zA-Z0-9_-]/g, "_");
		return cleaned.slice(0, 100);
	}

	private buildDefaultContainerTag(): string {
		const nameSeed =
			SupermemoryHelper.sanitizeContainerTag(app.getName().toLowerCase()) || "app";
		const hash = createHash("sha256")
			.update(`${app.getPath("userData")}|${app.getAppPath()}`)
			.digest("hex")
			.slice(0, 16);
		return SupermemoryHelper.sanitizeContainerTag(`${nameSeed}_${hash}`);
	}

	private resolveContainerTag(): string {
		const envTag = process.env.SUPERMEMORY_CONTAINER_TAG;
		const trimmedEnv = typeof envTag === "string" ? envTag.trim() : "";
		if (trimmedEnv) {
			const sanitized = SupermemoryHelper.sanitizeContainerTag(trimmedEnv);
			if (sanitized) return sanitized;
		}
		return this.buildDefaultContainerTag();
	}

	private async requestText(
		endpoint: string,
		init: RequestInit,
		expectedStatus: number | number[] = 200,
		timeoutMs: number = this.requestTimeoutMs,
	): Promise<string> {
		const expected = Array.isArray(expectedStatus)
			? expectedStatus
			: [expectedStatus];

		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), timeoutMs);
		try {
			const response = await fetch(`${this.baseUrl}${endpoint}`, {
				...init,
				signal: controller.signal,
			});
			if (!expected.includes(response.status)) {
				const errorText = await response.text();
				throw new Error(
					`Supermemory API error: ${response.status} - ${errorText || response.statusText}`,
				);
			}
			return await response.text();
		} finally {
			clearTimeout(timeout);
		}
	}

	private async requestJson<T>(
		endpoint: string,
		init: RequestInit,
		expectedStatus: number | number[] = 200,
		timeoutMs?: number,
	): Promise<T> {
		const text = await this.requestText(endpoint, init, expectedStatus, timeoutMs);
		if (!text) return {} as T;
		return JSON.parse(text) as T;
	}

	// Load role/context/documents/user facts from local disk
	private loadConfigFromDisk(): void {
		try {
			if (!fs.existsSync(this.configFilePath)) return;

			const raw = fs.readFileSync(this.configFilePath, "utf-8");
			const data = JSON.parse(raw) as Partial<CustomizeConfig>;

			if (typeof data.role === "string") this.config.role = data.role;
			if (typeof data.customRoleText === "string") {
				this.config.customRoleText = data.customRoleText;
			}
			if (typeof data.textContext === "string") this.config.textContext = data.textContext;

			if (Array.isArray(data.userFacts)) {
				this.config.userFacts = data.userFacts.filter(
					(f): f is string => typeof f === "string" && f.trim().length > 0,
				);
			}

			if (Array.isArray(data.documents)) {
				this.config.documents = data.documents
					.filter((d): d is StoredDocument => {
						if (!d || typeof d !== "object") return false;
						const doc = d as StoredDocument;
						return (
							typeof doc.id === "string" &&
							typeof doc.name === "string" &&
							typeof doc.type === "string" &&
							typeof doc.addedAt === "number"
						);
					})
					.map((d) => ({ ...d }));
			}

			console.log(
				`[SupermemoryHelper] Loaded customization config from disk (role=${this.config.role}, documents=${this.config.documents.length}, facts=${this.config.userFacts.length})`,
			);
		} catch (error) {
			console.error("[SupermemoryHelper] Error loading config from disk:", error);
		}
	}

	// Save role/context/documents/user facts to local disk
	private saveConfigToDisk(): void {
		try {
			const dir = path.dirname(this.configFilePath);
			if (!fs.existsSync(dir)) {
				fs.mkdirSync(dir, { recursive: true });
			}
			const toSave = {
				role: this.config.role,
				customRoleText: this.config.customRoleText,
				textContext: this.config.textContext,
				documents: this.config.documents,
				userFacts: this.config.userFacts,
			} satisfies Omit<CustomizeConfig, "aboutYou">;

			fs.writeFileSync(this.configFilePath, JSON.stringify(toSave, null, 2));
		} catch (error) {
			console.error("[SupermemoryHelper] Error saving config to disk:", error);
		}
	}

	// Load About You entries from local disk
	private loadAboutYouFromDisk(): void {
		try {
			if (!fs.existsSync(this.aboutYouFilePath)) return;

			const parsed = JSON.parse(
				fs.readFileSync(this.aboutYouFilePath, "utf-8"),
			) as unknown;

			const rawEntries: unknown[] = (() => {
				if (Array.isArray(parsed)) return parsed;
				if (parsed && typeof parsed === "object") {
					const maybeEntries = (parsed as { entries?: unknown }).entries;
					if (Array.isArray(maybeEntries)) return maybeEntries;
				}
				return [];
			})();

			const sanitized: AboutYouEntry[] = [];
			let needsRewrite = !(
				parsed &&
				typeof parsed === "object" &&
				!Array.isArray(parsed) &&
				Array.isArray((parsed as { entries?: unknown[] }).entries)
			);

			for (const raw of rawEntries) {
				const entry = this.parseAboutYouEntry(raw);
				if (entry) sanitized.push(entry);
				else needsRewrite = true;
			}

			this.config.aboutYou = sanitized;
			console.log(
				`[SupermemoryHelper] Loaded ${this.config.aboutYou.length} About You entries from disk`,
			);

			// Heal malformed or legacy file formats.
			if (needsRewrite) {
				this.saveAboutYouToDisk();
			}
		} catch (error) {
			console.error("[SupermemoryHelper] Error loading About You from disk:", error);
			this.config.aboutYou = [];
		}
	}

	private parseAboutYouEntry(raw: unknown): AboutYouEntry | null {
		if (!raw || typeof raw !== "object") return null;
		const obj = raw as Record<string, unknown>;

		const title = typeof obj.title === "string" ? obj.title.trim() : "";
		if (!title) return null;

		const type = obj.type === "text" || obj.type === "file" ? obj.type : null;
		if (!type) return null;

		const id =
			typeof obj.id === "string" && obj.id.trim().length > 0
				? obj.id
				: randomUUID();

		const fileName =
			typeof obj.fileName === "string" && obj.fileName.trim().length > 0
				? obj.fileName
				: undefined;

		const contentRaw = obj.content;
		let content = typeof contentRaw === "string" ? contentRaw : "";
		if (type === "file" && (!content || !content.trim()) && fileName) {
			content = `[File: ${fileName}]`;
		}

		const filePath =
			typeof obj.filePath === "string" && obj.filePath.trim().length > 0
				? obj.filePath
				: undefined;

		const supermemoryId =
			typeof obj.supermemoryId === "string" && obj.supermemoryId.trim().length > 0
				? obj.supermemoryId
				: undefined;

		const addedAt =
			typeof obj.addedAt === "number" && Number.isFinite(obj.addedAt)
				? obj.addedAt
				: Date.now();

		return {
			id,
			title,
			content,
			type,
			filePath,
			fileName,
			supermemoryId,
			addedAt,
		};
	}

	// Save About You entries to local disk
	private saveAboutYouToDisk(): void {
		try {
			const dir = path.dirname(this.aboutYouFilePath);
			if (!fs.existsSync(dir)) {
				fs.mkdirSync(dir, { recursive: true });
			}
			fs.writeFileSync(
				this.aboutYouFilePath,
				JSON.stringify({ entries: this.config.aboutYou }, null, 2),
			);
			console.log(
				`[SupermemoryHelper] Saved ${this.config.aboutYou.length} About You entries to disk`,
			);
		} catch (error) {
			console.error("[SupermemoryHelper] Error saving About You to disk:", error);
		}
	}

	// Get current configuration
	public getConfig(): CustomizeConfig {
		return {
			role: this.config.role,
			customRoleText: this.config.customRoleText,
			textContext: this.config.textContext,
			documents: [...this.config.documents],
			userFacts: [...this.config.userFacts],
			aboutYou: [...this.config.aboutYou],
		};
	}

	// Set role
	public setRole(role: string, customText?: string): void {
		this.config.role = role;
		if (customText !== undefined) {
			this.config.customRoleText = customText;
		}
		this.saveConfigToDisk();
		console.log(`[SupermemoryHelper] Role set to: ${role}`);
	}

	// Set text context
	public setTextContext(text: string): void {
		this.config.textContext = text;
		this.saveConfigToDisk();
		console.log(
			`[SupermemoryHelper] Text context updated (${text.length} chars)`,
		);
	}

	// Set user facts
	public setUserFacts(facts: string[]): void {
		this.config.userFacts = facts;
		this.saveConfigToDisk();
		console.log(`[SupermemoryHelper] User facts updated (${facts.length} facts)`);
	}

	// Get the effective system prompt based on current config
	public getEffectiveSystemPrompt(): string {
		let prompt: string;

		if (this.config.role === "custom" && this.config.customRoleText) {
			prompt = this.config.customRoleText;
		} else if (ROLE_PRESETS[this.config.role]) {
			prompt = ROLE_PRESETS[this.config.role];
		} else {
			prompt = ROLE_PRESETS.default;
		}

		return prompt;
	}

	// Get additional context to append to prompts
	public getAdditionalContext(): string {
		const parts: string[] = [];

		// About You (always included, first priority - persistent personal info)
		if (this.config.aboutYou.length > 0) {
			const aboutYouText = this.config.aboutYou
				.map((entry) => `## ${entry.title}\n${entry.content}`)
				.join("\n\n");
			parts.push(`Personal Information:\n${aboutYouText}`);
		}

		// Session context (meeting notes, temporary context)
		if (this.config.textContext) {
			parts.push(`Session Context:\n${this.config.textContext}`);
		}

		// User facts (additional notes)
		if (this.config.userFacts.length > 0) {
			parts.push(`Additional Notes:\n${this.config.userFacts.join("\n")}`);
		}

		return parts.join("\n\n---\n\n");
	}

	// Add text content as memory
	public async addTextMemory(
		content: string,
		metadata?: Record<string, string | number | boolean>,
	): Promise<AddMemoryResponse> {
		try {
			return await this.addMemory({
				content,
				metadata: {
					type: "text_context",
					...(metadata ?? {}),
				},
			});
		} catch (error) {
			console.error("[SupermemoryHelper] Error adding text memory:", error);
			throw error;
		}
	}

	public async addMemory(params: {
		content: string;
		metadata?: Record<string, string | number | boolean>;
		customId?: string;
		raw?: string;
		containerTag?: string | null;
	}): Promise<AddMemoryResponse> {
		const containerTag =
			params.containerTag === undefined ? this.containerTag : params.containerTag;
		const metadata = params.metadata ?? {};
		const body: Record<string, unknown> = {
			content: params.content,
			metadata,
		};
		if (containerTag) body.containerTag = containerTag;
		if (params.customId) body.customId = params.customId;
		if (params.raw) body.raw = params.raw;

		const data = await this.requestJson<AddMemoryResponse>(
			"/v3/documents",
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${this.apiKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify(body),
			},
			200,
		);
		console.log(`[SupermemoryHelper] Memory added: ${data.id}`);
		return data;
	}

	private resolveMimeType(fileName: string, mimeType?: string): string {
		const candidate = mimeType?.trim();
		if (candidate && candidate !== "application/octet-stream") return candidate;
		return this.getMimeType(fileName);
	}

	private toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
		const buffer = bytes.buffer;
		if (buffer instanceof ArrayBuffer) {
			if (bytes.byteOffset === 0 && bytes.byteLength === buffer.byteLength) {
				return buffer;
			}
			return buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
		}

		// SharedArrayBuffer fallback: copy into a new ArrayBuffer.
		const copied = new Uint8Array(bytes.byteLength);
		copied.set(bytes);
		return copied.buffer;
	}

	private async uploadFileBytesToSupermemory(
		fileName: string,
		bytes: Uint8Array,
		mimeType?: string,
		options?: {
			metadata?: Record<string, string | number | boolean>;
			useAdvancedProcessing?: boolean;
			containerTags?: string[] | null;
		},
	): Promise<AddMemoryResponse> {
		const resolvedMimeType = this.resolveMimeType(fileName, mimeType);

		// Use standards-compliant FormData supported by Node/Electron fetch.
		// The `form-data` package is not compatible with undici's fetch and results in "[object FormData]" uploads.
		const formData = new FormData();
		const fileBuffer = this.toArrayBuffer(bytes);
			formData.append(
				"file",
				new Blob([fileBuffer], { type: resolvedMimeType }),
				fileName,
			);
			const effectiveContainerTags =
				options?.containerTags === undefined ? [this.containerTag] : options.containerTags;
			if (effectiveContainerTags && effectiveContainerTags.length > 0) {
				if (effectiveContainerTags.length === 1) {
					formData.append("containerTags", effectiveContainerTags[0] ?? "");
				} else {
					formData.append("containerTags", JSON.stringify(effectiveContainerTags));
				}
			}
		const normalizedMimeType = resolvedMimeType.toLowerCase();
		if (normalizedMimeType.startsWith("image/")) {
			formData.append("fileType", "image");
			formData.append("mimeType", resolvedMimeType);
		} else if (normalizedMimeType.startsWith("video/")) {
			formData.append("fileType", "video");
			formData.append("mimeType", resolvedMimeType);
		}
		if (options?.metadata) {
			formData.append("metadata", JSON.stringify(options.metadata));
		}
		if (options?.useAdvancedProcessing) {
			formData.append("useAdvancedProcessing", "true");
		}

		const data = await this.requestJson<AddMemoryResponse>(
			"/v3/documents/file",
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${this.apiKey}`,
				},
				body: formData,
			},
			200,
			this.uploadRequestTimeoutMs,
		);
		return data;
	}

	public async uploadFileMemoryData(
		fileName: string,
		bytes: Uint8Array,
		mimeType?: string,
		options?: {
			metadata?: Record<string, string | number | boolean>;
			useAdvancedProcessing?: boolean;
		},
	): Promise<AddMemoryResponse> {
		try {
			const mergedMetadata: Record<string, string | number | boolean> = {
				source: "upload",
				filename: fileName,
				...(options?.metadata ?? {}),
			};
			const response = await this.uploadFileBytesToSupermemory(
				fileName,
				bytes,
				mimeType,
				{
					metadata: mergedMetadata,
					useAdvancedProcessing: options?.useAdvancedProcessing,
				},
			);

			// Store document reference in config
			this.config.documents.push({
				id: response.id,
				name: fileName,
				type: this.resolveMimeType(fileName, mimeType),
				addedAt: Date.now(),
			});
			this.saveConfigToDisk();

			console.log(
				`[SupermemoryHelper] File uploaded: ${response.id} (${fileName})`,
			);
			return response;
		} catch (error) {
			console.error("[SupermemoryHelper] Error uploading file:", error);
			throw error;
		}
	}

	// Upload file as memory
	public async uploadFileMemory(filePath: string): Promise<AddMemoryResponse> {
		try {
			const fileName = path.basename(filePath);
			const fileBuffer = await fs.promises.readFile(filePath);
			const bytes = new Uint8Array(
				fileBuffer.buffer,
				fileBuffer.byteOffset,
				fileBuffer.byteLength,
			);
			return await this.uploadFileMemoryData(
				fileName,
				bytes,
				this.getMimeType(fileName),
				{
					metadata: {
						source: "upload",
						filename: fileName,
					},
				},
			);
		} catch (error) {
			console.error("[SupermemoryHelper] Error uploading file:", error);
			throw error;
		}
	}

	// Internal method - uploads file to Supermemory without adding to documents array
	// Used for About You file entries to avoid duplicate storage
	private async uploadFileToSupermemoryOnly(
		filePath: string,
	): Promise<AddMemoryResponse> {
		const fileName = path.basename(filePath);
		const fileBuffer = await fs.promises.readFile(filePath);
		const bytes = new Uint8Array(
			fileBuffer.buffer,
			fileBuffer.byteOffset,
			fileBuffer.byteLength,
		);
		return await this.uploadFileToSupermemoryOnlyData(
			fileName,
			bytes,
			this.getMimeType(fileName),
		);
	}

	private async uploadFileToSupermemoryOnlyData(
		fileName: string,
		bytes: Uint8Array,
		mimeType?: string,
	): Promise<AddMemoryResponse> {
		const data = await this.uploadFileBytesToSupermemory(fileName, bytes, mimeType, {
			metadata: {
				source: "about_you",
				filename: fileName,
			},
		});
		console.log(
			`[SupermemoryHelper] File uploaded to Supermemory only: ${data.id} (${fileName})`,
		);
		return data;
	}

	// Search memories
	public async searchMemories(
		query: string,
		options: MemorySearchOptions = {},
	): Promise<SearchResponse> {
		const limit = options.limit ?? 5;
		const threshold = options.threshold ?? 0.6;
		const rerank = options.rerank ?? false;
		const rewriteQuery = options.rewriteQuery ?? false;
			const include = options.include;
			const filters = options.filters;
			const containerTag =
				options.containerTag === undefined ? this.containerTag : options.containerTag;

		console.log(
			`[SupermemoryHelper] Searching memories (limit=${limit}, threshold=${threshold}, rerank=${rerank}, rewriteQuery=${rewriteQuery}, containerTag=${containerTag ?? "none"}) q="${query.substring(0, 80)}${query.length > 80 ? "..." : ""}"`,
		);
		try {
				const body: Record<string, unknown> = {
					q: query,
					limit,
					threshold,
					rerank,
					rewriteQuery,
				};
				if (containerTag) body.containerTag = containerTag;
				if (include) body.include = include;
				if (filters) body.filters = filters;

			const data = await this.requestJson<SearchResponse>(
				"/v4/search",
				{
					method: "POST",
					headers: {
						Authorization: `Bearer ${this.apiKey}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify(body),
				},
				200,
			);
			console.log(
				`[SupermemoryHelper] Search returned ${data.results.length} results (timing: ${data.timing}ms)`,
			);
			if (data.results.length > 0) {
				const top = data.results[0] as Partial<SearchResult>;
				const similarity =
					typeof top.similarity === "number" && Number.isFinite(top.similarity)
						? top.similarity.toFixed(3)
						: "n/a";
				const memoryPreview =
					typeof top.memory === "string"
						? `${top.memory.substring(0, 100)}${top.memory.length > 100 ? "..." : ""}`
						: "";
				console.log(
					`[SupermemoryHelper] Top result similarity: ${similarity}, preview: "${memoryPreview}"`,
				);
			}
			return data;
		} catch (error) {
			console.error("[SupermemoryHelper] Error searching memories:", error);
			throw error;
		}
	}

	public async searchDocuments(
		query: string,
		options: DocumentsSearchOptions = {},
	): Promise<DocumentsSearchResponse> {
		const limit = options.limit ?? 5;
		const containerTags =
			options.containerTags === undefined ? [this.containerTag] : options.containerTags;

		const rewriteQuery = options.rewriteQuery ?? false;
		const rerank = options.rerank ?? false;

		console.log(
			`[SupermemoryHelper] Searching documents (limit=${limit}, rewriteQuery=${rewriteQuery}, rerank=${rerank}, containerTags=${containerTags ? JSON.stringify(containerTags) : "none"}) q="${query.substring(0, 80)}${query.length > 80 ? "..." : ""}"`,
		);

		try {
			const body: Record<string, unknown> = {
				q: query,
				limit,
				rewriteQuery,
				rerank,
			};

			if (containerTags && containerTags.length > 0) body.containerTags = containerTags;
			if (options.filters) body.filters = options.filters;
			if (typeof options.documentThreshold === "number") {
				body.documentThreshold = options.documentThreshold;
			}
			if (typeof options.chunkThreshold === "number") {
				body.chunkThreshold = options.chunkThreshold;
			}
			if (typeof options.docId === "string" && options.docId.trim()) {
				body.docId = options.docId.trim();
			}
			if (typeof options.includeFullDocs === "boolean") {
				body.includeFullDocs = options.includeFullDocs;
			}
			if (typeof options.includeSummary === "boolean") {
				body.includeSummary = options.includeSummary;
			}
			if (typeof options.onlyMatchingChunks === "boolean") {
				body.onlyMatchingChunks = options.onlyMatchingChunks;
			}

			const data = await this.requestJson<DocumentsSearchResponse>(
				"/v3/search",
				{
					method: "POST",
					headers: {
						Authorization: `Bearer ${this.apiKey}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify(body),
				},
				200,
			);

			console.log(
				`[SupermemoryHelper] Document search returned ${data.results.length} results (timing: ${data.timing}ms)`,
			);
			return {
				results: Array.isArray(data.results) ? data.results : [],
				total: typeof data.total === "number" ? data.total : 0,
				timing: typeof data.timing === "number" ? data.timing : 0,
			};
		} catch (error) {
			console.error("[SupermemoryHelper] Error searching documents:", error);
			throw error;
		}
	}

	public async getProcessingDocuments(): Promise<ProcessingDocumentsResponse> {
		const raw = await this.requestJson<{
			documents?: Array<Record<string, unknown>>;
			total?: number;
			totalCount?: number;
		}>(
			"/v3/documents/processing",
			{
				method: "GET",
				headers: {
					Authorization: `Bearer ${this.apiKey}`,
				},
			},
			200,
		);

		const rawDocuments = Array.isArray(raw.documents) ? raw.documents : [];
		const documents: ProcessingDocument[] = [];
		for (const doc of rawDocuments) {
			const id = typeof doc.id === "string" ? doc.id : "";
			if (!id) continue;

			const rawStatus = typeof doc.status === "string" ? doc.status : "unknown";
			const status: ProcessingDocumentStatus = PROCESSING_DOCUMENT_STATUS_SET.has(
				rawStatus as ProcessingDocumentStatus,
			)
				? (rawStatus as ProcessingDocumentStatus)
				: "unknown";

			const containerTags =
				Array.isArray(doc.containerTags) && doc.containerTags.every((t) => typeof t === "string")
					? (doc.containerTags as string[])
					: Array.isArray(doc.container_tags) &&
							doc.container_tags.every((t) => typeof t === "string")
						? (doc.container_tags as string[])
						: undefined;

			const metadata =
				doc.metadata && typeof doc.metadata === "object" && !Array.isArray(doc.metadata)
					? (doc.metadata as Record<string, unknown>)
					: null;

			const titleRaw =
				typeof doc.title === "string"
					? doc.title
					: typeof metadata?.filename === "string"
						? metadata.filename
						: null;

			documents.push({
				id,
				status,
				title: titleRaw,
				containerTags,
			});
		}

		const totalCount =
			typeof raw.totalCount === "number"
				? raw.totalCount
				: typeof raw.total === "number"
					? raw.total
					: documents.length;

		return {
			documents,
			totalCount,
		};
	}

	public async getDocument(documentId: string): Promise<ListedDocument> {
		const id = documentId.trim();
		if (!id) throw new Error("Document id is required");

		const raw = await this.requestJson<Record<string, unknown>>(
			`/v3/documents/${encodeURIComponent(id)}`,
			{
				method: "GET",
				headers: {
					Authorization: `Bearer ${this.apiKey}`,
				},
			},
			200,
		);

		const status =
			typeof raw.status === "string"
				? raw.status
				: typeof raw.documentStatus === "string"
					? raw.documentStatus
					: null;

		const metadata =
			raw.metadata && typeof raw.metadata === "object" && !Array.isArray(raw.metadata)
				? (raw.metadata as Record<string, unknown>)
				: null;

		const containerTags =
			Array.isArray(raw.containerTags) && raw.containerTags.every((t) => typeof t === "string")
				? (raw.containerTags as string[])
				: Array.isArray(raw.container_tags) &&
						raw.container_tags.every((t) => typeof t === "string")
					? (raw.container_tags as string[])
					: null;

		const title =
			typeof raw.title === "string"
				? raw.title
				: typeof metadata?.filename === "string"
					? metadata.filename
					: null;

		const type = typeof raw.type === "string" ? raw.type : null;
		const summary = typeof raw.summary === "string" ? raw.summary : null;
		const connectionId = typeof raw.connectionId === "string" ? raw.connectionId : null;
		const customId = typeof raw.customId === "string" ? raw.customId : null;
		const createdAt = typeof raw.createdAt === "string" ? raw.createdAt : null;
		const updatedAt = typeof raw.updatedAt === "string" ? raw.updatedAt : null;

		return {
			id: typeof raw.id === "string" ? raw.id : id,
			status,
			title,
			type,
			summary,
			metadata,
			containerTags,
			connectionId,
			customId,
			createdAt,
			updatedAt,
		};
	}

	public async listDocuments(
		options: ListDocumentsOptions = {},
	): Promise<ListDocumentsResponse> {
		const limit = options.limit ?? 50;
		const page = options.page ?? 1;
		const order = options.order ?? "desc";
		const sort = options.sort ?? "createdAt";
		const containerTags =
			options.containerTags === undefined ? [this.containerTag] : options.containerTags;

		const body: Record<string, unknown> = {
			limit,
			page,
			order,
			sort,
		};
		if (containerTags && containerTags.length > 0) body.containerTags = containerTags;
		if (options.filters) body.filters = options.filters;

		const data = await this.requestJson<ListDocumentsResponse>(
			"/v3/documents/list",
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${this.apiKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify(body),
			},
			200,
		);
		return {
			memories: Array.isArray(data.memories) ? data.memories : [],
			pagination: data.pagination ?? null,
		};
	}

	public async listReadyDocuments(
		options: ListDocumentsOptions = {},
	): Promise<ListedDocument[]> {
		const list = await this.listDocuments(options);
		return list.memories.filter((doc) => doc?.status === "done");
	}

	public async listConnections(params?: {
		containerTags?: string[] | null;
	}): Promise<SupermemoryConnection[]> {
		const containerTags =
			params?.containerTags === undefined ? [this.containerTag] : params.containerTags;
		const body: Record<string, unknown> = {};
		if (containerTags && containerTags.length > 0) body.containerTags = containerTags;
		return await this.requestJson<SupermemoryConnection[]>(
			"/v3/connections/list",
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${this.apiKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify(body),
			},
			200,
		);
	}

	public async createConnection(
		provider: SupermemoryProvider,
		params?: {
			containerTags?: string[] | null;
			documentLimit?: number;
			metadata?: Record<string, string | number | boolean>;
			redirectUrl?: string;
		},
	): Promise<CreateConnectionResponse> {
		const containerTags =
			params?.containerTags === undefined ? [this.containerTag] : params.containerTags;
		const body: Record<string, unknown> = {};
		if (containerTags && containerTags.length > 0) body.containerTags = containerTags;
		if (typeof params?.documentLimit === "number") body.documentLimit = params.documentLimit;
		if (params?.metadata) body.metadata = params.metadata;
		if (typeof params?.redirectUrl === "string" && params.redirectUrl.trim()) {
			body.redirectUrl = params.redirectUrl.trim();
		}

		return await this.requestJson<CreateConnectionResponse>(
			`/v3/connections/${provider}`,
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${this.apiKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify(body),
			},
			200,
		);
	}

	public async syncConnection(
		provider: SupermemoryProvider,
		params?: { containerTags?: string[] | null },
	): Promise<{ message: string }> {
		const containerTags =
			params?.containerTags === undefined ? [this.containerTag] : params.containerTags;
		const body: Record<string, unknown> = {};
		if (containerTags && containerTags.length > 0) body.containerTags = containerTags;

		const message = await this.requestText(
			`/v3/connections/${provider}/import`,
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${this.apiKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify(body),
			},
			202,
		);
		return { message: message || "Importing connection..." };
	}

	public async deleteConnection(
		provider: SupermemoryProvider,
		params?: { containerTags?: string[] | null },
	): Promise<DeleteConnectionResponse> {
		const containerTags =
			params?.containerTags === undefined ? [this.containerTag] : params.containerTags;
		if (!containerTags || containerTags.length === 0) {
			throw new Error("containerTags are required to delete a connection");
		}

		return await this.requestJson<DeleteConnectionResponse>(
			`/v3/connections/${provider}`,
			{
				method: "DELETE",
				headers: {
					Authorization: `Bearer ${this.apiKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ containerTags }),
			},
			200,
		);
	}

	public async listConnectionDocuments(
		provider: SupermemoryProvider,
		params?: { containerTags?: string[] | null },
	): Promise<ConnectionDocument[]> {
		const containerTags =
			params?.containerTags === undefined ? [this.containerTag] : params.containerTags;
		const body: Record<string, unknown> = {};
		if (containerTags && containerTags.length > 0) body.containerTags = containerTags;

		return await this.requestJson<ConnectionDocument[]>(
			`/v3/connections/${provider}/documents`,
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${this.apiKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify(body),
			},
			200,
		);
	}

	public createStableCustomId(prefix: string, input: string): string {
		const hash = createHash("sha256").update(input).digest("hex").slice(0, 32);
		return `${prefix}_${hash}`;
	}

	// Get user profile
	public async getProfile(): Promise<ProfileResponse> {
		try {
			const data = await this.requestJson<ProfileResponse>(
				"/v4/profile",
				{
					method: "POST",
					headers: {
						Authorization: `Bearer ${this.apiKey}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						containerTag: this.containerTag,
					}),
				},
				200,
			);
			console.log("[SupermemoryHelper] Profile retrieved");
			return data;
		} catch (error) {
			console.error("[SupermemoryHelper] Error getting profile:", error);
			throw error;
		}
	}

	// Delete a document/memory
	public async deleteMemory(documentId: string): Promise<void> {
		try {
			const response = await fetch(
				`${this.baseUrl}/v3/documents/${documentId}`,
				{
					method: "DELETE",
					headers: {
						Authorization: `Bearer ${this.apiKey}`,
					},
				},
			);

			if (!response.ok) {
				// Treat missing documents as already-deleted so local state can recover.
				if (response.status === 404) {
					this.config.documents = this.config.documents.filter(
						(doc) => doc.id !== documentId,
					);
					this.saveConfigToDisk();
					console.warn(
						`[SupermemoryHelper] Memory not found on server (404), removed locally: ${documentId}`,
					);
					return;
				}
				const errorText = await response.text();
				console.error(
					"[SupermemoryHelper] Delete error:",
					response.status,
					errorText,
				);
				throw new Error(
					`Supermemory API error: ${response.status} - ${errorText}`,
				);
			}

			// Remove from local documents array
			this.config.documents = this.config.documents.filter(
				(doc) => doc.id !== documentId,
			);
			this.saveConfigToDisk();

			console.log(`[SupermemoryHelper] Memory deleted: ${documentId}`);
		} catch (error) {
			console.error("[SupermemoryHelper] Error deleting memory:", error);
			throw error;
		}
	}

	// Get stored documents
	public getDocuments(): StoredDocument[] {
		return [...this.config.documents];
	}

	// ==================== About You Methods ====================

	// Get all About You entries
	public getAboutYouEntries(): AboutYouEntry[] {
		return [...this.config.aboutYou];
	}

	// Add a text entry to About You
	public async addAboutYouTextEntry(
		title: string,
		content: string,
	): Promise<AboutYouEntry> {
		try {
			// Store in Supermemory
			const response = await this.addTextMemory(content, {
				type: "about_you",
				title,
			});

			const entry: AboutYouEntry = {
				id: randomUUID(),
				title,
				content,
				type: "text",
				supermemoryId: response.id,
				addedAt: Date.now(),
			};

			this.config.aboutYou.push(entry);
			this.saveAboutYouToDisk();

			console.log(`[SupermemoryHelper] Added About You text entry: ${title}`);
			return entry;
		} catch (error) {
			console.error("[SupermemoryHelper] Error adding About You text entry:", error);
			throw error;
		}
	}

	// Add a file entry to About You
	public async addAboutYouFileEntry(
		title: string,
		filePath: string,
	): Promise<AboutYouEntry> {
		try {
			const fileName = path.basename(filePath);

			// Upload to Supermemory (using internal method to avoid duplicate storage in documents)
			const response = await this.uploadFileToSupermemoryOnly(filePath);

			const entry: AboutYouEntry = {
				id: randomUUID(),
				title,
				content: `[File: ${fileName}]`, // Placeholder content for files
				type: "file",
				filePath,
				fileName,
				supermemoryId: response.id,
				addedAt: Date.now(),
			};

			this.config.aboutYou.push(entry);
			this.saveAboutYouToDisk();

			console.log(`[SupermemoryHelper] Added About You file entry: ${title} (${fileName})`);
			return entry;
		} catch (error) {
			console.error("[SupermemoryHelper] Error adding About You file entry:", error);
			throw error;
		}
	}

	// Add a file entry to About You from in-memory bytes (no local file path required)
	public async addAboutYouFileEntryData(
		title: string,
		fileName: string,
		bytes: Uint8Array,
		mimeType?: string,
	): Promise<AboutYouEntry> {
		try {
			// Upload to Supermemory (avoid duplicate storage in documents)
			const response = await this.uploadFileToSupermemoryOnlyData(
				fileName,
				bytes,
				mimeType,
			);

			const entry: AboutYouEntry = {
				id: randomUUID(),
				title,
				content: `[File: ${fileName}]`,
				type: "file",
				fileName,
				supermemoryId: response.id,
				addedAt: Date.now(),
			};

			this.config.aboutYou.push(entry);
			this.saveAboutYouToDisk();

			console.log(
				`[SupermemoryHelper] Added About You file entry (bytes): ${title} (${fileName})`,
			);
			return entry;
		} catch (error) {
			console.error(
				"[SupermemoryHelper] Error adding About You file entry (bytes):",
				error,
			);
			throw error;
		}
	}

	// Update an existing About You entry (text entries only)
	public async updateAboutYouEntry(
		id: string,
		title: string,
		content: string,
	): Promise<AboutYouEntry> {
		try {
			const entryIndex = this.config.aboutYou.findIndex((e) => e.id === id);
			if (entryIndex === -1) {
				throw new Error(`About You entry not found: ${id}`);
			}

			const existingEntry = this.config.aboutYou[entryIndex];

			// Only allow updating text entries
			if (existingEntry.type !== "text") {
				throw new Error("Cannot update file entries - delete and re-upload instead");
			}

			// Delete old Supermemory entry if exists
			if (existingEntry.supermemoryId) {
				try {
					await this.deleteMemory(existingEntry.supermemoryId);
				} catch (error) {
					console.warn("[SupermemoryHelper] Failed to delete old Supermemory entry:", error);
				}
			}

			// Create new Supermemory entry
			const response = await this.addTextMemory(content, {
				type: "about_you",
				title,
			});

			// Update local entry
			const updatedEntry: AboutYouEntry = {
				...existingEntry,
				title,
				content,
				supermemoryId: response.id,
			};

			this.config.aboutYou[entryIndex] = updatedEntry;
			this.saveAboutYouToDisk();

			console.log(`[SupermemoryHelper] Updated About You entry: ${title}`);
			return updatedEntry;
		} catch (error) {
			console.error("[SupermemoryHelper] Error updating About You entry:", error);
			throw error;
		}
	}

	// Delete an About You entry
	public async deleteAboutYouEntry(id: string): Promise<void> {
		try {
			const entry = this.config.aboutYou.find((e) => e.id === id);
			if (!entry) {
				throw new Error(`About You entry not found: ${id}`);
			}

			// Delete from Supermemory if exists
			if (entry.supermemoryId) {
				try {
					await this.deleteMemory(entry.supermemoryId);
				} catch (error) {
					console.warn("[SupermemoryHelper] Failed to delete from Supermemory:", error);
				}
			}

			// Remove from local config
			this.config.aboutYou = this.config.aboutYou.filter((e) => e.id !== id);
			this.saveAboutYouToDisk();

			console.log(`[SupermemoryHelper] Deleted About You entry: ${entry.title}`);
		} catch (error) {
			console.error("[SupermemoryHelper] Error deleting About You entry:", error);
			throw error;
		}
	}

	// Full reset - deletes all Supermemory data and resets local config
	public async fullReset(): Promise<void> {
		console.log("[SupermemoryHelper] Starting full reset...");

		// Disconnect all supported connections first to avoid re-syncing data during reset.
		try {
			const connections = await this.listConnections();
			const providers = new Set<SupermemoryProvider>([
				"notion",
				"google-drive",
				"onedrive",
			]);
			for (const conn of connections) {
				const provider = conn.provider;
				if (!providers.has(provider as SupermemoryProvider)) continue;
				try {
					await this.deleteConnection(provider as SupermemoryProvider);
					console.log(`[SupermemoryHelper] Disconnected: ${provider}`);
				} catch (error) {
					console.warn(
						`[SupermemoryHelper] Failed to disconnect ${provider}:`,
						error,
					);
				}
			}
		} catch (error) {
			console.warn("[SupermemoryHelper] Failed to list/disconnect connections:", error);
		}

		// Enumerate all documents in this container tag (uploads, links, notes, and connector docs).
		const limit = 100;
		let page = 1;
		const idsToDelete: string[] = [];
		const seen = new Set<string>();
		while (true) {
			const list = await this.listDocuments({
				limit,
				page,
				order: "desc",
				sort: "updatedAt",
			});
			for (const doc of list.memories) {
				if (!doc?.id || seen.has(doc.id)) continue;
				seen.add(doc.id);
				idsToDelete.push(doc.id);
			}

			const totalPages =
				typeof list.pagination?.totalPages === "number"
					? list.pagination.totalPages
					: null;
			if (totalPages !== null) {
				if (page >= totalPages) break;
				page += 1;
				continue;
			}

			if (list.memories.length < limit) break;
			page += 1;
			if (page > 200) {
				console.warn(
					"[SupermemoryHelper] Aborting full reset listing after 200 pages (safety cap)",
				);
				break;
			}
		}

		// Delete documents in batches to be efficient, with a per-ID fallback for robustness.
		const batchSize = 100;
		const bulkDelete = async (ids: string[]): Promise<void> => {
			await this.requestJson<BulkDeleteResponse>(
				"/v3/documents/bulk",
				{
					method: "DELETE",
					headers: {
						Authorization: `Bearer ${this.apiKey}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({ ids }),
				},
				[200, 204],
			);
		};

		for (let i = 0; i < idsToDelete.length; i += batchSize) {
			const batch = idsToDelete.slice(i, i + batchSize);
			try {
				await bulkDelete(batch);
				console.log(
					`[SupermemoryHelper] Deleted batch ${Math.floor(i / batchSize) + 1} (${batch.length} docs)`,
				);
			} catch (error) {
				console.warn(
					`[SupermemoryHelper] Bulk delete failed for batch ${Math.floor(i / batchSize) + 1}; falling back to per-doc deletes`,
					error,
				);
				for (const id of batch) {
					try {
						await this.deleteMemory(id);
					} catch (err) {
						console.warn(`[SupermemoryHelper] Failed to delete ${id}:`, err);
					}
				}
			}
		}

		// Reset local config
		this.config = {
			role: "default",
			customRoleText: "",
			textContext: "",
			documents: [],
			userFacts: [],
			aboutYou: [],
		};

		// Delete local About You file
		try {
			if (fs.existsSync(this.aboutYouFilePath)) {
				fs.unlinkSync(this.aboutYouFilePath);
				console.log("[SupermemoryHelper] Deleted local About You file");
			}
			if (fs.existsSync(this.configFilePath)) {
				fs.unlinkSync(this.configFilePath);
				console.log("[SupermemoryHelper] Deleted local config file");
			}
		} catch (error) {
			console.warn("[SupermemoryHelper] Failed to delete local files:", error);
		}

		console.log("[SupermemoryHelper] Full reset completed");
	}

	// Helper to get MIME type from filename
	private getMimeType(filename: string): string {
		const ext = path.extname(filename).toLowerCase();
		const mimeTypes: Record<string, string> = {
			".pdf": "application/pdf",
			".txt": "text/plain",
			".md": "text/markdown",
			".doc": "application/msword",
			".docx":
				"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
			".jpg": "image/jpeg",
			".jpeg": "image/jpeg",
			".png": "image/png",
			".gif": "image/gif",
			".webp": "image/webp",
			".mp4": "video/mp4",
			".webm": "video/webm",
			".csv": "text/csv",
		};
		return mimeTypes[ext] || "application/octet-stream";
	}

	// Reset configuration to defaults (in-memory only, does NOT delete Supermemory data)
	// Use fullReset() to also delete Supermemory data
	// Note: aboutYou is preserved since it's persisted to disk and will reload anyway
	public reset(): void {
		this.config = {
			role: "default",
			customRoleText: "",
			textContext: "",
			documents: [],
			userFacts: [],
			aboutYou: this.config.aboutYou, // Preserve - will reload from disk anyway
		};
		this.saveConfigToDisk();
		console.log("[SupermemoryHelper] Session settings reset (About You preserved)");
	}
}
