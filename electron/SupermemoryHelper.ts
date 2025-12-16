import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { randomUUID } from "node:crypto";

// Supermemory API response types
interface AddMemoryResponse {
	id: string;
	status: "queued" | "processing" | "done";
}

interface SearchResult {
	id: string;
	memory: string;
	similarity: number;
	title?: string;
	type?: string;
	metadata?: Record<string, unknown>;
}

interface SearchResponse {
	results: SearchResult[];
	total: number;
	timing: number;
}

interface ProfileResponse {
	profile: {
		static: string[];
		dynamic: string[];
	};
	searchResults?: SearchResponse;
}

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
		"You are Wingman AI, a helpful, proactive assistant for any kind of problem or situation (not just coding). For any user input, analyze the situation, provide a clear problem statement, relevant context, and suggest several possible responses or actions the user could take next. Always explain your reasoning. Present your suggestions as a list of options or next steps.",
	meeting_assistant:
		"You are a Meeting Assistant AI. Help the user with meeting notes, action items, and summaries. Focus on extracting key decisions, action items with owners, and important discussion points. Be concise and structured in your responses.",
	technical_expert:
		"You are a Technical Expert AI. Provide deep technical analysis, code review, and expert-level explanations. Be thorough in your analysis, identify potential issues, and suggest best practices. Use technical terminology appropriately.",
	creative_writer:
		"You are a Creative Writing Assistant. Help with brainstorming, creative content generation, and storytelling. Be imaginative and offer multiple creative directions. Encourage exploration of different perspectives and ideas.",
	research_analyst:
		"You are a Research Analyst AI. Help with research, data analysis, and synthesizing information. Be methodical, cite sources when available, identify patterns, and present findings in a clear, structured manner.",
};

export class SupermemoryHelper {
	private apiKey: string;
	private readonly baseUrl = "https://api.supermemory.ai";
	private readonly containerTag = "clueless_user_default";
	private readonly aboutYouFilePath: string;
	private readonly configFilePath: string;

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

		// Load persisted config + About You data on startup
		this.loadConfigFromDisk();
		this.loadAboutYouFromDisk();
		console.log("[SupermemoryHelper] Initialized with Supermemory API");
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
			const response = await fetch(`${this.baseUrl}/v3/documents`, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${this.apiKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					content,
					containerTag: this.containerTag,
					metadata: {
						type: "text_context",
						...metadata,
					},
				}),
			});

			if (!response.ok) {
				const errorText = await response.text();
				console.error(
					"[SupermemoryHelper] Add memory error:",
					response.status,
					errorText,
				);
				throw new Error(
					`Supermemory API error: ${response.status} - ${errorText}`,
				);
			}

			const data: AddMemoryResponse = await response.json();
			console.log(`[SupermemoryHelper] Memory added: ${data.id}`);
			return data;
		} catch (error) {
			console.error("[SupermemoryHelper] Error adding text memory:", error);
			throw error;
		}
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
		// Supermemory APIs have used both `containerTag` and `containerTags` in different versions; send both for compatibility.
		formData.append("containerTag", this.containerTag);
		formData.append("containerTags", this.containerTag);

		const response = await fetch(`${this.baseUrl}/v3/documents/file`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${this.apiKey}`,
			},
			body: formData,
		});

		if (!response.ok) {
			const errorText = await response.text();
			console.error(
				"[SupermemoryHelper] Upload file error:",
				response.status,
				errorText,
			);
			throw new Error(
				`Supermemory API error: ${response.status} - ${errorText}`,
			);
		}

		const data: AddMemoryResponse = await response.json();
		return data;
	}

	public async uploadFileMemoryData(
		fileName: string,
		bytes: Uint8Array,
		mimeType?: string,
	): Promise<AddMemoryResponse> {
		try {
			const response = await this.uploadFileBytesToSupermemory(
				fileName,
				bytes,
				mimeType,
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
		const data = await this.uploadFileBytesToSupermemory(fileName, bytes, mimeType);
		console.log(
			`[SupermemoryHelper] File uploaded to Supermemory only: ${data.id} (${fileName})`,
		);
		return data;
	}

	// Search memories
	public async searchMemories(
		query: string,
		limit = 5,
		threshold = 0.6,
	): Promise<SearchResponse> {
		console.log(`[SupermemoryHelper] Searching memories with query: "${query.substring(0, 80)}${query.length > 80 ? '...' : ''}"`);
		try {
			const response = await fetch(`${this.baseUrl}/v4/search`, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${this.apiKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					q: query,
					containerTag: this.containerTag,
					limit,
					threshold,
					rerank: false,
					rewriteQuery: false,
				}),
			});

			if (!response.ok) {
				const errorText = await response.text();
				console.error(
					"[SupermemoryHelper] Search error:",
					response.status,
					errorText,
				);
				throw new Error(
					`Supermemory API error: ${response.status} - ${errorText}`,
				);
			}

			const data: SearchResponse = await response.json();
			console.log(
				`[SupermemoryHelper] Search returned ${data.results.length} results (timing: ${data.timing}ms)`,
			);
			if (data.results.length > 0) {
				console.log(`[SupermemoryHelper] Top result similarity: ${data.results[0].similarity.toFixed(3)}, preview: "${data.results[0].memory?.substring(0, 100)}..."`);
			}
			return data;
		} catch (error) {
			console.error("[SupermemoryHelper] Error searching memories:", error);
			throw error;
		}
	}

	// Get user profile
	public async getProfile(): Promise<ProfileResponse> {
		try {
			const response = await fetch(`${this.baseUrl}/v4/profile`, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${this.apiKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					containerTag: this.containerTag,
				}),
			});

			if (!response.ok) {
				const errorText = await response.text();
				console.error(
					"[SupermemoryHelper] Profile error:",
					response.status,
					errorText,
				);
				throw new Error(
					`Supermemory API error: ${response.status} - ${errorText}`,
				);
			}

			const data: ProfileResponse = await response.json();
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

		// Delete all documents from Supermemory
		for (const doc of [...this.config.documents]) {
			try {
				await this.deleteMemory(doc.id);
				console.log(`[SupermemoryHelper] Deleted document: ${doc.name}`);
			} catch (error) {
				console.warn(`[SupermemoryHelper] Failed to delete document ${doc.id}:`, error);
			}
		}

		// Delete all About You entries from Supermemory
		for (const entry of [...this.config.aboutYou]) {
			if (entry.supermemoryId) {
				try {
					await this.deleteMemory(entry.supermemoryId);
					console.log(`[SupermemoryHelper] Deleted About You entry: ${entry.title}`);
				} catch (error) {
					console.warn(`[SupermemoryHelper] Failed to delete About You entry ${entry.id}:`, error);
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
