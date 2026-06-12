import { getLlama, LlamaChatSession, resolveModelFile, LlamaLogLevel } from "node-llama-cpp";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import os from "os";
import { SYSTEM_PROMPT } from "./prompt.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MODEL_FILENAME = "Qwen3-0.6B-Q8_0.gguf";
const MODEL_HF_URI = "hf:Qwen/Qwen3-0.6B-GGUF/Qwen3-0.6B-Q8_0.gguf";
// Persistent user-level directory — survives `npm update -g`
const MODELS_DIR = path.join(os.homedir(), ".elytro-wrapper", "models");
// Legacy package-local path kept for backward compat (dev / old installs)
const MODELS_DIR_LEGACY = path.join(__dirname, "..", "models");

/**
 * Resolve the local model path. Resolution order:
 *   1. ~/.elytro-wrapper/models/  – persistent user directory (preferred)
 *   2. <pkg>/models/              – legacy package-local location
 *   3. Download from Hugging Face to ~/.elytro-wrapper/models/
 */
async function resolveModelPath(): Promise<string> {
  const inPersistent = path.join(MODELS_DIR, MODEL_FILENAME);
  if (fs.existsSync(inPersistent)) return inPersistent;

  const inLegacy = path.join(MODELS_DIR_LEGACY, MODEL_FILENAME);
  if (fs.existsSync(inLegacy)) return inLegacy;

  process.stderr.write(
    `[elytro-wrapper] Model not found locally. Downloading ${MODEL_FILENAME} (~640 MB)...\n`
  );
  fs.mkdirSync(MODELS_DIR, { recursive: true });
  return resolveModelFile(MODEL_HF_URI, {
    directory: MODELS_DIR,
    fileName: MODEL_FILENAME,
    cli: true,
  });
}

let session: LlamaChatSession | null = null;

export async function initLLM(): Promise<void> {
  if (session !== null) return;

  const modelPath = await resolveModelPath();

  // Disable GPU to avoid a Metal cleanup crash (GGML_ASSERT in
  // ggml_metal_device_free) on macOS. For a 0.6B model, CPU is fast enough.
  // Set log level to error to suppress benign Qwen3 GGUF metadata warnings.
  const llama = await getLlama({ gpu: false, logLevel: LlamaLogLevel.error });
  const model = await llama.loadModel({ modelPath });
  const context = await model.createContext({ contextSize: 4096 });
  session = new LlamaChatSession({
    contextSequence: context.getSequence(),
    systemPrompt: SYSTEM_PROMPT,
  });
}

/**
 * Convert a natural-language string into a list of elytro CLI commands.
 * Returns an array such as ["elytro query balance"] or ["__UNKNOWN__"].
 *
 * @param accountContext  Optional JSON string from `elytro account list` to
 *                        inject as context so the model can resolve chain/alias
 *                        references to concrete addresses.
 */
export async function parseCommands(
  userInput: string,
  accountContext?: string
): Promise<string[]> {
  await initLLM();

  // Prepend account list context when available so the model can match
  // chain names / aliases to their addresses without a second round-trip.
  const contextBlock = accountContext
    ? `[Context - current accounts]\n${accountContext}\n\n`
    : "";

  // Append /no_think to suppress Qwen3 chain-of-thought output
  const prompt = `${contextBlock}User: ${userInput} /no_think`;

  const response = await session!.prompt(prompt, {
    maxTokens: 256,
    temperature: 0.1,
  });

  return extractCommands(response);
}

/**
 * Robustly extract a command list from raw LLM output.
 * Priority:
 *   1. Parse the first JSON array found in the output
 *   2. Fall back to line scanning for lines starting with "elytro "
 */
function extractCommands(llmOutput: string): string[] {
  // Strip any <think>…</think> blocks emitted by Qwen3 thinking mode
  const cleaned = llmOutput.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

  const jsonMatch = cleaned.match(/\[[\s\S]*?\]/);
  if (jsonMatch) {
    try {
      const parsed: unknown = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map(String);
      }
    } catch {
      // fall through to line-scan
    }
  }

  // Fallback: collect lines that look like elytro commands
  const lines = cleaned
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("elytro "));

  return lines.length > 0 ? lines : ["__UNKNOWN__"];
}
