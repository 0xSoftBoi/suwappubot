/**
 * Secure Store — OS keychain with encrypted file fallback.
 *
 * Primary: macOS Keychain via `security` CLI
 * Fallback: Encrypted JSON file at ~/.suwappu/secure-store.json
 *
 * All values are stored under the service name "bot.suwappu.desktop".
 */

import { homedir, hostname } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";

const SERVICE_NAME = "bot.suwappu.desktop";
const STORE_DIR = join(homedir(), ".suwappu");
const STORE_PATH = join(STORE_DIR, "secure-store.json");
const MIGRATION_FLAG = "_migrated";

let keychainAvailable: boolean | null = null;

// ── Machine key for file-based encryption ──────────────────────────────
function getMachineKey(): Buffer {
  const raw = `${hostname()}-${homedir()}-suwappu-salt-v1`;
  return createHash("sha256").update(raw).digest();
}

function xorEncrypt(plaintext: string, key: Buffer): string {
  const input = Buffer.from(plaintext, "utf-8");
  const output = Buffer.alloc(input.length);
  for (let i = 0; i < input.length; i++) {
    output[i] = input[i]! ^ key[i % key.length]!;
  }
  return output.toString("base64");
}

function xorDecrypt(ciphertext: string, key: Buffer): string {
  const input = Buffer.from(ciphertext, "base64");
  const output = Buffer.alloc(input.length);
  for (let i = 0; i < input.length; i++) {
    output[i] = input[i]! ^ key[i % key.length]!;
  }
  return output.toString("utf-8");
}

// ── File-based fallback store ──────────────────────────────────────────
function ensureStoreDir(): void {
  if (!existsSync(STORE_DIR)) {
    mkdirSync(STORE_DIR, { recursive: true });
  }
}

function readFileStore(): Record<string, string> {
  try {
    if (!existsSync(STORE_PATH)) return {};
    const content = require("node:fs").readFileSync(STORE_PATH, "utf-8");
    return JSON.parse(content);
  } catch {
    return {};
  }
}

function writeFileStore(store: Record<string, string>): void {
  ensureStoreDir();
  require("node:fs").writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), "utf-8");
}

function fileGet(key: string): string | null {
  const store = readFileStore();
  const encrypted = store[key];
  if (!encrypted) return null;
  try {
    return xorDecrypt(encrypted, getMachineKey());
  } catch {
    return null;
  }
}

function fileSet(key: string, value: string): void {
  const store = readFileStore();
  store[key] = xorEncrypt(value, getMachineKey());
  writeFileStore(store);
}

function fileRemove(key: string): void {
  const store = readFileStore();
  delete store[key];
  writeFileStore(store);
}

// ── macOS Keychain via `security` CLI ──────────────────────────────────
async function runSecurity(args: string[]): Promise<{ stdout: string; exitCode: number }> {
  const proc = Bun.spawn(["security", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;

  return { stdout: stdout.trim(), exitCode };
}

async function checkKeychainAvailable(): Promise<boolean> {
  if (keychainAvailable !== null) return keychainAvailable;

  if (process.platform !== "darwin") {
    keychainAvailable = false;
    return false;
  }

  try {
    const { exitCode } = await runSecurity(["list-keychains"]);
    keychainAvailable = exitCode === 0;
  } catch {
    keychainAvailable = false;
  }

  console.log(`[Keychain] macOS keychain ${keychainAvailable ? "available" : "unavailable, using file fallback"}`);
  return keychainAvailable;
}

async function keychainGet(key: string): Promise<string | null> {
  try {
    const { stdout, exitCode } = await runSecurity([
      "find-generic-password",
      "-s", SERVICE_NAME,
      "-a", key,
      "-w",
    ]);

    if (exitCode !== 0) return null;
    return stdout;
  } catch {
    return null;
  }
}

async function keychainSet(key: string, value: string): Promise<void> {
  // -U flag updates existing entry or adds new one
  await runSecurity([
    "add-generic-password",
    "-s", SERVICE_NAME,
    "-a", key,
    "-w", value,
    "-U",
  ]);
}

async function keychainRemove(key: string): Promise<void> {
  try {
    await runSecurity([
      "delete-generic-password",
      "-s", SERVICE_NAME,
      "-a", key,
    ]);
  } catch {
    // Ignore — key may not exist
  }
}

// ── Unified API ────────────────────────────────────────────────────────

export async function secureGet(key: string): Promise<string | null> {
  if (await checkKeychainAvailable()) {
    const value = await keychainGet(key);
    if (value !== null) return value;
    // Fall through to file store in case migration is partial
  }
  return fileGet(key);
}

export async function secureSet(key: string, value: string): Promise<void> {
  if (await checkKeychainAvailable()) {
    await keychainSet(key, value);
  } else {
    fileSet(key, value);
  }
}

export async function secureRemove(key: string): Promise<void> {
  if (await checkKeychainAvailable()) {
    await keychainRemove(key);
  }
  // Also remove from file store (cleanup)
  fileRemove(key);
}

/**
 * Migrate all entries from the old in-memory Map to the secure store.
 * Only runs once — sets a migration flag to prevent re-running.
 */
export async function migrateFromMap(oldStore: Map<string, string>): Promise<void> {
  // Check if already migrated
  const migrated = await secureGet(MIGRATION_FLAG);
  if (migrated === "true") return;

  if (oldStore.size === 0) {
    await secureSet(MIGRATION_FLAG, "true");
    return;
  }

  console.log(`[Keychain] Migrating ${oldStore.size} entries from in-memory store...`);

  for (const [key, value] of oldStore) {
    try {
      await secureSet(key, value);
    } catch (err) {
      console.error(`[Keychain] Failed to migrate key "${key}":`, err);
    }
  }

  await secureSet(MIGRATION_FLAG, "true");
  console.log("[Keychain] Migration complete");
}
