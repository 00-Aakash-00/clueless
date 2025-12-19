import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	IoClose,
	IoMic,
	IoPause,
	IoPlay,
	IoRefresh,
	IoSave,
	IoSettings,
	IoWarning,
} from "react-icons/io5";

type Mode = "multichannel" | "diarize";

type AudioPipeline = {
	audioContext: AudioContext;
	processor: ScriptProcessorNode;
	gain: GainNode;
	micStream: MediaStream;
	displayStream: MediaStream | null;
	sessionId: string;
};

const clampInt16 = (value: number): number => {
	const clamped = Math.max(-1, Math.min(1, value));
	return clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
};

const interleaveToLinear16 = (channels: Float32Array[]): ArrayBuffer => {
	const channelCount = channels.length;
	const frames = channels[0]?.length ?? 0;
	const out = new Int16Array(frames * channelCount);
	for (let i = 0; i < frames; i += 1) {
		for (let c = 0; c < channelCount; c += 1) {
			out[i * channelCount + c] = clampInt16(channels[c]?.[i] ?? 0);
		}
	}
	return out.buffer;
};

export const CallAssistPanel: React.FC<{ onClose?: () => void }> = ({ onClose }) => {
	const [mode, setMode] = useState<Mode>("multichannel");
	const [youChannelIndex, setYouChannelIndex] = useState(0);
	const [diarizeYouSpeakerId, setDiarizeYouSpeakerId] = useState<number | null>(null);
	const [autoSaveToMemory, setAutoSaveToMemory] = useState(true);
	const [autoSuggest, setAutoSuggest] = useState(true);
	const [autoSummary, setAutoSummary] = useState(true);
	const [keywordsText, setKeywordsText] = useState("");

	const [status, setStatus] = useState<CallAssistStatusEvent | null>(null);
	const [session, setSession] = useState<CallAssistSessionInfo | null>(null);
	const [requestId, setRequestId] = useState<string>("");
	const [recordingPath, setRecordingPath] = useState<string>("");
	const [lastError, setLastError] = useState<string>("");
	const [notice, setNotice] = useState<string>("");
	const [summary, setSummary] = useState<string>("");

	const [captions, setCaptions] = useState<Record<string, string>>({});
	const [utterances, setUtterances] = useState<CallAssistUtteranceEvent[]>([]);
	const [suggestions, setSuggestions] = useState<CallAssistSuggestionEvent[]>([]);

	const pipelineRef = useRef<AudioPipeline | null>(null);
	const expectedSummarySessionIdRef = useRef<string | null>(null);
	const lastLevelUpdateRef = useRef<number>(0);
	const [levels, setLevels] = useState<{ mic: number; sys: number }>({ mic: 0, sys: 0 });

	const isRunning = !!session;
	const canStart = !isRunning;
	const canStop = isRunning;

	const copyToClipboard = useCallback(async (text: string, label: string) => {
		const trimmed = text.trim();
		if (!trimmed) return;
		try {
			await navigator.clipboard.writeText(trimmed);
			setNotice(`${label} copied to clipboard.`);
			setTimeout(() => setNotice(""), 1500);
		} catch (error) {
			setLastError(
				error instanceof Error ? error.message : "Failed to copy to clipboard",
			);
		}
	}, []);

	const speakerLines = useMemo(() => {
		const keys = Object.keys(captions);
		if (keys.length === 0) return [];
		return keys
			.sort()
			.map((k) => ({ speaker: k, text: captions[k] }))
			.filter((line) => line.text.trim().length > 0);
	}, [captions]);

	const cleanupAudio = useCallback(async () => {
		const pipeline = pipelineRef.current;
		pipelineRef.current = null;

		if (!pipeline) return;

		try {
			pipeline.processor.disconnect();
		} catch {
			// ignore
		}
		try {
			pipeline.gain.disconnect();
		} catch {
			// ignore
		}

		try {
			await pipeline.audioContext.close();
		} catch {
			// ignore
		}

		for (const track of pipeline.micStream.getTracks()) {
			try {
				track.stop();
			} catch {
				// ignore
			}
		}

		if (pipeline.displayStream) {
			for (const track of pipeline.displayStream.getTracks()) {
				try {
					track.stop();
				} catch {
					// ignore
				}
			}
		}
	}, []);

	const stop = useCallback(async () => {
		setLastError("");
		setNotice("");
		const activeSessionId =
			session?.sessionId ?? pipelineRef.current?.sessionId ?? null;
		expectedSummarySessionIdRef.current = activeSessionId;
		let stopped = false;
		try {
			if (activeSessionId) {
				const result = await window.electronAPI.callAssistStop(activeSessionId);
				if (!result?.success) {
					throw new Error(result?.error || "Failed to stop call assist");
				}
				stopped = true;
			}
		} catch (error) {
			setLastError(error instanceof Error ? error.message : String(error));
			return;
		} finally {
			if (stopped) {
				setSession(null);
				setRequestId("");
				setCaptions({});
				setLevels({ mic: 0, sys: 0 });
			}
			await cleanupAudio();
		}
	}, [cleanupAudio, session]);

	const start = useCallback(async () => {
		setLastError("");
		setNotice("");
		expectedSummarySessionIdRef.current = null;
		setCaptions({});
		setUtterances([]);
		setSuggestions([]);
		setRequestId("");
		setRecordingPath("");
		setSummary("");
		let startedSessionId: string | null = null;

		try {
			if (!navigator.mediaDevices?.getUserMedia) {
				throw new Error("Microphone capture is not available in this environment.");
			}

			const micStream = await navigator.mediaDevices.getUserMedia({
				audio: {
					echoCancellation: false,
					noiseSuppression: false,
					autoGainControl: false,
				},
			});

			let effectiveMode: Mode = mode;
			let displayStream: MediaStream | null = null;
			if (effectiveMode === "multichannel") {
				if (!navigator.mediaDevices?.getDisplayMedia) {
					setNotice("System audio capture was unavailable; switching to mic-only mode.");
					effectiveMode = "diarize";
				} else {
					displayStream = await navigator.mediaDevices.getDisplayMedia({
						audio: true,
						video: true,
					});
					for (const track of displayStream.getVideoTracks()) {
						track.enabled = false;
					}
					if (displayStream.getAudioTracks().length === 0) {
						setNotice("No system audio track was provided; switching to mic-only mode.");
						for (const track of displayStream.getTracks()) {
							try {
								track.stop();
							} catch {
								// ignore
							}
						}
						displayStream = null;
						effectiveMode = "diarize";
					}
				}
			}

			const audioContext = new AudioContext();
			if (audioContext.state === "suspended") {
				await audioContext.resume();
			}
			const sampleRate = audioContext.sampleRate;
			const channels = effectiveMode === "multichannel" ? 2 : 1;

			const keywords = keywordsText
				.split(/[\n,]+/g)
				.map((k) => k.trim())
				.filter(Boolean)
				.slice(0, 25);

			const result = await window.electronAPI.callAssistStart({
				mode: effectiveMode,
				sampleRate,
				channels,
				model: "general",
				language: "en",
				endpointingMs: 450,
				utteranceEndMs: 1100,
				keywords,
				youChannelIndex,
				diarizeYouSpeakerId: effectiveMode === "diarize" ? diarizeYouSpeakerId : null,
				autoSaveToMemory,
				autoSuggest,
				autoSummary,
			});

			if (!result.success || !result.data) {
				throw new Error(result.error || "Failed to start call assist");
			}

			const sessionId = result.data.sessionId;
			startedSessionId = sessionId;
			if (effectiveMode !== mode) {
				setMode(effectiveMode);
			}
			setSession(result.data);
			setRecordingPath(result.data.recordingPath);

			const processor = audioContext.createScriptProcessor(2048, channels, channels);
			const gain = audioContext.createGain();
			gain.gain.value = 0;

			if (effectiveMode === "multichannel") {
				const micSource = audioContext.createMediaStreamSource(micStream);
				const sysSource = audioContext.createMediaStreamSource(displayStream as MediaStream);

				const micSplit = audioContext.createChannelSplitter(2);
				const sysSplit = audioContext.createChannelSplitter(2);

				micSource.connect(micSplit);
				sysSource.connect(sysSplit);

				const merger = audioContext.createChannelMerger(2);
				micSplit.connect(merger, 0, 0);
				sysSplit.connect(merger, 0, 1);

				merger.connect(processor);
			} else {
				const micSource = audioContext.createMediaStreamSource(micStream);
				micSource.connect(processor);
			}

			processor.connect(gain);
			gain.connect(audioContext.destination);

			processor.onaudioprocess = (e) => {
				const pipeline = pipelineRef.current;
				if (!pipeline || pipeline.sessionId !== sessionId) return;
				const input = e.inputBuffer;
				const frames = input.length;
				const buffers: Float32Array[] = [];
				for (let c = 0; c < channels; c += 1) {
					const ch = input.getChannelData(Math.min(c, input.numberOfChannels - 1));
					if (ch.length === frames) buffers.push(ch);
				}
				if (buffers.length === 0) return;

				const now = performance.now();
				if (now - lastLevelUpdateRef.current > 120) {
					lastLevelUpdateRef.current = now;
					const rms = (arr: Float32Array): number => {
						let sum = 0;
						const step = Math.max(1, Math.floor(arr.length / 256));
						for (let i = 0; i < arr.length; i += step) {
							const v = arr[i] ?? 0;
							sum += v * v;
						}
						return Math.min(1, Math.sqrt(sum / Math.ceil(arr.length / step)));
					};
					const mic = rms(buffers[0]);
					const sys = buffers.length > 1 ? rms(buffers[1]) : 0;
					setLevels({ mic, sys });
				}

				const pcm = interleaveToLinear16(buffers);
				window.electronAPI.callAssistSendAudioFrame({ sessionId, pcm });
			};

			const stopOnEnded = () => {
				void stop();
			};
			for (const track of micStream.getTracks()) {
				track.addEventListener("ended", stopOnEnded);
			}
			if (displayStream) {
				for (const track of displayStream.getTracks()) {
					track.addEventListener("ended", stopOnEnded);
				}
			}

			pipelineRef.current = {
				audioContext,
				processor,
				gain,
				micStream,
				displayStream,
				sessionId,
			};
		} catch (error) {
			setLastError(error instanceof Error ? error.message : String(error));
			if (startedSessionId) {
				try {
					await window.electronAPI.callAssistStop(startedSessionId);
				} catch {
					// ignore
				}
			}
			await cleanupAudio();
			setSession(null);
		}
	}, [
		autoSaveToMemory,
		autoSuggest,
		autoSummary,
		cleanupAudio,
		diarizeYouSpeakerId,
		keywordsText,
		mode,
		stop,
		youChannelIndex,
	]);

	useEffect(() => {
		const unsubs = [
			window.electronAPI.onCallAssistStatus((evt) => setStatus(evt)),
			window.electronAPI.onCallAssistStarted((info) => {
				setSession(info);
				setRecordingPath(info.recordingPath);
			}),
			window.electronAPI.onCallAssistStopped(() => {
				setSession(null);
				setRequestId("");
				setCaptions({});
				setLevels({ mic: 0, sys: 0 });
			}),
			window.electronAPI.onCallAssistCaption((evt) => {
				setCaptions((prev) => ({
					...prev,
					[evt.speakerLabel]: evt.text,
				}));
			}),
			window.electronAPI.onCallAssistUtterance((evt) => {
				setUtterances((prev) => {
					const next = [...prev, evt];
					return next.length > 60 ? next.slice(next.length - 60) : next;
				});
				setCaptions((prev) => {
					const updated = { ...prev };
					delete updated[evt.speakerLabel];
					delete updated.Live;
					return updated;
				});
			}),
			window.electronAPI.onCallAssistSuggestion((evt) => {
				setSuggestions((prev) => {
					const next = [...prev.filter((s) => s.utteranceId !== evt.utteranceId), evt];
					return next.length > 6 ? next.slice(next.length - 6) : next;
				});
			}),
			window.electronAPI.onCallAssistSummary((evt) => {
				if (expectedSummarySessionIdRef.current === evt.sessionId) {
					setSummary(evt.summary);
				}
			}),
			window.electronAPI.onCallAssistMetadata((evt) => {
				if (evt.requestId) setRequestId(evt.requestId);
			}),
			window.electronAPI.onCallAssistError((evt) => {
				setLastError(evt.message);
			}),
		];

		return () => {
			for (const unsub of unsubs) unsub();
		};
	}, []);

	useEffect(() => {
		return () => {
			void stop();
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const statusText = useMemo(() => {
		if (!status) return "Idle";
		if (status.state === "error") return `Error: ${status.message}`;
		if (status.state === "closed") return "Closed";
		return status.state;
	}, [status]);

	const transcriptText = useMemo(() => {
		return utterances.map((u) => `${u.speakerLabel}: ${u.text}`).join("\n").trim();
	}, [utterances]);

	return (
		<div className="bg-black/60 backdrop-blur-xl border border-white/20 rounded-2xl p-4 space-y-4">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<IoMic className="w-4 h-4 text-white/60" />
					<h3 className="text-sm font-medium text-white/90">Call Assist</h3>
				</div>
				<div className="flex items-center gap-2">
					{onClose && (
						<button
							type="button"
							onClick={() => {
								void stop();
								onClose();
							}}
							className="p-2 rounded-lg bg-white/10 hover:bg-white/20 border border-white/20 text-white/80"
							aria-label="Close"
						>
							<IoClose className="w-4 h-4" />
						</button>
					)}
				</div>
			</div>

			<div className="flex items-center justify-between text-xs text-white/60 bg-white/5 p-2 rounded-lg">
				<div className="flex items-center gap-2">
					<IoSettings className="w-4 h-4 text-white/40" />
					<span>Status: {statusText}</span>
				</div>
				{requestId && (
					<div className="text-[10px] text-white/40">
						Request: {requestId}
					</div>
				)}
			</div>

			{recordingPath && (
				<div className="text-[10px] text-white/50 bg-white/5 p-2 rounded-lg flex items-center gap-2">
					<IoSave className="w-4 h-4 text-white/40" />
					<span className="truncate">Recording: {recordingPath}</span>
				</div>
			)}

			{lastError && (
				<div className="text-xs text-red-200 bg-red-500/10 border border-red-500/20 p-2 rounded-lg flex items-start gap-2">
					<IoWarning className="w-4 h-4 mt-0.5" />
					<span>{lastError}</span>
				</div>
			)}

			{notice && !lastError && (
				<div className="text-xs text-yellow-200 bg-yellow-500/10 border border-yellow-500/20 p-2 rounded-lg flex items-start gap-2">
					<IoWarning className="w-4 h-4 mt-0.5" />
					<span>{notice}</span>
				</div>
			)}

			<div className="bg-white/5 p-3 rounded-lg space-y-2">
				<div className="text-xs font-medium text-white/80">Input Levels</div>
				<div className="space-y-2">
					<div className="flex items-center gap-3">
						<div className="w-16 text-[11px] text-white/50">Mic</div>
						<div className="flex-1 h-2 bg-white/10 rounded-full overflow-hidden">
							<div
								className="h-full bg-white/40"
								style={{ width: `${Math.round(levels.mic * 100)}%` }}
							/>
						</div>
					</div>
					{mode === "multichannel" && (
						<div className="flex items-center gap-3">
							<div className="w-16 text-[11px] text-white/50">System</div>
							<div className="flex-1 h-2 bg-white/10 rounded-full overflow-hidden">
								<div
									className="h-full bg-white/40"
									style={{ width: `${Math.round(levels.sys * 100)}%` }}
								/>
							</div>
						</div>
					)}
				</div>
			</div>

			<div className="grid grid-cols-1 md:grid-cols-3 gap-2">
				<button
					type="button"
					disabled={!canStart}
					onClick={() => void start()}
					className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 border border-white/20 text-xs text-white/90 disabled:opacity-50 flex items-center justify-center gap-2"
				>
					<IoPlay className="w-4 h-4" />
					Start
				</button>
				<button
					type="button"
					disabled={!canStop}
					onClick={() => void stop()}
					className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 border border-white/20 text-xs text-white/90 disabled:opacity-50 flex items-center justify-center gap-2"
				>
					<IoPause className="w-4 h-4" />
					Stop
				</button>
				<button
					type="button"
					disabled={isRunning}
					onClick={() => {
						setUtterances([]);
						setCaptions({});
						setSuggestions([]);
					}}
					className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 border border-white/20 text-xs text-white/90 disabled:opacity-50 flex items-center justify-center gap-2"
				>
					<IoRefresh className="w-4 h-4" />
					Clear
				</button>
			</div>

			<div className="bg-white/5 p-3 rounded-lg space-y-3">
				<div className="text-xs font-medium text-white/80">Capture Mode</div>
				<div className="flex gap-2">
					<button
						type="button"
						disabled={isRunning}
						onClick={() => setMode("multichannel")}
						className={`flex-1 px-3 py-2 rounded-lg text-xs transition-all ${
							mode === "multichannel"
								? "bg-white/20 text-white border border-white/30"
								: "bg-white/5 text-white/70 hover:bg-white/10"
						}`}
					>
						Mic + System (2‑channel)
					</button>
					<button
						type="button"
						disabled={isRunning}
						onClick={() => setMode("diarize")}
						className={`flex-1 px-3 py-2 rounded-lg text-xs transition-all ${
							mode === "diarize"
								? "bg-white/20 text-white border border-white/30"
								: "bg-white/5 text-white/70 hover:bg-white/10"
						}`}
					>
						Mic Only (fallback)
					</button>
				</div>

				{mode === "multichannel" && (
					<div className="flex items-center justify-between gap-3">
						<div className="text-[11px] text-white/60">
							Your mic channel
						</div>
						<select
							disabled={isRunning}
							className="bg-white/10 text-white text-xs border border-white/20 rounded-lg px-2 py-1"
							value={youChannelIndex}
							onChange={(e) => setYouChannelIndex(Number(e.target.value))}
						>
							<option value={0}>Channel 1</option>
							<option value={1}>Channel 2</option>
						</select>
					</div>
				)}

				{mode === "diarize" && (
					<div className="flex items-center justify-between gap-3">
						<div className="text-[11px] text-white/60">Your speaker</div>
						<select
							disabled={isRunning}
							className="bg-white/10 text-white text-xs border border-white/20 rounded-lg px-2 py-1"
							value={diarizeYouSpeakerId === null ? "unknown" : String(diarizeYouSpeakerId)}
							onChange={(e) => {
								const value = e.target.value;
								setDiarizeYouSpeakerId(value === "unknown" ? null : Number(value));
							}}
						>
							<option value="unknown">Not sure yet</option>
							<option value="0">Speaker 1</option>
							<option value="1">Speaker 2</option>
							<option value="2">Speaker 3</option>
							<option value="3">Speaker 4</option>
						</select>
					</div>
				)}

				<div className="space-y-2">
					<div className="text-[11px] text-white/60">Vocabulary (optional)</div>
					<textarea
						value={keywordsText}
						onChange={(e) => setKeywordsText(e.target.value)}
						disabled={isRunning}
						placeholder="Comma or newline separated (company names, product terms, acronyms)"
						className="w-full bg-white/10 text-white text-xs rounded-md px-2 py-1.5 border border-white/20 focus:outline-none focus:border-white/40 min-h-[60px] resize-none placeholder-white/40"
					/>
					<div className="text-[10px] text-white/40">
						Improves transcription for domain-specific terms.
					</div>
				</div>

				<label className="flex items-center gap-2 text-xs text-white/70">
					<input
						type="checkbox"
						checked={autoSaveToMemory}
						disabled={isRunning}
						onChange={(e) => setAutoSaveToMemory(e.target.checked)}
					/>
					Auto-save final turns to memory
				</label>

				<label className="flex items-center gap-2 text-xs text-white/70">
					<input
						type="checkbox"
						checked={autoSuggest}
						disabled={isRunning}
						onChange={(e) => setAutoSuggest(e.target.checked)}
					/>
					Auto-suggest replies for their turns
				</label>

				<label className="flex items-center gap-2 text-xs text-white/70">
					<input
						type="checkbox"
						checked={autoSummary}
						disabled={isRunning}
						onChange={(e) => setAutoSummary(e.target.checked)}
					/>
					Generate a summary when you stop
				</label>

				{mode === "multichannel" && (
					<div className="text-[10px] text-white/50">
						Tip: When prompted, pick the screen/window that has your call audio.
					</div>
				)}
				{mode === "diarize" && (
					<div className="text-[10px] text-white/50">
						Tip: Set “Your speaker” once you can tell which diarized speaker is you.
					</div>
				)}
			</div>

			{suggestions.length > 0 && (
				<div className="bg-white/5 p-3 rounded-lg">
					<div className="flex items-center justify-between mb-2">
						<div className="text-xs font-medium text-white/80">Suggestions</div>
						<button
							type="button"
							onClick={() => void copyToClipboard(suggestions[suggestions.length - 1]?.suggestion ?? "", "Suggestion")}
							className="text-[10px] text-white/50 hover:text-white/80"
						>
							Copy latest
						</button>
					</div>
					<div className="space-y-2 max-h-40 overflow-y-auto pr-1">
						{suggestions
							.slice()
							.reverse()
							.map((s) => (
								<div
									key={s.utteranceId}
									className="flex items-start justify-between gap-3 bg-white/5 rounded-md px-2 py-2"
								>
									<div className="text-xs text-white/80 whitespace-pre-wrap flex-1">
										{s.suggestion}
									</div>
									<button
										type="button"
										onClick={() => void copyToClipboard(s.suggestion, "Suggestion")}
										className="text-[10px] text-white/50 hover:text-white/80 flex-shrink-0"
									>
										Copy
									</button>
								</div>
							))}
					</div>
				</div>
			)}

			{summary && (
				<div className="bg-white/5 p-3 rounded-lg">
					<div className="flex items-center justify-between mb-2">
						<div className="text-xs font-medium text-white/80">Summary</div>
						<button
							type="button"
							onClick={() => void copyToClipboard(summary, "Summary")}
							className="text-[10px] text-white/50 hover:text-white/80"
						>
							Copy
						</button>
					</div>
					<div className="text-xs text-white/80 whitespace-pre-wrap max-h-48 overflow-y-auto pr-1">
						{summary}
					</div>
				</div>
			)}

			{speakerLines.length > 0 && (
				<div className="bg-white/5 p-3 rounded-lg">
					<div className="text-xs font-medium text-white/80 mb-2">
						Live Captions
					</div>
					<div className="space-y-2">
						{speakerLines.map((line) => (
							<div key={line.speaker} className="text-xs text-white/80">
								<span className="text-white/50">{line.speaker}: </span>
								<span>{line.text}</span>
							</div>
						))}
					</div>
				</div>
			)}

			<div className="bg-white/5 p-3 rounded-lg">
				<div className="flex items-center justify-between mb-2">
					<div className="text-xs font-medium text-white/80">Transcript</div>
					<button
						type="button"
						disabled={!transcriptText}
						onClick={() => void copyToClipboard(transcriptText, "Transcript")}
						className="text-[10px] text-white/50 hover:text-white/80 disabled:opacity-50"
					>
						Copy
					</button>
				</div>
				{utterances.length === 0 ? (
					<div className="text-xs text-white/50">
						Start a session to see finalized turns.
					</div>
				) : (
					<div className="space-y-2 max-h-64 overflow-y-auto pr-1">
						{utterances.map((u) => (
							<div key={u.utteranceId} className="text-xs text-white/80">
								<span className="text-white/50">{u.speakerLabel}: </span>
								<span>{u.text}</span>
							</div>
						))}
					</div>
				)}
			</div>
		</div>
	);
};
