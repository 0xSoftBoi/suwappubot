// Structured JSON logs. NEVER pass keys, signatures, or raw signed txs here (tx hash only).
// Defence in depth: field-name filter + value-based scrubber (URLs -> origin, registered secrets, long hex blobs).
export type Level = "debug" | "info" | "warn" | "error";
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
let min: Level = "info";
export function setLogLevel(l: Level) {
  min = l;
}

const FORBIDDEN = /priv|secret|signature|apikey|api_key|authorization|rawtx|raw_tx|password|token_key/i;
const secrets = new Set<string>();

/** Register a secret value (API key, private key, ...) so it is redacted wherever it appears in any logged string. */
export function registerSecret(v: string | undefined) {
  if (v && v.length >= 8) secrets.add(v);
}

export function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "[invalid-url]";
  }
}

export function scrub(s: string): string {
  let out = s;
  for (const sec of secrets) out = out.split(sec).join("[REDACTED]");
  // URLs: keep scheme://host[:port] only (paths/queries often carry API keys)
  out = out.replace(/\b([a-z][a-z0-9+.-]*:\/\/[^\s/"'?#\\]+)([^\s"'\\]*)/gi, (_m, origin: string, rest: string) => (rest && rest !== "/" ? `${origin}/[path-redacted]` : origin));
  // header/param style secrets
  out = out.replace(/\b(api[_-]?key|authorization|bearer|token|secret|private[_-]?key)(["']?\s*[:=]\s*["']?)[^\s"',;&]+/gi, "$1$2[REDACTED]");
  // raw tx / calldata blobs (> 33 bytes of hex). 32-byte hashes (tx hashes) are left alone.
  out = out.replace(/0x[0-9a-fA-F]{67,}/g, (m) => `[hex:${(m.length - 2) / 2}B]`);
  // bare long hex without prefix (e.g. a key pasted without 0x)
  out = out.replace(/\b[0-9a-fA-F]{64}\b/g, (m, off: number) => (out[off - 1] === "x" ? m : "[hex64-redacted]"));
  return out;
}

/** Error -> safe one-liner. viem errors: shortMessage only. Never the raw message (it embeds URLs, bodies, calldata). */
export function errMsg(e: unknown): string {
  if (e && typeof e === "object") {
    const sm = (e as { shortMessage?: unknown }).shortMessage;
    if (typeof sm === "string") return scrub(sm).slice(0, 300);
    const name = (e as { name?: unknown }).name;
    const msg = (e as { message?: unknown }).message;
    return scrub(`${typeof name === "string" ? name : "Error"}: ${typeof msg === "string" ? msg : ""}`).slice(0, 300);
  }
  return scrub(String(e)).slice(0, 300);
}

function safeValue(v: unknown): unknown {
  if (typeof v === "bigint") return v.toString();
  if (v instanceof Error) return errMsg(v);
  if (typeof v === "string") return scrub(v);
  return v;
}

export function log(level: Level, msg: string, fields: Record<string, unknown> = {}) {
  if (order[level] < order[min]) return;
  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (FORBIDDEN.test(k)) continue;
    safe[k] = k === "err" && !(v instanceof Error) ? errMsg(v) : safeValue(v);
  }
  process.stdout.write(JSON.stringify({ t: new Date().toISOString(), level, msg: scrub(msg), ...safe }) + "\n");
}

export const metrics = {
  pushes: 0,
  skips: 0,
  acks: 0,
  errors: 0,
  cancels: 0,
  sign_errors: 0,
  unhealthy_ticks: 0,
  reconnects: 0,
};
export type Metrics = typeof metrics;
