import WebSocket from "ws";

export type DeepgramV1SessionConfig = {
	apiKey: string;
	sampleRate: number;
	channels: number;
	language?: string;
	model?: string;
	punctuate?: boolean;
	interimResults?: boolean;
	endpointingMs?: number;
	utteranceEndMs?: number;
	vadEvents?: boolean;
	smartFormat?: boolean;
	numerals?: boolean;
	utterances?: boolean;
	multichannel?: boolean;
	diarize?: boolean;
	keywords?: string[];
	keyterms?: string[];
};

export type DeepgramV1Status =
	| { state: "idle" }
	| { state: "connecting" }
	| { state: "open" }
	| { state: "closing" }
	| { state: "closed"; code?: number; reason?: string }
	| { state: "error"; message: string };

export type DeepgramV1CaptionEvent = {
	channelIndex: number;
	text: string;
};

export type DeepgramV1UtteranceEvent = {
	channelIndex: number;
	text: string;
	startMs: number | null;
	endMs: number | null;
	speakerId: number | null;
};

export type DeepgramV1MetadataEvent = {
	requestId?: string;
	channels?: number;
	duration?: number;
};

export type DeepgramV1SessionEvents = {
	onStatus?: (status: DeepgramV1Status) => void;
	onCaption?: (event: DeepgramV1CaptionEvent) => void;
	onUtterance?: (event: DeepgramV1UtteranceEvent) => void;
	onMetadata?: (event: DeepgramV1MetadataEvent) => void;
	onRawMessage?: (message: unknown) => void;
};

type DeepgramWord = {
	start?: number;
	end?: number;
	word?: string;
	punctuated_word?: string;
	speaker?: number;
};

export class DeepgramV1Session {
	private readonly config: DeepgramV1SessionConfig;
	private readonly events: DeepgramV1SessionEvents;

	private ws: WebSocket | null = null;
	private status: DeepgramV1Status = { state: "idle" };
	private startedAt = 0;
	private isStopping = false;
	private reconnectAttempts = 0;
	private reconnectTimer: NodeJS.Timeout | null = null;

	private keepAliveTimer: NodeJS.Timeout | null = null;
	private lastAudioSentAt = 0;

	private readonly audioQueue: Buffer[] = [];
	private readonly maxQueuedFrames = 250;

	private finalTextByChannel: string[] = [];
	private finalWordsByChannel: DeepgramWord[][] = [];
	private lastCaptionByChannel: string[] = [];

	constructor(config: DeepgramV1SessionConfig, events: DeepgramV1SessionEvents = {}) {
		this.config = config;
		this.events = events;
	}

	public getStatus(): DeepgramV1Status {
		return this.status;
	}

	private setStatus(status: DeepgramV1Status): void {
		this.status = status;
		this.events.onStatus?.(status);
	}

	private buildUrl(): string {
		const url = new URL("wss://api.deepgram.com/v1/listen");

		url.searchParams.set("encoding", "linear16");
		url.searchParams.set("sample_rate", String(this.config.sampleRate));
		url.searchParams.set("channels", String(this.config.channels));

		if (this.config.language) url.searchParams.set("language", this.config.language);
		if (this.config.model) url.searchParams.set("model", this.config.model);

		if (this.config.punctuate ?? true) url.searchParams.set("punctuate", "true");
		if (this.config.interimResults ?? true) url.searchParams.set("interim_results", "true");
		if (typeof this.config.endpointingMs === "number") {
			url.searchParams.set("endpointing", String(Math.max(0, Math.round(this.config.endpointingMs))));
		}
		if (typeof this.config.utteranceEndMs === "number") {
			url.searchParams.set("utterance_end_ms", String(Math.max(0, Math.round(this.config.utteranceEndMs))));
		}
		if (this.config.vadEvents ?? true) url.searchParams.set("vad_events", "true");
		if (this.config.smartFormat ?? true) url.searchParams.set("smart_format", "true");
		if (this.config.numerals ?? true) url.searchParams.set("numerals", "true");
		if (this.config.utterances ?? true) url.searchParams.set("utterances", "true");

		if (this.config.multichannel) url.searchParams.set("multichannel", "true");
		if (this.config.diarize) url.searchParams.set("diarize", "true");

		for (const keyword of this.config.keywords ?? []) {
			const trimmed = keyword.trim();
			if (!trimmed) continue;
			url.searchParams.append("keywords", trimmed);
		}
		for (const keyterm of this.config.keyterms ?? []) {
			const trimmed = keyterm.trim();
			if (!trimmed) continue;
			url.searchParams.append("keyterm", trimmed);
		}

		return url.toString();
	}

	public async start(): Promise<void> {
		if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
		if (this.ws && this.ws.readyState === WebSocket.CONNECTING) return;
		if (!this.config.apiKey?.trim()) {
			throw new Error("Deepgram API key is missing");
		}

		this.isStopping = false;
		this.startedAt = Date.now();
		this.lastAudioSentAt = 0;
		this.finalTextByChannel = new Array(Math.max(1, this.config.channels)).fill("");
		this.finalWordsByChannel = new Array(Math.max(1, this.config.channels))
			.fill(null)
			.map((): DeepgramWord[] => []);
		this.lastCaptionByChannel = new Array(Math.max(1, this.config.channels)).fill("");

		this.setStatus({ state: "connecting" });

		const url = this.buildUrl();
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		const ws = new WebSocket(url, {
			headers: {
				Authorization: `Token ${this.config.apiKey}`,
			},
		});
		this.ws = ws;

		ws.on("open", () => {
			this.reconnectAttempts = 0;
			this.setStatus({ state: "open" });
			this.startKeepAlive();
			this.flushAudioQueue();
		});

		ws.on("message", (data: WebSocket.RawData) => {
			this.handleMessage(data);
		});

		ws.on("error", (error: Error) => {
			const message = error instanceof Error ? error.message : String(error);
			this.setStatus({ state: "error", message });
		});

		ws.on("close", (code: number, reason: Buffer) => {
			this.stopKeepAlive();
			this.ws = null;
			const reasonText = reason ? reason.toString() : "";
			this.setStatus({ state: "closed", code, reason: reasonText });
			if (!this.isStopping) {
				this.scheduleReconnect();
			}
		});
	}

	private scheduleReconnect(): void {
		if (this.reconnectTimer) return;
		const attempt = this.reconnectAttempts;
		const delay = Math.min(10_000, 1_000 * Math.pow(2, attempt));
		this.reconnectAttempts += 1;
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			if (this.isStopping) return;
			void this.start().catch((error) => {
				const message = error instanceof Error ? error.message : String(error);
				this.setStatus({ state: "error", message });
			});
		}, delay);
	}

	private startKeepAlive(): void {
		this.stopKeepAlive();
		this.keepAliveTimer = setInterval(() => {
			const ws = this.ws;
			if (!ws || ws.readyState !== WebSocket.OPEN) return;
			const lastAudio = this.lastAudioSentAt;
			if (!lastAudio) return;
			if (Date.now() - lastAudio < 8_000) return;
			try {
				ws.send(JSON.stringify({ type: "KeepAlive" }));
			} catch {
				// Ignore; socket error handler will surface issues.
			}
		}, 2_000);
	}

	private stopKeepAlive(): void {
		if (this.keepAliveTimer) {
			clearInterval(this.keepAliveTimer);
			this.keepAliveTimer = null;
		}
	}

	private flushAudioQueue(): void {
		const ws = this.ws;
		if (!ws || ws.readyState !== WebSocket.OPEN) return;
		while (this.audioQueue.length > 0) {
			const frame = this.audioQueue.shift();
			if (!frame) continue;
			try {
				ws.send(frame);
				this.lastAudioSentAt = Date.now();
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				this.setStatus({ state: "error", message });
				break;
			}
		}
	}

	public sendAudio(frame: Buffer): void {
		if (!frame || frame.length === 0) return;
		const ws = this.ws;
		if (!ws || ws.readyState !== WebSocket.OPEN) {
			this.audioQueue.push(frame);
			if (this.audioQueue.length > this.maxQueuedFrames) {
				this.audioQueue.splice(0, this.audioQueue.length - this.maxQueuedFrames);
			}
			return;
		}

		try {
			ws.send(frame);
			this.lastAudioSentAt = Date.now();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.setStatus({ state: "error", message });
		}
	}

	public async stop(): Promise<void> {
		if (this.isStopping) return;
		this.isStopping = true;
		this.setStatus({ state: "closing" });
		this.stopKeepAlive();
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}

		const ws = this.ws;
		if (!ws) {
			this.setStatus({ state: "closed" });
			return;
		}

		try {
			if (ws.readyState === WebSocket.OPEN) {
				ws.send(JSON.stringify({ type: "CloseStream" }));
			}
		} catch {
			// Ignore.
		}

		try {
			ws.close();
		} catch {
			// Ignore.
		}
	}

	private safeJsonParse(raw: string): unknown | null {
		try {
			return JSON.parse(raw) as unknown;
		} catch {
			return null;
		}
	}

	private handleMessage(data: WebSocket.RawData): void {
		const raw =
			typeof data === "string"
				? data
				: Buffer.isBuffer(data)
					? data.toString("utf8")
					: Array.isArray(data)
						? Buffer.concat(data).toString("utf8")
						: Buffer.from(data as ArrayBuffer).toString("utf8");

		const message = this.safeJsonParse(raw);
		if (!message || typeof message !== "object") return;
		this.events.onRawMessage?.(message);

		const type = (message as { type?: unknown }).type;
		if (typeof type !== "string") return;

		switch (type) {
			case "Results":
				this.handleResultsMessage(message as Record<string, unknown>);
				return;
			case "UtteranceEnd":
				this.handleUtteranceEndMessage(message as Record<string, unknown>);
				return;
			case "Metadata":
				this.handleMetadataMessage(message as Record<string, unknown>);
				return;
			default:
				return;
		}
	}

	private parseChannelIndex(message: Record<string, unknown>): number {
		const channelIndexRaw = message.channel_index;
		if (Array.isArray(channelIndexRaw) && typeof channelIndexRaw[0] === "number") {
			return channelIndexRaw[0];
		}
		return 0;
	}

	private parseTranscript(message: Record<string, unknown>): { transcript: string; words: DeepgramWord[] } {
		const channel = message.channel;
		if (!channel || typeof channel !== "object") return { transcript: "", words: [] };
		const alternatives = (channel as { alternatives?: unknown }).alternatives;
		if (!Array.isArray(alternatives) || alternatives.length === 0) {
			return { transcript: "", words: [] };
		}
		const alt0 = alternatives[0];
		if (!alt0 || typeof alt0 !== "object") return { transcript: "", words: [] };
		const transcript =
			typeof (alt0 as { transcript?: unknown }).transcript === "string"
				? ((alt0 as { transcript?: string }).transcript ?? "")
				: "";
		const wordsRaw = (alt0 as { words?: unknown }).words;
		const words: DeepgramWord[] = Array.isArray(wordsRaw)
			? (wordsRaw.filter((w) => w && typeof w === "object") as DeepgramWord[])
			: [];
		return { transcript, words };
	}

	private appendFinalSegment(channelIndex: number, segment: string): void {
		const trimmed = segment.trim();
		if (!trimmed) return;
		const prev = this.finalTextByChannel[channelIndex] ?? "";
		if (!prev) {
			this.finalTextByChannel[channelIndex] = trimmed;
			return;
		}
		if (trimmed === prev) return;
		if (trimmed.startsWith(prev)) {
			this.finalTextByChannel[channelIndex] = trimmed;
			return;
		}
		if (prev.endsWith(trimmed)) return;
		this.finalTextByChannel[channelIndex] = `${prev}${prev.endsWith(" ") ? "" : " "}${trimmed}`;
	}

	private appendFinalWords(channelIndex: number, words: DeepgramWord[]): void {
		if (!Array.isArray(words) || words.length === 0) return;
		const existing = this.finalWordsByChannel[channelIndex];
		if (!existing) {
			this.finalWordsByChannel[channelIndex] = [...words];
			return;
		}
		for (const w of words) existing.push(w);
	}

	private emitCaption(channelIndex: number, transcript: string): void {
		const cleaned = transcript.trim();
		if (!cleaned) return;
		const prev = this.lastCaptionByChannel[channelIndex] ?? "";
		if (cleaned === prev) return;
		this.lastCaptionByChannel[channelIndex] = cleaned;
		this.events.onCaption?.({ channelIndex, text: cleaned });
	}

	private buildTextFromWords(words: DeepgramWord[]): string {
		const parts: string[] = [];
		for (const word of words) {
			const token =
				typeof word.punctuated_word === "string"
					? word.punctuated_word
					: typeof word.word === "string"
						? word.word
						: "";
			const cleaned = token.trim();
			if (!cleaned) continue;
			parts.push(cleaned);
		}
		const joined = parts.join(" ").trim();
		if (!joined) return "";
		return joined.replace(/\s+([,.;:!?])/g, "$1");
	}

	private wordsHaveSpeakerLabels(words: DeepgramWord[]): boolean {
		return words.some((w) => typeof w.speaker === "number" && Number.isFinite(w.speaker));
	}

	private splitWordsIntoSpeakerTurns(words: DeepgramWord[]): Array<{ speakerId: number | null; words: DeepgramWord[] }> {
		const turns: Array<{ speakerId: number | null; words: DeepgramWord[] }> = [];
		let current: { speakerId: number | null; words: DeepgramWord[] } | null = null;
		let lastKnownSpeaker: number | null = null;

		for (const w of words) {
			const rawSpeaker = typeof w.speaker === "number" && Number.isFinite(w.speaker) ? w.speaker : null;
			const speaker = rawSpeaker ?? lastKnownSpeaker;
			if (speaker !== null) lastKnownSpeaker = speaker;

			const sameAsCurrent = current && current.speakerId === speaker;
			if (!current || !sameAsCurrent) {
				current = { speakerId: speaker, words: [] };
				turns.push(current);
			}
			current.words.push(w);
		}

		return turns
			.map((t) => ({ speakerId: t.speakerId, words: t.words.filter(Boolean) }))
			.filter((t) => t.words.length > 0);
	}

	private finalizeUtterance(params: {
		channelIndex: number;
		words: DeepgramWord[];
		endMsOverride?: number | null;
	}): void {
		const { channelIndex, words, endMsOverride } = params;
		const finalText = (this.finalTextByChannel[channelIndex] ?? "").trim();
		const hasSpeakerLabels = this.config.diarize ? this.wordsHaveSpeakerLabels(words) : false;

		if (this.config.diarize && hasSpeakerLabels) {
			const turns = this.splitWordsIntoSpeakerTurns(words);
			for (const turn of turns) {
				const textFromWords = this.buildTextFromWords(turn.words);
				const text = textFromWords || finalText;
				if (!text) continue;
				const startMs =
					typeof turn.words[0]?.start === "number"
						? Math.round((turn.words[0].start ?? 0) * 1000)
						: null;
				const endMsFromWords =
					typeof turn.words[turn.words.length - 1]?.end === "number"
						? Math.round((turn.words[turn.words.length - 1].end ?? 0) * 1000)
						: null;
				const endMs = endMsOverride !== undefined ? endMsOverride : endMsFromWords;
				this.events.onUtterance?.({
					channelIndex,
					text,
					startMs,
					endMs,
					speakerId: turn.speakerId,
				});
			}
		} else {
			const text = finalText || this.buildTextFromWords(words);
			if (!text) {
				this.finalTextByChannel[channelIndex] = "";
				this.finalWordsByChannel[channelIndex] = [];
				this.lastCaptionByChannel[channelIndex] = "";
				return;
			}

			const speakerId = (() => {
				if (!this.config.diarize) return null;
				const speakerCounts = new Map<number, number>();
				for (const w of words) {
					const speaker = typeof w.speaker === "number" ? w.speaker : null;
					if (speaker === null) continue;
					speakerCounts.set(speaker, (speakerCounts.get(speaker) ?? 0) + 1);
				}
				let best: { speaker: number; count: number } | null = null;
				for (const [speaker, count] of speakerCounts) {
					if (!best || count > best.count) best = { speaker, count };
				}
				return best?.speaker ?? null;
			})();

			const startMs =
				words.length > 0 && typeof words[0]?.start === "number"
					? Math.round((words[0].start ?? 0) * 1000)
					: null;
			const endMs =
				endMsOverride !== undefined
					? endMsOverride
					: words.length > 0 && typeof words[words.length - 1]?.end === "number"
						? Math.round(((words[words.length - 1].end as number) ?? 0) * 1000)
						: null;

			this.events.onUtterance?.({
				channelIndex,
				text,
				startMs,
				endMs,
				speakerId,
			});
		}

		this.finalTextByChannel[channelIndex] = "";
		this.finalWordsByChannel[channelIndex] = [];
		this.lastCaptionByChannel[channelIndex] = "";
	}

	private handleResultsMessage(message: Record<string, unknown>): void {
		const channelIndex = this.parseChannelIndex(message);
		const isFinal = (message as { is_final?: unknown }).is_final === true;
		const speechFinal = (message as { speech_final?: unknown }).speech_final === true;

		const { transcript, words } = this.parseTranscript(message);

		if (!isFinal) {
			this.emitCaption(channelIndex, transcript);
			return;
		}

		this.appendFinalSegment(channelIndex, transcript);
		this.appendFinalWords(channelIndex, words);
		if (speechFinal) {
			this.finalizeUtterance({
				channelIndex,
				words: this.finalWordsByChannel[channelIndex] ?? words,
			});
		}
	}

	private handleUtteranceEndMessage(message: Record<string, unknown>): void {
		const channelsRaw = message.channel;
		const channels =
			Array.isArray(channelsRaw) && channelsRaw.every((c) => typeof c === "number")
				? (channelsRaw as number[])
				: [this.parseChannelIndex(message)];
		const lastWordEnd =
			typeof message.last_word_end === "number"
				? Math.round(message.last_word_end * 1000)
				: null;

		for (const channelIndex of channels) {
			this.finalizeUtterance({
				channelIndex,
				words: this.finalWordsByChannel[channelIndex] ?? [],
				endMsOverride: lastWordEnd,
			});
		}
	}

	private handleMetadataMessage(message: Record<string, unknown>): void {
		const requestIdRaw =
			typeof message.request_id === "string" ? message.request_id : undefined;
		const channelsRaw = typeof message.channels === "number" ? message.channels : undefined;
		const durationRaw = typeof message.duration === "number" ? message.duration : undefined;
		this.events.onMetadata?.({
			requestId: requestIdRaw,
			channels: channelsRaw,
			duration: durationRaw,
		});
	}
}
