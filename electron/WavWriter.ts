import fs from "node:fs";
import path from "node:path";

type WavWriterOptions = {
	filePath: string;
	sampleRate: number;
	channels: number;
	bitsPerSample?: 16;
};

export class WavWriter {
	private readonly filePath: string;
	private readonly fd: number;
	private readonly sampleRate: number;
	private readonly channels: number;
	private readonly bitsPerSample: 16;
	private dataBytesWritten = 0;
	private isClosed = false;

	constructor(options: WavWriterOptions) {
		this.filePath = options.filePath;
		this.sampleRate = options.sampleRate;
		this.channels = options.channels;
		this.bitsPerSample = options.bitsPerSample ?? 16;

		const dir = path.dirname(this.filePath);
		if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

		this.fd = fs.openSync(this.filePath, "w");
		this.writeHeaderPlaceholder();
	}

	public getPath(): string {
		return this.filePath;
	}

	public write(pcmBytes: Uint8Array): void {
		if (this.isClosed) return;
		if (!pcmBytes || pcmBytes.length === 0) return;

		const written = fs.writeSync(this.fd, pcmBytes);
		this.dataBytesWritten += written;
	}

	public close(): void {
		if (this.isClosed) return;
		this.isClosed = true;
		try {
			this.patchHeaderSizes();
		} catch (error) {
			console.warn("[WavWriter] Failed to patch WAV header:", error);
		} finally {
			try {
				fs.closeSync(this.fd);
			} catch (error) {
				console.warn("[WavWriter] Failed to close file:", error);
			}
		}
	}

	private writeHeaderPlaceholder(): void {
		const header = Buffer.alloc(44);
		header.write("RIFF", 0);
		header.writeUInt32LE(36, 4); // placeholder; patched on close
		header.write("WAVE", 8);
		header.write("fmt ", 12);
		header.writeUInt32LE(16, 16); // PCM fmt chunk size
		header.writeUInt16LE(1, 20); // PCM format
		header.writeUInt16LE(this.channels, 22);
		header.writeUInt32LE(this.sampleRate, 24);
		const byteRate = (this.sampleRate * this.channels * this.bitsPerSample) / 8;
		header.writeUInt32LE(byteRate, 28);
		const blockAlign = (this.channels * this.bitsPerSample) / 8;
		header.writeUInt16LE(blockAlign, 32);
		header.writeUInt16LE(this.bitsPerSample, 34);
		header.write("data", 36);
		header.writeUInt32LE(0, 40); // placeholder; patched on close

		fs.writeSync(this.fd, header);
	}

	private patchHeaderSizes(): void {
		const dataSize = this.dataBytesWritten;
		const riffChunkSize = 36 + dataSize;

		const riffSizeBuf = Buffer.alloc(4);
		riffSizeBuf.writeUInt32LE(riffChunkSize, 0);
		fs.writeSync(this.fd, riffSizeBuf, 0, 4, 4);

		const dataSizeBuf = Buffer.alloc(4);
		dataSizeBuf.writeUInt32LE(dataSize, 0);
		fs.writeSync(this.fd, dataSizeBuf, 0, 4, 40);
	}
}

