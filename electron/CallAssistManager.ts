import path from "node:path";
import fs from "node:fs";
import { app } from "electron";
import { randomUUID } from "node:crypto";
import { DeepgramV1Session, type DeepgramV1Status } from "./DeepgramV1Session";
import { WavWriter } from "./WavWriter";
import type { AppState } from "./main";

export type CallAssistMode = "multichannel" | "diarize";

export type CallAssistStartParams = {
	mode: CallAssistMode;
	sampleRate: number;
	channels: number;
	model?: string;
	language?: string;
	endpointingMs?: number;
	utteranceEndMs?: number;
	keywords?: string[];
	keyterms?: string[];
	youChannelIndex?: number;
	diarizeYouSpeakerId?: number | null;
	autoSaveToMemory?: boolean;
	autoSuggest?: boolean;
	autoSummary?: boolean;
};

export type CallAssistSessionInfo = {
	sessionId: string;
	recordingPath: string;
	startedAt: number;
};

export type CallAssistStatusEvent = DeepgramV1Status;

export type CallAssistCaptionEvent = {
	sessionId: string;
	channelIndex: number;
	speakerLabel: string;
	text: string;
};

export type CallAssistUtteranceEvent = {
	sessionId: string;
	utteranceId: string;
	channelIndex: number;
	speakerId: number | null;
	speakerLabel: string;
	text: string;
	startMs: number | null;
	endMs: number | null;
};

export type CallAssistMetadataEvent = {
	sessionId: string;
	requestId?: string;
	channels?: number;
	duration?: number;
};

export type CallAssistSuggestionEvent = {
	sessionId: string;
	utteranceId: string;
	suggestion: string;
};

export type CallAssistSummaryEvent = {
	sessionId: string;
	summary: string;
};

export class CallAssistManager {
	private readonly appState: AppState;

	private session: DeepgramV1Session | null = null;
	private wavWriter: WavWriter | null = null;
	private sessionInfo: CallAssistSessionInfo | null = null;

	private mode: CallAssistMode = "multichannel";
	private youChannelIndex = 0;
	private diarizeYouSpeakerId: number | null = null;
	private autoSaveToMemory = true;
	private autoSuggest = true;
	private autoSummary = true;

	private recentTurns: Array<{ speakerLabel: string; text: string }> = [];
	private suggestionInFlight = false;
	private pendingSuggestion: { utteranceId: string; utterance: string } | null = null;

	constructor(appState: AppState) {
		this.appState = appState;
	}

	public getActiveSession(): CallAssistSessionInfo | null {
		return this.sessionInfo;
	}

	public getTranscriptTail(maxTurns = 12): string {
		const n = Number.isFinite(maxTurns) ? Math.max(0, Math.round(maxTurns)) : 12;
		return this.recentTurns
			.slice(-n)
			.map((t) => `${t.speakerLabel}: ${t.text}`)
			.join("\n");
	}

	public getMostRecentQuestion(maxLookback = 24): { speakerLabel: string; text: string } | null {
		const looksLikeQuestion = (text: string): boolean => {
			const trimmed = text.trim();
			if (trimmed.length < 6) return false;
			if (trimmed.includes("?")) return true;
			return (
				/^(what|why|how|when|where|who|which|can|could|would|should|do|does|did|is|are|will|have|has|had)\b/i.test(
					trimmed,
				) && trimmed.length <= 220
			);
		};

		const rawLookback = Math.max(1, Math.round(maxLookback));
		const total = this.recentTurns.length;
		if (total === 0) return null;

		// Match `slice(-rawLookback)` semantics for NaN/Infinity.
		const startIndex =
			Number.isFinite(rawLookback) && rawLookback < total ? total - rawLookback : 0;

		let mostRecentQuestion: { speakerLabel: string; text: string } | null = null;
		let mostRecentNotYou: { speakerLabel: string; text: string } | null = null;

		// Walk backwards once instead of allocating slice/reverse/filter arrays.
		for (let i = total - 1; i >= startIndex; i -= 1) {
			const turn = this.recentTurns[i];
			if (!looksLikeQuestion(turn.text)) continue;

			if (!mostRecentQuestion) {
				mostRecentQuestion = turn;
			}

			// Prefer the most recent "Them" question.
			if (turn.speakerLabel === "Them") {
				return turn;
			}

			// Otherwise prefer the most recent question from anyone other than "You".
			if (!mostRecentNotYou && turn.speakerLabel !== "You") {
				mostRecentNotYou = turn;
			}
		}

		return mostRecentNotYou ?? mostRecentQuestion ?? null;
	}

	private sendToRenderer(channel: string, payload?: unknown): void {
		const win = this.appState.getMainWindow();
		if (!win) return;
		win.webContents.send(channel, payload);
	}

	private ensureRecordingsDir(): string {
		const dir = path.join(app.getPath("userData"), "recordings");
		if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
		return dir;
	}

	public async start(params: CallAssistStartParams): Promise<CallAssistSessionInfo> {
		if (this.sessionInfo) {
			return this.sessionInfo;
		}

		const apiKey = process.env.DEEPGRAM_API_KEY;
		if (!apiKey) {
			throw new Error("DEEPGRAM_API_KEY not found in environment variables");
		}

		const mode = params.mode;
		this.mode = mode;
		const channels = Math.max(1, Math.round(params.channels));
		const sampleRate = Math.max(8000, Math.round(params.sampleRate));

		this.youChannelIndex =
			typeof params.youChannelIndex === "number" && Number.isFinite(params.youChannelIndex)
				? Math.max(0, Math.min(channels - 1, Math.round(params.youChannelIndex)))
				: 0;
		this.diarizeYouSpeakerId =
			typeof params.diarizeYouSpeakerId === "number" && Number.isFinite(params.diarizeYouSpeakerId)
				? Math.max(0, Math.round(params.diarizeYouSpeakerId))
				: null;
		this.autoSaveToMemory = params.autoSaveToMemory ?? true;
		this.autoSuggest = params.autoSuggest ?? true;
		this.autoSummary = params.autoSummary ?? true;
		this.recentTurns = [];
		this.suggestionInFlight = false;
		this.pendingSuggestion = null;

		const sessionId = randomUUID();
		const recordingsDir = this.ensureRecordingsDir();
		const safeTimestamp = new Date()
			.toISOString()
			.replace(/[:.]/g, "-")
			.replace("T", "_")
			.replace("Z", "");
		const recordingPath = path.join(
			recordingsDir,
			`call_${safeTimestamp}_${sessionId.slice(0, 8)}.wav`,
		);

		this.wavWriter = new WavWriter({
			filePath: recordingPath,
			sampleRate,
			channels,
			bitsPerSample: 16,
		});

		const speakerLabelForUtterance = (channelIndex: number, speakerId: number | null): string => {
			if (mode === "multichannel") {
				return channelIndex === this.youChannelIndex ? "You" : "Them";
			}
			if (this.diarizeYouSpeakerId !== null && speakerId !== null) {
				return speakerId === this.diarizeYouSpeakerId ? "You" : "Them";
			}
			if (speakerId !== null) return `Speaker ${speakerId + 1}`;
			return "Speaker";
		};

		const speakerLabelForCaption = (channelIndex: number): string => {
			if (mode === "multichannel") {
				return channelIndex === this.youChannelIndex ? "You" : "Them";
			}
			return "Live";
		};

		const isTheirTurn = (channelIndex: number, speakerId: number | null): boolean => {
			if (mode === "multichannel") return channelIndex !== this.youChannelIndex;
			if (this.diarizeYouSpeakerId === null) return false;
			if (speakerId === null) return false;
			return speakerId !== this.diarizeYouSpeakerId;
		};

		const session = new DeepgramV1Session(
			{
				apiKey,
				sampleRate,
				channels,
				model: params.model || "general",
				language: params.language || "en",
				punctuate: true,
				interimResults: true,
				endpointingMs: params.endpointingMs ?? 450,
				utteranceEndMs: params.utteranceEndMs ?? 1100,
				vadEvents: true,
				smartFormat: true,
				numerals: true,
				utterances: true,
				multichannel: mode === "multichannel" && channels >= 2,
				diarize: mode === "diarize",
				keywords: params.keywords ?? [],
				keyterms: params.keyterms ?? [],
			},
			{
				onStatus: (status) => {
					this.sendToRenderer("call-assist-status", {
						sessionId,
						...status,
					});
				},
				onCaption: (evt) => {
					this.sendToRenderer("call-assist-caption", {
						sessionId,
						channelIndex: evt.channelIndex,
						speakerLabel: speakerLabelForCaption(evt.channelIndex),
						text: evt.text,
					} satisfies CallAssistCaptionEvent);
				},
				onUtterance: (evt) => {
					const utteranceId = randomUUID();
					const speakerId = evt.speakerId ?? null;
					const payload: CallAssistUtteranceEvent = {
						sessionId,
						utteranceId,
						channelIndex: evt.channelIndex,
						speakerId,
						speakerLabel: speakerLabelForUtterance(evt.channelIndex, speakerId),
						text: evt.text,
						startMs: evt.startMs,
						endMs: evt.endMs,
					};

					this.sendToRenderer("call-assist-utterance", payload);
					this.recentTurns.push({
						speakerLabel: payload.speakerLabel,
						text: payload.text,
					});
					if (this.recentTurns.length > 16) {
						this.recentTurns = this.recentTurns.slice(this.recentTurns.length - 16);
					}

					if (this.autoSuggest && isTheirTurn(payload.channelIndex, payload.speakerId)) {
						this.maybeQueueSuggestion({
							utteranceId,
							utterance: payload.text,
						});
					}
					void this.persistUtteranceToMemory(payload);
				},
				onMetadata: (evt) => {
					this.sendToRenderer("call-assist-metadata", {
						sessionId,
						requestId: evt.requestId,
						channels: evt.channels,
						duration: evt.duration,
					} satisfies CallAssistMetadataEvent);
				},
			},
		);

		this.session = session;

		try {
			await session.start();
			this.sessionInfo = { sessionId, recordingPath, startedAt: Date.now() };
			this.sendToRenderer("call-assist-started", this.sessionInfo);
			return this.sessionInfo;
		} catch (error) {
			try {
				await session.stop();
			} catch {
				// Ignore.
			}
			try {
				this.wavWriter?.close();
			} catch {
				// Ignore.
			}

			if (this.session === session) this.session = null;
			this.wavWriter = null;
			this.sessionInfo = null;
			this.recentTurns = [];
			this.suggestionInFlight = false;
			this.pendingSuggestion = null;
			throw error;
		}
	}

	private shouldTriggerSuggestion(text: string): boolean {
		const trimmed = text.trim();
		if (trimmed.length < 12) return false;
		if (trimmed.includes("?")) return true;
		if (/^(what|why|how|when|where|who|can|could|would|should|do|does|did|is|are|will)\b/i.test(trimmed)) {
			return true;
		}
		return trimmed.length >= 64;
	}

	private maybeQueueSuggestion(params: { utteranceId: string; utterance: string }): void {
		if (!this.sessionInfo) return;
		if (!this.shouldTriggerSuggestion(params.utterance)) return;
		if (this.suggestionInFlight) {
			this.pendingSuggestion = params;
			return;
		}
		void this.runSuggestion(params);
	}

	private buildTranscriptTail(maxTurns = 10): string {
		return this.recentTurns
			.slice(-maxTurns)
			.map((t) => `${t.speakerLabel}: ${t.text}`)
			.join("\n");
	}

	private async runSuggestion(params: { utteranceId: string; utterance: string }): Promise<void> {
		if (!this.sessionInfo) return;
		this.suggestionInFlight = true;
		const sessionId = this.sessionInfo.sessionId;
		try {
			const transcriptTail = this.buildTranscriptTail();
			const suggestion = await this.appState.processingHelper.generateCallAssistSuggestion({
				callId: sessionId,
				utterance: params.utterance,
				transcriptTail,
			});
			if (!suggestion?.trim()) return;
			const active = this.sessionInfo;
			if (!active || active.sessionId !== sessionId) return;
			this.sendToRenderer("call-assist-suggestion", {
				sessionId,
				utteranceId: params.utteranceId,
				suggestion,
			} satisfies CallAssistSuggestionEvent);
		} catch (error) {
			const active = this.sessionInfo;
			if (active && active.sessionId === sessionId) {
				this.sendToRenderer("call-assist-error", {
					sessionId,
					message: error instanceof Error ? error.message : String(error),
				});
			}
		} finally {
			this.suggestionInFlight = false;
			const pending = this.pendingSuggestion;
			this.pendingSuggestion = null;
			if (pending && this.sessionInfo && this.sessionInfo.sessionId === sessionId) {
				void this.runSuggestion(pending);
			}
		}
	}

	public handleAudioFrame(params: { sessionId: string; pcm: Buffer }): void {
		if (!this.sessionInfo || params.sessionId !== this.sessionInfo.sessionId) return;
		if (!this.session || !this.wavWriter) return;

		try {
			this.wavWriter.write(params.pcm);
		} catch (error) {
			this.sendToRenderer("call-assist-error", {
				sessionId: params.sessionId,
				message: error instanceof Error ? error.message : String(error),
			});
		}

		this.session.sendAudio(params.pcm);
	}

	private async persistUtteranceToMemory(payload: CallAssistUtteranceEvent): Promise<void> {
		if (!this.autoSaveToMemory) return;
		const helper = this.appState.processingHelper.getSupermemoryHelper();
		if (!helper) return;

		try {
			const stableInput = [
				payload.sessionId,
				payload.channelIndex,
				payload.speakerId ?? "",
				payload.startMs ?? "",
				payload.endMs ?? "",
				payload.text,
			].join("|");
			const customId = helper.createStableCustomId("call_utt", stableInput);
			await helper.addMemory({
				content: `${payload.speakerLabel}: ${payload.text}`,
				customId,
				metadata: {
					type: "call_utterance",
					source: "call",
					callId: payload.sessionId,
					speaker: payload.speakerLabel,
					speakerId: payload.speakerId ?? undefined,
					channelIndex: payload.channelIndex,
					startMs: payload.startMs ?? undefined,
					endMs: payload.endMs ?? undefined,
				},
			});
		} catch (error) {
			this.sendToRenderer("call-assist-error", {
				sessionId: payload.sessionId,
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}

	public async stop(sessionId: string): Promise<void> {
		if (!this.sessionInfo || this.sessionInfo.sessionId !== sessionId) return;
		const turnsSnapshot = [...this.recentTurns];
		const startedAt = this.sessionInfo.startedAt;
		const endedAt = Date.now();

		try {
			await this.session?.stop();
		} finally {
			this.session = null;
		}

		try {
			await this.wavWriter?.close();
		} catch {
			// Ignore.
		} finally {
			this.wavWriter = null;
		}

		this.sendToRenderer("call-assist-stopped", { sessionId });
		this.sessionInfo = null;
		if (this.autoSummary && turnsSnapshot.length > 0) {
			void this.generateSummary(sessionId, turnsSnapshot, { startedAt, endedAt });
		}
		this.recentTurns = [];
		this.pendingSuggestion = null;
	}

	private async generateSummary(
		sessionId: string,
		turns: Array<{ speakerLabel: string; text: string }>,
		meta: { startedAt: number; endedAt: number },
	): Promise<void> {
		try {
			const transcript = turns.map((t) => `${t.speakerLabel}: ${t.text}`).join("\n");
			const summary = await this.appState.processingHelper.generateCallSummary({
				callId: sessionId,
				transcript,
			});
			if (!summary.trim()) return;

			this.sendToRenderer("call-assist-summary", {
				sessionId,
				summary,
			} satisfies CallAssistSummaryEvent);

			const helper = this.appState.processingHelper.getSupermemoryHelper();
			if (!helper) return;
			const customId = helper.createStableCustomId("call_summary", sessionId);
			await helper.addMemory({
				content: summary,
				customId,
				metadata: {
					type: "call_summary",
					source: "call",
					callId: sessionId,
					startedAt: meta.startedAt,
					endedAt: meta.endedAt,
				},
			});
		} catch (error) {
			this.sendToRenderer("call-assist-error", {
				sessionId,
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}
}
