import { app } from "electron";
import crypto from "node:crypto";
import path from "node:path";
import dotenv from "dotenv";
import { DeepgramV1Session } from "./DeepgramV1Session";
import { LLMHelper } from "./LLMHelper";
import { SupermemoryHelper } from "./SupermemoryHelper";

dotenv.config();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function computeCluelessContainerTag(): string {
	const appName = "clueless";
	const userData = path.join(app.getPath("appData"), appName);
	const appPath = path.resolve(__dirname, "..");
	const hash = crypto
		.createHash("sha256")
		.update(`${userData}|${appPath}`)
		.digest("hex")
		.slice(0, 16);
	return `${appName}_${hash}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 100);
}

async function smokeGroq(): Promise<void> {
	const apiKey = process.env.GROQ_API_KEY;
	if (!apiKey) {
		console.log("[smoke] Groq: skipped (GROQ_API_KEY missing)");
		return;
	}

	const helper = new LLMHelper(apiKey, "openai/gpt-oss-20b");
	const result = await helper.testConnection();
	if (!result.success) {
		throw new Error(result.error || "Groq test failed");
	}
	console.log("[smoke] Groq: ok");
}

async function smokeSupermemory(): Promise<void> {
	const apiKey = process.env.SUPERMEMORY_API_KEY;
	if (!apiKey) {
		console.log("[smoke] Supermemory: skipped (SUPERMEMORY_API_KEY missing)");
		return;
	}

	// Ensure we test against the same userData + container tag the app uses.
	const userData = path.join(app.getPath("appData"), "clueless");
	app.setPath("userData", userData);
	process.env.SUPERMEMORY_CONTAINER_TAG = computeCluelessContainerTag();

	const helper = new SupermemoryHelper(apiKey);
	console.log(`[smoke] Supermemory: containerTag=${helper.getDefaultContainerTag()}`);

	// Basic read endpoint.
	await helper.listDocuments({ limit: 1, page: 1, order: "desc", sort: "updatedAt" });

	// Upload + delete a tiny file to validate the file endpoint end-to-end.
	const fileName = `clueless_smoke_${Date.now()}.txt`;
	const bytes = new TextEncoder().encode("Clueless smoke test.");

	let uploadedId: string | null = null;
	try {
		const upload = await helper.uploadFileMemoryData(fileName, bytes, "text/plain");
		uploadedId = upload.id;
		console.log(`[smoke] Supermemory: uploaded id=${upload.id} status=${upload.status}`);

		const deadline = Date.now() + 120_000;
		while (Date.now() < deadline) {
			const doc = await helper.getDocument(upload.id);
			const status = typeof doc.status === "string" ? doc.status : "unknown";
			console.log(`[smoke] Supermemory: status=${status}`);
			if (status === "done" || status === "failed") break;
			await sleep(2500);
		}
	} finally {
		if (uploadedId) {
			try {
				await helper.deleteMemory(uploadedId);
				console.log(`[smoke] Supermemory: deleted id=${uploadedId}`);
			} catch (error) {
				console.warn("[smoke] Supermemory: failed to delete smoke doc:", error);
			}
		}
	}
}

async function smokeDeepgram(): Promise<void> {
	const apiKey = process.env.DEEPGRAM_API_KEY;
	if (!apiKey) {
		console.log("[smoke] Deepgram: skipped (DEEPGRAM_API_KEY missing)");
		return;
	}

	let resolveOpened: (() => void) | null = null;
	let rejectOpened: ((err: Error) => void) | null = null;
	let open = false;

	const opened = new Promise<void>((resolve, reject) => {
		resolveOpened = resolve;
		rejectOpened = reject;
	});

	const session = new DeepgramV1Session(
		{
			apiKey,
			sampleRate: 8000,
			channels: 1,
			model: "general",
			language: "en",
			punctuate: true,
			interimResults: true,
			endpointingMs: 450,
			utteranceEndMs: 1100,
			vadEvents: true,
			smartFormat: true,
			numerals: true,
			utterances: true,
			multichannel: false,
			diarize: false,
		},
		{
			onStatus: (status) => {
				console.log(`[smoke] Deepgram: status=${status.state}`);
				if (status.state === "open") {
					open = true;
					resolveOpened?.();
				}
				if (status.state === "error") {
					rejectOpened?.(new Error(status.message));
				}
			},
		},
	);

	const timeout = setTimeout(() => {
		rejectOpened?.(new Error("Deepgram open timeout"));
	}, 12_000);

	await session.start();
	await opened.finally(() => clearTimeout(timeout));

	// Send a few short frames of silence (linear16) to validate streaming.
	const silence = Buffer.alloc(1600);
	for (let i = 0; i < 4; i += 1) {
		session.sendAudio(silence);
		await sleep(80);
	}

	await session.stop();
	await sleep(250);

	console.log(`[smoke] Deepgram: ${open ? "ok" : "not-open"}`);
}

async function main(): Promise<void> {
	await app.whenReady();

	const errors: string[] = [];
	for (const fn of [smokeGroq, smokeSupermemory, smokeDeepgram]) {
		try {
			await fn();
		} catch (error) {
			errors.push(error instanceof Error ? error.message : String(error));
		}
	}

	if (errors.length > 0) {
		console.error("[smoke] failures:");
		for (const err of errors) console.error(`- ${err}`);
		process.exitCode = 1;
	}

	app.quit();
}

main().catch((error) => {
	console.error("[smoke] fatal:", error);
	process.exitCode = 1;
	app.quit();
});
