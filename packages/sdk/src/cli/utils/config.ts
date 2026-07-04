/**
 * Local CLI config: ~/.config/suwappu/config.json (0600 perms).
 * Written by `suwappu auth` / `suwappu register --save`.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CONFIG_DIR = path.join(os.homedir(), ".config", "suwappu");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

export interface CliConfig {
  apiKey?: string;
  baseUrl?: string;
}

export function configPath(): string {
  return CONFIG_FILE;
}

export function readConfig(): CliConfig {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as CliConfig) : {};
  } catch {
    return {};
  }
}

export function writeConfig(config: CliConfig): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(CONFIG_FILE, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  // writeFileSync's mode is only applied when the file is created; force it on
  // every save in case the file already existed with looser permissions.
  fs.chmodSync(CONFIG_FILE, 0o600);
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
