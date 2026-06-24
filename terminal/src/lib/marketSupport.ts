// ETH native / WETH addresses that map to the Coinbase ETH-USD feed.
const ETH_NATIVE = new Set([
  '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  '0x0000000000000000000000000000000000000000',
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
])

/**
 * Token SYMBOL → Coinbase Exchange base asset, for majors with a real public
 * `<ASSET>-USD` order book on `wss://ws-feed.exchange.coinbase.com`. Keyed by
 * symbol (not address) so it works across chains: WBTC on Arbitrum, SOL bridged
 * to Base, etc. all resolve to the same CEX market as the canonical asset.
 *
 * The value is the Coinbase base asset; the quote is always USD on the Exchange
 * book (see `coinbaseProductId`). Only assets verified to have a live public
 * USD product are listed — everything else stays an honest "no CEX market".
 *
 * Wrapped/bridged variants map to their underlying: WBTC→BTC, WETH handled via
 * the ETH address path. MATIC was renamed POL — Coinbase delisted MATIC-USD and
 * trades POL-USD now, so both symbols resolve to the live POL product.
 */
const SYMBOL_TO_COINBASE: Record<string, string> = {
  ETH: 'ETH',
  WETH: 'ETH',
  BTC: 'BTC',
  WBTC: 'BTC',
  SOL: 'SOL',
  WSOL: 'SOL',
  LINK: 'LINK',
  UNI: 'UNI',
  AAVE: 'AAVE',
  MATIC: 'POL',
  POL: 'POL',
  ARB: 'ARB',
  OP: 'OP',
  AVAX: 'AVAX',
  DOGE: 'DOGE',
  LTC: 'LTC',
  ADA: 'ADA',
  DOT: 'DOT',
  ATOM: 'ATOM',
  XRP: 'XRP',
  BCH: 'BCH',
  CRV: 'CRV',
  SNX: 'SNX',
  COMP: 'COMP',
  LDO: 'LDO',
  SUSHI: 'SUSHI',
  APE: 'APE',
  SHIB: 'SHIB',
  PEPE: 'PEPE',
  // USDC/USDT are quote assets, not tradeable bases here — intentionally absent.
}

/**
 * The terminal's order book + recent-trades feeds come from a CEX (Coinbase),
 * which only exists for majors Coinbase publicly lists. Every other pair is an
 * on-chain AMM pool with no central order book — we should say that honestly
 * rather than show "feed not wired". Returns the CEX symbol if supported, else
 * null.
 *
 * Resolution order: the ETH-by-address path (covers native ETH / WETH on
 * Ethereum even if the symbol is unusual), then a robust SYMBOL lookup that
 * works across chains for every other Coinbase-listed major.
 */
export function cexSymbol(
  baseAddress: string | undefined | null,
  chain: string,
  baseSymbol?: string | null,
): string | null {
  if (chain?.toLowerCase() === 'ethereum' && ETH_NATIVE.has((baseAddress ?? '').toLowerCase())) {
    return 'ETHUSDC'
  }
  const asset = SYMBOL_TO_COINBASE[(baseSymbol ?? '').trim().toUpperCase()]
  if (asset) return `${asset}USDC`
  return null
}

/**
 * Maps the internal CEX symbol (from `cexSymbol`, shaped `<ASSET>USDC`) to the
 * Coinbase Exchange product id used on the public WS feed
 * (`wss://ws-feed.exchange.coinbase.com`). Coinbase quotes against USD (not
 * USDC) on the Exchange order book, so e.g. ETH/USDC in our UI maps to the
 * ETH-USD product. Returns null when there's no public Coinbase market.
 */
export function coinbaseProductId(symbol: string | null | undefined): string | null {
  if (!symbol) return null
  if (symbol.endsWith('USDC')) {
    const asset = symbol.slice(0, -'USDC'.length)
    if (asset) return `${asset}-USD`
  }
  return null
}

export type FeedStatus = 'connected' | 'loading' | 'error' | 'unsupported'
