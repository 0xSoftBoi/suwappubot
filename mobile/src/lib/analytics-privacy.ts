/**
 * Pure privacy helpers for analytics.ts, split into their own module so they
 * have zero native imports (no react-native, no expo-secure-store, no MMKV).
 * That keeps them directly unit-testable under `bun test` — analytics.ts
 * itself transitively pulls in React Native via api.ts/auth.ts, which plain
 * `bun test` can't evaluate outside the app runtime.
 */

// --- amount bucketing (privacy) ---------------------------------------------

export type UsdBucket = '0' | '0-10' | '10-100' | '100-1k' | '1k-10k' | '10k+'

/** The only sanctioned way an amount reaches an event — never the raw number. */
export function bucketUsd(amountUsd: number): UsdBucket {
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) return '0'
  if (amountUsd < 10) return '0-10'
  if (amountUsd < 100) return '10-100'
  if (amountUsd < 1_000) return '100-1k'
  if (amountUsd < 10_000) return '1k-10k'
  return '10k+'
}

// --- redaction (privacy safety net) -----------------------------------------

const HEX_ADDRESS_RE = /0x[0-9a-f]{40}/i
const TX_HASH_RE = /0x[0-9a-f]{64}/i
const ENS_NAME_RE = /[a-z0-9-]+\.eth/i
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/i
// Keys that must never carry a value, even if a call site passes one by
// mistake — matched against the *whole* key. `amount_bucket`/`http_status`
// etc are safe because they don't equal these bare names.
const FORBIDDEN_KEYS = new Set([
  'address',
  'wallet',
  'walletaddress',
  'txhash',
  'tx_hash',
  'hash',
  'balance',
  'recipient',
  'recipientaddress',
  'ens',
  'ensname',
  'email',
  'seed',
  'seedphrase',
  'privatekey',
  'private_key',
  'amount',
  'text',
  'message',
  'note',
  'memo',
  'query',
])

function isUnsafeString(value: string): boolean {
  return (
    HEX_ADDRESS_RE.test(value) ||
    TX_HASH_RE.test(value) ||
    ENS_NAME_RE.test(value) ||
    EMAIL_RE.test(value) ||
    value.length > 64 // free text guard — no legitimate bucketed/enum prop is this long
  )
}

/** Strips anything that could identify a wallet, amount, or user-typed text.
 * Every enqueue path in analytics.ts runs props through this before they're
 * buffered, let alone sent. */
export function redactProps(props: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!props) return {}
  const safe: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(props)) {
    if (FORBIDDEN_KEYS.has(key.toLowerCase())) continue
    if (typeof value === 'string') {
      if (isUnsafeString(value)) continue
      safe[key] = value
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      safe[key] = value
    }
    // objects, arrays, undefined, functions: dropped silently, never sent.
  }
  return safe
}
