const STRONG_TRADING_SESSION_SOURCES = new Set(['siwe', 'telegram', 'passkey'])

/**
 * Server-issued session provenance. OAuth sessions deliberately use `weak`:
 * they identify a user but do not prove control of a trading wallet.
 */
export function hasTradingProof(sessionSource: string | null | undefined): boolean {
  return sessionSource != null && STRONG_TRADING_SESSION_SOURCES.has(sessionSource)
}
