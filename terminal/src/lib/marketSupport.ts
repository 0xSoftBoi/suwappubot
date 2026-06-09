// ETH native / WETH addresses that map to the Coinbase ETH-USD feed.
const ETH_NATIVE = new Set([
  '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  '0x0000000000000000000000000000000000000000',
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
])

/**
 * The terminal's order book + recent-trades feeds come from a CEX (Coinbase), which
 * only exists for ETH/USDC today. Every other pair is an on-chain AMM pool with no
 * central order book — we should say that honestly rather than show "feed not wired".
 * Returns the CEX symbol if supported, else null.
 */
export function cexSymbol(baseAddress: string | undefined | null, chain: string): string | null {
  if (chain?.toLowerCase() === 'ethereum' && ETH_NATIVE.has((baseAddress ?? '').toLowerCase())) {
    return 'ETHUSDC'
  }
  return null
}

/**
 * Maps the internal CEX symbol (from `cexSymbol`) to the Coinbase Exchange
 * product id used on the public WS feed (`wss://ws-feed.exchange.coinbase.com`).
 * Coinbase quotes ETH against USD (not USDC) on the Exchange order book, so
 * ETH/USDC in our UI maps to the ETH-USD product. Returns null when there's no
 * public Coinbase market for the symbol.
 */
export function coinbaseProductId(symbol: string | null | undefined): string | null {
  if (!symbol) return null
  if (symbol === 'ETHUSDC') return 'ETH-USD'
  return null
}

export type FeedStatus = 'connected' | 'loading' | 'error' | 'unsupported'
