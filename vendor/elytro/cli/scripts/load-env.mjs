/**
 * Lightweight .env file loader that replaces --env-file-if-exists for Node <22.
 *
 * Usage in package.json scripts:
 *   "dev":  "ENV_FILE=.env.development node --import ./scripts/load-env.mjs --import tsx/esm src/index.ts"
 *   "test": "ENV_FILE=.env.test        node --import ./scripts/load-env.mjs --import tsx/esm test/smoke.ts"
 *
 * Reads the file specified by ENV_FILE (defaults to .env). Silently skips if
 * the file doesn't exist, matching --env-file-if-exists semantics.
 */

import { readFileSync } from "node:fs";

const envFile = process.env.ENV_FILE || ".env";

try {
  const content = readFileSync(envFile, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    // Don't override existing env vars
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
} catch {
  // File doesn't exist or can't be read — silently skip, like --env-file-if-exists.
}
