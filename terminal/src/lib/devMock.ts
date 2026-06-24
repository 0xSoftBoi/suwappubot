// Dev-only mock layer. When started with VITE_MOCK=1, intercepts window.fetch
// and serves realistic fixtures for the perps + predict desks so the workspace
// can be screenshotted / designed without running the Python + api-ts backends.
// Tree-shaken out of production builds (guarded by import.meta.env.DEV).

interface Candle {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

// Deterministic pseudo-random so screenshots are stable between runs.
function makeRng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0xffffffff
  }
}

function genCandles(seed: number, base: number, count: number, stepSec: number): Candle[] {
  const rng = makeRng(seed)
  const now = Math.floor(Date.now() / 1000)
  let price = base
  const out: Candle[] = []
  for (let i = count - 1; i >= 0; i--) {
    const drift = (rng() - 0.48) * base * 0.012
    const open = price
    const close = Math.max(base * 0.4, open + drift)
    const high = Math.max(open, close) * (1 + rng() * 0.004)
    const low = Math.min(open, close) * (1 - rng() * 0.004)
    out.push({
      time: now - i * stepSec,
      open,
      high,
      low,
      close,
      volume: base * (50 + rng() * 400),
    })
    price = close
  }
  return out
}

function genHistory(seed: number, start: number, count: number) {
  const rng = makeRng(seed)
  const now = Math.floor(Date.now() / 1000)
  let p = start
  const out: { time: number; value: number }[] = []
  for (let i = count - 1; i >= 0; i--) {
    p = Math.min(97, Math.max(3, p + (rng() - 0.5) * 5))
    out.push({ time: now - i * 3600, value: Math.round(p * 10) / 10 })
  }
  return out
}

const PERPS_MARKETS = [
  { name: 'BTC-USD', asset: 'BTC', szDecimals: 5, maxLeverage: 50, markPrice: 67482.5, fundingRate: 0.0000125 },
  { name: 'ETH-USD', asset: 'ETH', szDecimals: 4, maxLeverage: 50, markPrice: 3284.7, fundingRate: 0.0000088 },
  { name: 'SOL-USD', asset: 'SOL', szDecimals: 2, maxLeverage: 20, markPrice: 184.32, fundingRate: -0.000021 },
  { name: 'HYPE-USD', asset: 'HYPE', szDecimals: 2, maxLeverage: 10, markPrice: 28.41, fundingRate: 0.000044 },
  { name: 'DOGE-USD', asset: 'DOGE', szDecimals: 0, maxLeverage: 20, markPrice: 0.1632, fundingRate: -0.0000067 },
  { name: 'AVAX-USD', asset: 'AVAX', szDecimals: 2, maxLeverage: 20, markPrice: 36.78, fundingRate: 0.0000102 },
  { name: 'LINK-USD', asset: 'LINK', szDecimals: 2, maxLeverage: 20, markPrice: 17.93, fundingRate: 0.0000055 },
  { name: 'WIF-USD', asset: 'WIF', szDecimals: 1, maxLeverage: 10, markPrice: 2.84, fundingRate: -0.000033 },
]

const PERPS_POSITIONS = [
  { id: 1, market: 'ETH-USD', side: 'long', size: 4.2, leverage: 10, entryPrice: 3180.5, markPrice: 3284.7, unrealizedPnl: 437.6, liquidationPrice: 2890.1 },
  { id: 2, market: 'SOL-USD', side: 'short', size: 60, leverage: 5, entryPrice: 192.4, markPrice: 184.32, unrealizedPnl: 484.8, liquidationPrice: 221.7 },
]

const PERPS_ORDERS = [
  { orderId: '88213', market: 'BTC-USD', side: 'buy', size: 0.05, price: 65000, orderType: 'Limit', reduceOnly: false, isTrigger: false, triggerPrice: null },
  { orderId: '88214', market: 'ETH-USD', side: 'sell', size: 4.2, price: 3500, orderType: 'Take Profit Market', reduceOnly: true, isTrigger: true, triggerPrice: 3500 },
]

const PREDICT_MARKETS = [
  {
    id: '540817', conditionId: '0xaa1', question: 'Will the Fed cut rates in July 2026?',
    outcomes: ['Yes', 'No'], outcomePrices: [0.62, 0.38],
    tokens: [{ tokenId: 'tok-fed-yes', outcome: 'Yes' }, { tokenId: 'tok-fed-no', outcome: 'No' }],
    volume: 4820000, liquidity: 615000, endDate: '2026-07-31T12:00:00Z', active: true,
  },
  {
    id: '540818', conditionId: '0xaa2', question: 'BTC above $80k by end of 2026?',
    outcomes: ['Yes', 'No'], outcomePrices: [0.47, 0.53],
    tokens: [{ tokenId: 'tok-btc-yes', outcome: 'Yes' }, { tokenId: 'tok-btc-no', outcome: 'No' }],
    volume: 9120000, liquidity: 1240000, endDate: '2026-12-31T12:00:00Z', active: true,
  },
  {
    id: '540819', conditionId: '0xaa3', question: 'Will SpaceX reach Mars orbit in 2026?',
    outcomes: ['Yes', 'No'], outcomePrices: [0.18, 0.82],
    tokens: [{ tokenId: 'tok-mars-yes', outcome: 'Yes' }, { tokenId: 'tok-mars-no', outcome: 'No' }],
    volume: 2310000, liquidity: 388000, endDate: '2026-12-31T12:00:00Z', active: true,
  },
  {
    id: '540820', conditionId: '0xaa4', question: 'New all-time high for ETH in 2026?',
    outcomes: ['Yes', 'No'], outcomePrices: [0.34, 0.66],
    tokens: [{ tokenId: 'tok-eth-yes', outcome: 'Yes' }, { tokenId: 'tok-eth-no', outcome: 'No' }],
    volume: 5640000, liquidity: 720000, endDate: '2026-12-31T12:00:00Z', active: true,
  },
]

const PREDICT_POSITIONS = [
  { id: 'p1', marketId: '540817', question: 'Will the Fed cut rates in July 2026?', outcome: 'Yes', tokenId: 'tok-fed-yes', shares: 320, avgPrice: 0.54, currentPrice: 0.62, unrealizedPnl: 25.6, isResolved: false, claimable: false },
  { id: 'p2', marketId: '540818', question: 'BTC above $80k by end of 2026?', outcome: 'No', tokenId: 'tok-btc-no', shares: 150, avgPrice: 0.58, currentPrice: 0.53, unrealizedPnl: -7.5, isResolved: false, claimable: false },
]

// Fake authenticated session so the gated surfaces (positions, open orders,
// portfolio, trade tickets, deposit/withdraw) render. AuthContext flips to
// authenticated the moment GET /auth/me resolves with a real user.
const MOCK_USER = {
  authenticated: true,
  userId: 12345,
  address: '0x71C7656EC7ab88b098defB751B7401B5f6d8976F',
  walletProvider: 'turnkey',
}

const PORTFOLIO = {
  totalUsdValue: 48213.77,
  lastUpdated: new Date().toISOString(),
  tokens: [
    { symbol: 'ETH', name: 'Ethereum', address: '0xeee', chain: 'ethereum', balance: '8.42', usdValue: 27657.17 },
    { symbol: 'USDC', name: 'USD Coin', address: '0xa0b', chain: 'base', balance: '14200.00', usdValue: 14200 },
    { symbol: 'SOL', name: 'Solana', address: 'So111', chain: 'solana', balance: '32.1', usdValue: 5916.7 },
    { symbol: 'WIF', name: 'dogwifhat', address: 'Wif11', chain: 'solana', balance: '155.0', usdValue: 439.9 },
  ],
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function route(path: string, search: URLSearchParams): Response | null {
  if (path.endsWith('/auth/me')) return json(MOCK_USER)
  if (path.endsWith('/webapp/me/portfolio')) return json(PORTFOLIO)
  if (path.endsWith('/v1/agent/perps/markets')) return json({ markets: PERPS_MARKETS })
  if (path.endsWith('/terminal/perps/context')) {
    const ctx = PERPS_MARKETS.map((m, i) => {
      const rng = makeRng(m.asset.length * 13 + i + 1)
      // Realistic descending open interest ($2.5B down to ~$30M).
      const oiNotional = (2_600_000_000 / (i + 1)) * (0.55 + rng() * 0.6)
      return {
        asset: m.asset,
        name: m.name,
        markPrice: m.markPrice,
        oraclePrice: m.markPrice * (1 - m.fundingRate * 2),
        basisPct: (rng() - 0.5) * 0.12,
        funding: m.fundingRate,
        oiNotional,
        dayVolume: oiNotional * (0.8 + rng() * 2.5),
        dayChangePct: (rng() - 0.45) * 9,
        maxLeverage: m.maxLeverage,
      }
    }).sort((a, b) => b.oiNotional - a.oiNotional)
    return json(ctx)
  }
  if (path.endsWith('/terminal/perps/whales')) {
    const coin = (search.get('coin') || 'ETH-USD').split('-')[0].toUpperCase()
    const mark = PERPS_MARKETS.find((m) => m.asset === coin)?.markPrice ?? 3284.7
    const positions = [
      { address: '0xecb6…a287', side: 'short', notional: 14_090_000, leverage: 15, entryPrice: mark * 1.04, liquidationPrice: mark * 1.36, unrealizedPnl: 421_300 },
      { address: '0xfc66…1b0f', side: 'short', notional: 8_190_000, leverage: 20, entryPrice: mark * 1.02, liquidationPrice: mark * 1.18, unrealizedPnl: 255_181 },
      { address: '0x71c7…976f', side: 'short', notional: 4_320_000, leverage: 10, entryPrice: mark * 1.01, liquidationPrice: mark * 1.42, unrealizedPnl: -37_968 },
      { address: '0x9a3d…02ee', side: 'long', notional: 2_110_000, leverage: 8, entryPrice: mark * 0.98, liquidationPrice: mark * 0.84, unrealizedPnl: 64_200 },
      { address: '0x856c…f250', side: 'long', notional: 980_000, leverage: 25, entryPrice: mark * 0.995, liquidationPrice: mark * 0.96, unrealizedPnl: 1_150 },
    ]
    const longNotional = positions.filter((p) => p.side === 'long').reduce((s, p) => s + p.notional, 0)
    const shortNotional = positions.filter((p) => p.side === 'short').reduce((s, p) => s + p.notional, 0)
    return json({
      coin: `${coin}-USD`,
      markPrice: mark,
      sampled: 60,
      longNotional,
      shortNotional,
      longCount: 2,
      shortCount: 3,
      longPct: Math.round((longNotional / (longNotional + shortNotional)) * 1000) / 10,
      shortLiqAboveNotional: shortNotional,
      longLiqBelowNotional: longNotional,
      positions,
    })
  }
  if (path.endsWith('/terminal/token/safety')) {
    const chain = search.get('chain') || 'ethereum'
    return json({
      chain,
      address: search.get('address') || '',
      isHoneypot: false,
      canSell: true,
      buyTaxPct: 0,
      sellTaxPct: 0,
      mintable: false,
      freezable: false,
      ownerRenounced: true,
      lpLockedPct: 100,
      topHolderPct: 18,
      holderCount: 482000,
      score: 92,
      riskLevel: 'safe',
      flags: [],
      sources: chain === 'solana' ? ['rugcheck'] : ['goplus', 'honeypot.is'],
    })
  }
  if (path.endsWith('/terminal/market/regime'))
    return json({
      fearGreed: { value: 17, label: 'Extreme Fear' },
      btcDominance: 56.2,
      totalMcap: 2_230_000_000_000,
      mcapChange24h: -2.35,
      stablecoinMcap: 313_600_000_000,
    })
  if (path.endsWith('/terminal/signals'))
    return json([
      { id: 'squeeze:SOL-USD', category: 'squeeze', severity: 'alert', emoji: '⚡', title: 'SOL short squeeze building', detail: 'Up 3.1% while shorts pay funding — trapped shorts.', market: 'SOL-USD' },
      { id: 'regime:fng', category: 'regime', severity: 'alert', emoji: '😱', title: 'Extreme Fear (17)', detail: 'Market sentiment is capitulating — historically a contrarian buy zone.', market: '' },
      { id: 'funding:HYPE-USD', category: 'funding', severity: 'warn', emoji: '💸', title: 'HYPE funding +0.0044%/h', detail: 'Longs are paying heavily — crowded long, squeeze risk.', market: 'HYPE-USD' },
      { id: 'funding:TRUMP-USD', category: 'funding', severity: 'warn', emoji: '🧲', title: 'TRUMP funding -0.0053%/h', detail: 'Shorts are paying — crowded short, fuel for a squeeze.', market: 'TRUMP-USD' },
      { id: 'mover:DYDX-USD', category: 'mover', severity: 'info', emoji: '🚀', title: 'DYDX +8.8% (24h)', detail: 'Leading the board · $42M open interest.', market: 'DYDX-USD' },
      { id: 'mover:WLD-USD', category: 'mover', severity: 'info', emoji: '🔻', title: 'WLD -15.6% (24h)', detail: 'Worst performer · $88M open interest.', market: 'WLD-USD' },
    ])
  if (path.endsWith('/v1/agent/predict/markets')) return json({ markets: PREDICT_MARKETS })
  if (path.endsWith('/terminal/perps/account'))
    return json({ connected: true, address: '0x71C…9a2F', accountValue: 24817.43, maintenanceMarginUsed: 612.4, totalMarginUsed: 2480.9, withdrawable: 21100.2 })
  if (path.endsWith('/terminal/perps/positions')) return json({ positions: PERPS_POSITIONS })
  if (path.endsWith('/terminal/perps/orders')) return json({ orders: PERPS_ORDERS })
  if (path.endsWith('/terminal/predict/positions')) return json({ positions: PREDICT_POSITIONS })
  if (path.endsWith('/terminal/perps/candles')) {
    const coin = (search.get('coin') || 'ETH').toUpperCase()
    const m = PERPS_MARKETS.find((x) => x.name === coin || x.asset === coin.split('-')[0])
    const stepMap: Record<string, number> = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1D': 86400 }
    const step = stepMap[search.get('interval') || '1h'] ?? 3600
    return json(genCandles(coin.length * 7 + 3, m?.markPrice ?? 3000, 220, step))
  }
  if (path.endsWith('/terminal/predict/history')) {
    const tok = search.get('tokenId') || 'tok'
    const seed = tok.split('').reduce((a, c) => a + c.charCodeAt(0), 0)
    const market = PREDICT_MARKETS.find((mm) => mm.tokens.some((t) => t.tokenId === tok))
    const startPct = (market?.tokens.find((t) => t.tokenId === tok)?.outcome === 'Yes'
      ? (market?.outcomePrices[0] ?? 0.5)
      : (market?.outcomePrices[1] ?? 0.5)) * 100
    return json(genHistory(seed, startPct, 160))
  }
  return null
}

export function installDevMock() {
  const original = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    try {
      const u = new URL(url, window.location.origin)
      const res = route(u.pathname, u.searchParams)
      if (res) return res
    } catch {
      /* fall through to network */
    }
    return original(input, init)
  }
  // eslint-disable-next-line no-console
  console.info('[devMock] API fixtures active — perps + predict served from src/lib/devMock.ts')
}
