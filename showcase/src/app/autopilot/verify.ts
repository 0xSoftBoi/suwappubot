/**
 * Client-side verification of an autopilot commitment.
 *
 * The API has a /verify endpoint, but an endpoint that grades its own homework
 * is not proof of anything. This recomputes the hash in the reader's own
 * browser with WebCrypto, from the revealed thesis and nonce, so the only thing
 * being trusted is SHA-256.
 *
 * MUST stay byte-identical to api-ts/src/lib/seal.ts — same key ordering, same
 * separators, same algo tag inside the pre-image. Its test suite pins the
 * canonical form; if that changes, this changes with it.
 */

export const SEAL_ALGO = 'sha256-canonical-v1';

/** Deterministic JSON: keys sorted, no whitespace, undefined dropped. */
export function canonicalize(value: unknown): string {
  if (value === null) return 'null';

  const t = typeof value;
  if (t === 'string') return JSON.stringify(value);
  if (t === 'boolean') return value ? 'true' : 'false';
  if (t === 'number') {
    if (!Number.isFinite(value as number)) throw new Error('non-finite number');
    return JSON.stringify(value);
  }
  if (t === 'bigint') return JSON.stringify((value as bigint).toString());
  if (t === 'undefined' || t === 'function' || t === 'symbol') {
    throw new Error(`unsupported value of type ${t}`);
  }

  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalize(v === undefined ? null : v)).join(',')}]`;
  }

  const obj = value as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of Object.keys(obj).sort()) {
    const v = obj[key];
    if (v === undefined) continue;
    parts.push(`${JSON.stringify(key)}:${canonicalize(v)}`);
  }
  return `{${parts.join(',')}}`;
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export type VerifyOutcome =
  | { state: 'verified'; recomputed: string }
  | { state: 'mismatch'; recomputed: string }
  | { state: 'sealed' } // not revealed yet — nothing to check
  | { state: 'unavailable'; reason: string };

/**
 * Recompute sha256("<algo>|<nonce>|<canonical thesis>") and compare.
 * Never throws: a failure to verify is a result, not an exception.
 */
export async function verifyDecision(input: {
  thesis?: unknown;
  nonce?: string;
  commitment: string;
  seal_algo?: string;
}): Promise<VerifyOutcome> {
  if (input.thesis === undefined || input.thesis === null || !input.nonce) {
    return { state: 'sealed' };
  }
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    // Secure-context-only API; http:// pages and old browsers have no subtle.
    return { state: 'unavailable', reason: 'WebCrypto unavailable in this context' };
  }
  try {
    const algo = input.seal_algo || SEAL_ALGO;
    const recomputed = await sha256Hex(`${algo}|${input.nonce}|${canonicalize(input.thesis)}`);
    return recomputed === input.commitment.toLowerCase()
      ? { state: 'verified', recomputed }
      : { state: 'mismatch', recomputed };
  } catch (err) {
    return { state: 'unavailable', reason: String(err) };
  }
}
