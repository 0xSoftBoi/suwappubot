/**
 * Postinstall script — runs automatically on `npm install`.
 * Does two things:
 *   1. Downloads/compiles the node-llama-cpp native binary for this platform.
 *   2. Downloads Qwen3-0.6B-Q8_0.gguf (~640 MB) from Hugging Face.
 *
 * Both steps are skipped if the artifacts already exist, so re-running is safe.
 */

import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import os from "os";
import { getLlama, resolveModelFile, LlamaLogLevel } from "node-llama-cpp";

// Store the model in a user-level persistent directory so it survives
// `npm update -g` without needing to re-download the 640 MB file.
const MODELS_DIR = path.join(os.homedir(), ".elytro-wrapper", "models");
const MODEL_FILENAME = "Qwen3-0.6B-Q8_0.gguf";
const MODEL_HF_URI = "hf:Qwen/Qwen3-0.6B-GGUF/Qwen3-0.6B-Q8_0.gguf";

// ── Step 1: ensure native binary is ready ─────────────────────────────────────
console.log("[elytro-wrapper] Preparing node-llama-cpp native binary...");
// getLlama downloads a prebuilt binary when available, or compiles from source.
// Running this at postinstall means the first real invocation will be instant.
// Non-fatal: if cmake is missing the binary will be built on first use instead.
try {
  await getLlama({ gpu: false, logLevel: LlamaLogLevel.error });
  console.log("[elytro-wrapper] node-llama-cpp binary ready.");
} catch (err) {
  console.warn(
    "[elytro-wrapper] Could not prepare node-llama-cpp binary during install " +
    "(this is non-fatal — it will be built on first use)."
  );
  console.warn(
    "[elytro-wrapper] To avoid a delay on first use, install cmake: brew install cmake"
  );
}

// ── Step 2: download model file ───────────────────────────────────────────────
const targetPath = path.join(MODELS_DIR, MODEL_FILENAME);

if (fs.existsSync(targetPath)) {
  console.log(`[elytro-wrapper] Model already present: ${targetPath}`);
  process.exit(0);
}

fs.mkdirSync(MODELS_DIR, { recursive: true });

console.log(
  `[elytro-wrapper] Downloading ${MODEL_FILENAME} (~640 MB) from Hugging Face...`
);
console.log(`[elytro-wrapper] Saving to: ${MODELS_DIR}`);

let lastReportedPct = -1;

try {
  const modelPath = await resolveModelFile(MODEL_HF_URI, {
    directory: MODELS_DIR,
    fileName: MODEL_FILENAME,
    cli: true,
    onProgress({ downloadedSize, totalSize }) {
      if (totalSize === 0) return;
      const pct = Math.floor((downloadedSize / totalSize) * 100);
      // Print a new line every 5 % to stay visible in piped npm output
      if (pct >= lastReportedPct + 5) {
        lastReportedPct = pct;
        const mb = (downloadedSize / 1024 / 1024).toFixed(1);
        const total = (totalSize / 1024 / 1024).toFixed(1);
        process.stdout.write(
          `[elytro-wrapper] Downloading... ${pct}%  (${mb} / ${total} MB)\n`
        );
      }
    },
  });
  console.log(`[elytro-wrapper] Model ready at: ${modelPath}`);
} catch (err) {
  console.error("[elytro-wrapper] Model download failed:", err.message);
  process.exit(1);
}

