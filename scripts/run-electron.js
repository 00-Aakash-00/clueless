#!/usr/bin/env node

const { spawn } = require("node:child_process");

// In a normal Node.js context, `require("electron")` returns the path to the Electron binary.
// We use that to spawn Electron while stripping `ELECTRON_RUN_AS_NODE`, which would otherwise
// force Electron to behave like Node and break `require("electron").app` in the main process.
const electronPath = require("electron");

const args = process.argv.slice(2);

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, args, {
	stdio: "inherit",
	env,
});

child.on("error", (err) => {
	console.error(err);
	process.exit(1);
});

child.on("exit", (code, signal) => {
	if (signal) {
		process.exit(1);
	}
	process.exit(code ?? 0);
});

