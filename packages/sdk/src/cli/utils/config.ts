/**
 * Local CLI config: ~/.config/suwappu/config.json (0600 perms).
 * Written by `suwappu auth` / `suwappu register --save`.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Lazy (not module-level constants) so tests can redirect via
// SUWAPPU_CONFIG_DIR without touching the real user home directory —
// os.homedir() itself can't be overridden mid-process. Unset in normal use,
// so production behavior (~/.config/suwappu/config.json) is unchanged.
function configDir(): string {
  return process.env.SUWAPPU_CONFIG_DIR || path.join(os.homedir(), ".config", "suwappu");
}

function configFile(): string {
  return path.join(configDir(), "config.json");
}

/** Which LLM backend `suwappu ai` dispatches to. See src/cli/ai/. */
export type AiBackend = "router" | "claude" | "chatgpt";

export interface AiConfig {
  backend: AiBackend;
  /** router backend only — an OpenRouter (or OpenAI-compatible) API key. */
  apiKey?: string;
  /** router backend only — defaults to https://openrouter.ai/api/v1. */
  baseUrl?: string;
  /** router backend only — defaults to anthropic/claude-sonnet-5. */
  model?: string;
}

export interface CliConfig {
  apiKey?: string;
  baseUrl?: string;
  ai?: AiConfig;
}

export function configPath(): string {
  return configFile();
}

export function readConfig(): CliConfig {
  try {
    const raw = fs.readFileSync(configFile(), "utf8");
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as CliConfig) : {};
  } catch {
    return {};
  }
}

export function writeConfig(config: CliConfig): void {
  fs.mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  fs.writeFileSync(configFile(), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  // writeFileSync's mode is only applied when the file is created; force it on
  // every save in case the file already existed with looser permissions.
  fs.chmodSync(configFile(), 0o600);
}

/** Resolution order: --api-key flag > SUWAPPU_API_KEY env > config file. */
export function resolveApiKey(flagValue?: string): string | undefined {
  if (flagValue) return flagValue;
  if (process.env.SUWAPPU_API_KEY) return process.env.SUWAPPU_API_KEY;
  return readConfig().apiKey;
}

/** Resolution order: --base-url flag > SUWAPPU_API_URL env > config file > SDK default. */
export function resolveBaseUrl(flagValue?: string): string | undefined {
  if (flagValue) return flagValue;
  if (process.env.SUWAPPU_API_URL) return process.env.SUWAPPU_API_URL;
  return readConfig().baseUrl;
}
