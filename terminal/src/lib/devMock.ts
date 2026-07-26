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

// Deribit options intel (BTC/ETH). Realistic magnitudes: BTC OI dwarfs ETH,
// funding-scale numbers only, no fabricated precision.
const OPTIONS_CONTEXT: Record<'BTC' | 'ETH', unknown> = {
  BTC: {
    currency: 'BTC',
    spot: 118250.5,
    dvol: { value: 48.2, change24h: -1.3 },
    putCallOiRatio: 0.62,
    totalOiUsd: 21_500_000_000,
    atmIv: 46.8,
    skew10pct: 3.2,
    maxPain: { expiry: '2026-07-31', strike: 115000, oiUsd: 2_100_000_000 },
    topStrikes: [
      { strike: 120000, oiUsd: 1_800_000_000, callOiUsd: 1_500_000_000, putOiUsd: 300_000_000 },
      { strike: 130000, oiUsd: 1_420_000_000, callOiUsd: 1_260_000_000, putOiUsd: 160_000_000 },
      { strike: 110000, oiUsd: 1_180_000_000, callOiUsd: 320_000_000, putOiUsd: 860_000_000 },
      { strike: 100000, oiUsd: 960_000_000, callOiUsd: 140_000_000, putOiUsd: 820_000_000 },
    ],
    expiries: [
      { date: '2026-07-31', oiUsd: 2_100_000_000, daysOut: 6 },
      { date: '2026-08-29', oiUsd: 4_650_000_000, daysOut: 35 },
      { date: '2026-09-26', oiUsd: 3_120_000_000, daysOut: 63 },
    ],
    updatedAt: new Date().toISOString(),
  },
  ETH: {
    currency: 'ETH',
    spot: 3284.7,
    dvol: { value: 61.4, change24h: 2.1 },
    putCallOiRatio: 0.81,
    totalOiUsd: 6_800_000_000,
    atmIv: 58.2,
    skew10pct: 4.6,
    maxPain: { expiry: '2026-07-31', strike: 3200, oiUsd: 540_000_000 },
    topStrikes: [
      { strike: 3500, oiUsd: 410_000_000, callOiUsd: 340_000_000, putOiUsd: 70_000_000 },
      { strike: 3000, oiUsd: 380_000_000, callOiUsd: 90_000_000, putOiUsd: 290_000_000 },
      { strike: 4000, oiUsd: 260_000_000, callOiUsd: 232_000_000, putOiUsd: 28_000_000 },
      { strike: 2800, oiUsd: 210_000_000, callOiUsd: 40_000_000, putOiUsd: 170_000_000 },
    ],
    expiries: [
      { date: '2026-07-31', oiUsd: 540_000_000, daysOut: 6 },
      { date: '2026-08-29', oiUsd: 1_180_000_000, daysOut: 35 },
      { date: '2026-09-26', oiUsd: 890_000_000, daysOut: 63 },
    ],
    updatedAt: new Date().toISOString(),
  },
}

// Next OKX 8h funding boundary (00:00/08:00/16:00 UTC) for a realistic
// nextFundingTime.
function nextFundingBoundary(): string {
  const now = new Date()
  const hours = now.getUTCHours()
  const nextBoundary = Math.ceil((hours + 0.01) / 8) * 8
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), nextBoundary % 24, 0, 0))
  if (nextBoundary >= 24) d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString()
}

// OKX publishes retail positioning + taker flow only for its major markets;
// everything else falls back to HL-only funding (honest degradation, not 0).
const OKX_MAJORS = new Set(['BTC', 'ETH', 'SOL', 'DOGE'])

function positioningFor(coin: string) {
  const hlMarket = PERPS_MARKETS.find((m) => m.asset === coin)
  const hlFundingHourly = hlMarket?.fundingRate ?? 0.00001
  const hl = { fundingHourly: hlFundingHourly, funding8h: hlFundingHourly * 8 }

  if (!OKX_MAJORS.has(coin)) {
    return {
      coin,
      longShort: null,
      takerFlow: null,
      okx: null,
      hl,
      fundingSpreadBps8h: null,
      read: null,
      updatedAt: new Date().toISOString(),
    }
  }

  const rng = makeRng(coin.length * 31 + 7)
  const okxFunding8h = (rng() - 0.5) * 0.0006
  const spreadBps8h = Math.round((hl.funding8h - okxFunding8h) * 10_000 * 100) / 100
  const cheaperVenue = spreadBps8h <= 0 ? 'HL' : 'OKX'
  return {
    coin,
    longShort: { value: 1.35, change24h: 0.12 },
    takerFlow: { buySellRatio: 0.97, buyVolUsd: 412_000_000, sellVolUsd: 425_000_000, windowHours: 4 },
    okx: { fundingRate8h: okxFunding8h, nextFundingTime: nextFundingBoundary(), oiUsd: 4_200_000_000 },
    hl,
    fundingSpreadBps8h: spreadBps8h,
    read: `Longs pay less on ${cheaperVenue} than ${cheaperVenue === 'HL' ? 'OKX' : 'HL'} — ${cheaperVenue} is the cheaper long`,
    updatedAt: new Date().toISOString(),
  }
}

// Macro calendar — FOMC/CPI/options-expiry. Dates sit around the fixed "now"
// used elsewhere in these fixtures so the Catalysts rail has near-term rows.
const CATALYSTS = [
  {
    date: '2026-07-29',
    timeUtc: '18:00',
    kind: 'fomc',
    title: 'FOMC rate decision',
    detail: 'Federal Reserve interest rate decision + press conference.',
    source: 'Federal Reserve schedule',
  },
  {
    date: '2026-07-31',
    timeUtc: '08:00',
    kind: 'options-expiry',
    title: 'BTC options expiry — $2.1B notional',
    detail: 'Max pain 115,000',
    source: 'Deribit',
  },
  {
    date: '2026-08-12',
    timeUtc: '12:30',
    kind: 'cpi',
    title: 'US CPI (July)',
    detail: 'Headline + core inflation print.',
    source: 'BLS schedule',
  },
  {
    date: '2026-08-29',
    timeUtc: '08:00',
    kind: 'options-expiry',
    title: 'BTC monthly options expiry — $4.65B notional',
    detail: null,
    source: 'Deribit',
  },
]

// ISO timestamp `hoursAgo` hours before "now" — reused by execution-quality
// fixtures so fills/swaps read as a believable recent history.
function isoHoursAgo(hoursAgo: number): string {
  return new Date(Date.now() - hoursAgo * 3_600_000).toISOString()
}

// Execution quality — the flagship depth feature. Mixes negative and
// positive 5m markouts (real desks aren't adversely selected on every fill)
// and one fill with a null 30m horizon (too recent for that candle yet).
// Spot swaps include two rows with a null shortfall + honest note, matching
// the "quote snapshot unavailable" degradation path.
const EXECUTION_QUALITY = {
  perps: {
    address: '0x71C7656EC7ab88b098defB751B7401B5f6d8976F',
    fills: [
      { time: isoHoursAgo(1), coin: 'ETH', side: 'buy', px: 3712.5, sz: 1.2, feeUsd: 1.42, closedPnlUsd: 12.1, markoutBps: { m1: -3.2, m5: -8.1, m30: 4.0 } },
      { time: isoHoursAgo(4), coin: 'ETH', side: 'sell', px: 3298.1, sz: 0.8, feeUsd: 0.95, closedPnlUsd: -4.6, markoutBps: { m1: 1.1, m5: 3.4, m30: null } },
      { time: isoHoursAgo(9), coin: 'SOL', side: 'buy', px: 184.2, sz: 15, feeUsd: 0.62, closedPnlUsd: 22.8, markoutBps: { m1: -1.0, m5: -2.5, m30: -6.1 } },
      { time: isoHoursAgo(26), coin: 'BTC', side: 'sell', px: 67310.0, sz: 0.05, feeUsd: 1.1, closedPnlUsd: 8.3, markoutBps: { m1: 2.4, m5: 6.7, m30: 11.2 } },
      { time: isoHoursAgo(48), coin: 'HYPE', side: 'buy', px: 28.9, sz: 40, feeUsd: 0.4, closedPnlUsd: -3.1, markoutBps: { m1: -0.8, m5: -5.9, m30: -9.8 } },
      { time: isoHoursAgo(70), coin: 'ETH', side: 'sell', px: 3350.0, sz: 2.0, feeUsd: 2.1, closedPnlUsd: 44.5, markoutBps: { m1: 0.6, m5: -1.2, m30: 2.8 } },
    ],
    aggregates: {
      fillCount: 124,
      avgMarkoutBps: { m1: -1.4, m5: -4.4, m30: -1.0 },
      totalFeesUsd: 214.5,
      winRate: 0.54,
      read: "Your fills are followed by adverse moves (−4.4 bps avg at 5m) — you're paying for immediacy; consider resting limits or smaller clips.",
    },
  },
  spot: {
    swaps: [
      { time: isoHoursAgo(3), route: 'lifi', pair: 'SOL→WIF', shortfallBps: -42.0, feesUsd: 1.1, note: null },
      { time: isoHoursAgo(20), route: 'jupiter', pair: 'USDC→SOL', shortfallBps: -8.5, feesUsd: 0.3, note: null },
      { time: isoHoursAgo(30), route: 'lifi', pair: 'ETH→USDC', shortfallBps: null, feesUsd: 2.4, note: 'quote snapshot unavailable' },
      { time: isoHoursAgo(52), route: '1inch', pair: 'WBTC→ETH', shortfallBps: null, feesUsd: 3.9, note: 'quote snapshot unavailable' },
      { time: isoHoursAgo(75), route: 'jupiter', pair: 'WIF→USDC', shortfallBps: -14.2, feesUsd: 0.5, note: null },
    ],
    aggregates: {
      count: 18,
      avgShortfallBps: -18.0,
      totalFeesUsd: 40.2,
      byRoute: [
        { route: 'lifi', count: 12, avgShortfallBps: -22.0 },
        { route: 'jupiter', count: 4, avgShortfallBps: -6.1 },
        { route: '1inch', count: 2, avgShortfallBps: -10.4 },
      ],
      read: 'Your swaps land ~18 bps below quote on average — mostly routing through LI.FI on volatile pairs, where the extra hop gives the market time to move before you fill.',
    },
  },
  updatedAt: new Date().toISOString(),
}

// Capital-at-risk estimate for the perps order ticket. Mirrors the fresh-
// isolated-position liquidation formula PerpsPanel already uses for its own
// display-only "Est. liq" so the two numbers agree in the mock. Pinned to
// level "warn" per the fixture spec — a real backend would derive level from
// pctOfPerpsEquity thresholds the frontend never hardcodes; it only trusts
// the server's `level`.
function perpsRiskFixture(
  coin: string,
  side: 'long' | 'short',
  size: number,
  leverage: number,
  marginMode: string,
): Response {
  const m = PERPS_MARKETS.find((x) => x.asset === coin) ?? PERPS_MARKETS[1]
  const markPx = m.markPrice
  const maxLeverage = m.maxLeverage
  const lev = Math.max(leverage, 1)
  const notionalUsd = size * markPx
  const marginUsd = notionalUsd / lev
  const mmf = 1 / (2 * maxLeverage)
  const liqPxEst =
    side === 'long' ? (markPx * (1 - 1 / lev)) / (1 - mmf) : (markPx * (1 + 1 / lev)) / (1 + mmf)
  const liqDistancePct = ((liqPxEst - markPx) / markPx) * 100
  const worstCaseLossUsd = marginUsd
  const perpsEquityUsd = 1810
  const pctOfPerpsEquity = Math.round((worstCaseLossUsd / perpsEquityUsd) * 1000) / 10
  return json({
    coin,
    side,
    markPx,
    notionalUsd: Math.round(notionalUsd * 100) / 100,
    marginUsd: Math.round(marginUsd * 100) / 100,
    maxLeverage,
    liqPxEst: Math.round(liqPxEst * 100) / 100,
    liqDistancePct: Math.round(liqDistancePct * 10) / 10,
    worstCaseLossUsd: Math.round(worstCaseLossUsd * 100) / 100,
    crossNote:
      marginMode === 'cross'
        ? "Cross margin — a loss here can draw on your other positions' margin too."
        : null,
    perpsEquityUsd,
    totalEquityUsd: null,
    pctOfPerpsEquity,
    pctOfTotalEquity: null,
    level: 'warn',
    note: `Liquidation on this position would cost ~$${Math.round(worstCaseLossUsd)} — ${pctOfPerpsEquity}% of your perps equity. Serious desks size so one loss can't end the account (fractional-Kelly: risk a few % per idea).`,
    updatedAt: new Date().toISOString(),
  })
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

const POPULAR_TOKENS = [
  { symbol: 'ETH', name: 'Ethereum', address: '0xeee', chain: 'ethereum', decimals: 18 },
  { symbol: 'WBTC', name: 'Wrapped Bitcoin', address: '0x2260', chain: 'ethereum', decimals: 8 },
  { symbol: 'PEPE', name: 'Pepe', address: '0x6982', chain: 'ethereum', decimals: 18 },
  { symbol: 'USDC', name: 'USD Coin', address: '0xa0b8', chain: 'ethereum', decimals: 6 },
  { symbol: 'LINK', name: 'Chainlink', address: '0x5149', chain: 'ethereum', decimals: 18 },
  { symbol: 'AERO', name: 'Aerodrome', address: '0x9401', chain: 'base', decimals: 18 },
  { symbol: 'WIF', name: 'dogwifhat', address: 'Wif11', chain: 'solana', decimals: 6 },
]

function route(path: string, search: URLSearchParams): Response | null {
  if (path.endsWith('/terminal/wallet/summary'))
    return json({
      evmDepositAddress: '0x71C7656EC7ab88b098defB751B7401B5f6d8976F',
      solanaDepositAddress: '7Np41oeYqPefeNQEHSv1UDhYrehxin3NStpDBwxVqzz5',
      balances: [
        { chain: 'base', token: 'USDC', amount: 1240.5 },
        { chain: 'ethereum', token: 'ETH', amount: 0.82 },
        { chain: 'solana', token: 'SOL', amount: 14.3 },
      ],
      withdrawEnabled: true,
    })
  if (path.endsWith('/terminal/wallet/withdraw'))
    return json({ ok: true, txHash: '0xabc123def4567890abc123def4567890abc123def4567890abc123def4567890', status: 'submitted' })
  if (path.includes('/webapp/tokens/popular')) return json(POPULAR_TOKENS)
  if (path.includes('/webapp/tokens/search')) {
    const q = (search.get('q') || '').toLowerCase()
    return json(POPULAR_TOKENS.filter((t) => t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q)))
  }
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
  if (path.endsWith('/terminal/options/context')) {
    const currency = (search.get('currency') || 'BTC').toUpperCase()
    return json(OPTIONS_CONTEXT[currency as 'BTC' | 'ETH'] ?? OPTIONS_CONTEXT.BTC)
  }
  if (path.endsWith('/terminal/perps/positioning')) {
    const coin = (search.get('coin') || 'BTC').split('-')[0].toUpperCase()
    return json(positioningFor(coin))
  }
  if (path.endsWith('/terminal/catalysts')) return json(CATALYSTS)
  if (path.endsWith('/terminal/market/regime'))
    return json({
      fearGreed: { value: 17, label: 'Extreme Fear' },
      btcDominance: 56.2,
      totalMcap: 2_230_000_000_000,
      mcapChange24h: -2.35,
      stablecoinMcap: 313_600_000_000,
    })
  if (path.endsWith('/terminal/discovery/final-stretch')) {
    const now = Date.now()
    const mk = (
      i: number,
      symbol: string,
      ageMin: number,
      mcap: number,
      vol: number,
      txns: number,
      insiders: number | null,
      bundle: number | null,
    ) => ({
      address: `FinalStretchMint${i}xxxxxxxxxxxxxxxxxxxxxxxxxxxxx`.slice(0, 44),
      symbol,
      name: `${symbol} Token`,
      chain: 'solana',
      stage: 'final_stretch' as const,
      createdAt: new Date(now - ageMin * 60_000).toISOString(),
      marketCap: mcap,
      volume24h: vol,
      liquidityUsd: mcap * 0.35,
      priceUsd: mcap / 1_000_000_000,
      txns24h: txns,
      buys24h: Math.round(txns * 0.6),
      sells24h: Math.round(txns * 0.4),
      insidersPercent: insiders,
      bundlePercent: bundle,
      bondingProgress: Math.min(99, Math.round((mcap / 90_000) * 100)),
    })
    return json([
      mk(1, 'STRETCH', 4, 18_000, 92_000, 640, 62.4, 12.1),
      mk(2, 'BONDR', 12, 34_500, 210_000, 1_450, 41.2, null),
      mk(3, 'PUMPX', 27, 61_200, 305_000, 2_010, null, 28.6),
      mk(4, 'GRAD', 58, 78_900, 118_000, 870, 18.9, 4.2),
      mk(5, 'MOONB', 95, 12_100, 45_000, 210, 71.5, 33.8),
    ])
  }
  if (path.endsWith('/terminal/signals'))
    return json([
      { id: 'squeeze:SOL-USD', category: 'squeeze', severity: 'alert', emoji: '⚡', title: 'SOL short squeeze building', detail: 'Up 3.1% while shorts pay funding — trapped shorts.', market: 'SOL-USD' },
      { id: 'regime:fng', category: 'regime', severity: 'alert', emoji: '😱', title: 'Extreme Fear (17)', detail: 'Market sentiment is capitulating — historically a contrarian buy zone.', market: '' },
      { id: 'funding:HYPE-USD', category: 'funding', severity: 'warn', emoji: '💸', title: 'HYPE funding +0.0044%/h', detail: 'Longs are paying heavily — crowded long, squeeze risk.', market: 'HYPE-USD' },
      { id: 'funding:TRUMP-USD', category: 'funding', severity: 'warn', emoji: '🧲', title: 'TRUMP funding -0.0053%/h', detail: 'Shorts are paying — crowded short, fuel for a squeeze.', market: 'TRUMP-USD' },
      { id: 'mover:DYDX-USD', category: 'mover', severity: 'info', emoji: '🚀', title: 'DYDX +8.8% (24h)', detail: 'Leading the board · $42M open interest.', market: 'DYDX-USD' },
      { id: 'mover:WLD-USD', category: 'mover', severity: 'info', emoji: '🔻', title: 'WLD -15.6% (24h)', detail: 'Worst performer · $88M open interest.', market: 'WLD-USD' },
      { id: 'positioning:BTC-USD', category: 'positioning', severity: 'info', emoji: '🐂', title: 'BTC retail L/S ratio 1.35', detail: 'OKX retail is 35% net long — crowded but not extreme.', market: 'BTC-USD' },
      { id: 'funding-arb:BTC-USD', category: 'funding-arb', severity: 'info', emoji: '⚖️', title: 'BTC funding spread: HL cheaper by 4bps/8h', detail: 'Longs pay less on HyperLiquid than OKX right now.', market: 'BTC-USD' },
      { id: 'vol:BTC', category: 'vol', severity: 'warn', emoji: '📉', title: 'BTC DVOL down 1.3% (24h)', detail: '10Δ skew +3.2 — puts still bid into month-end expiry.', market: 'BTC-USD' },
      { id: 'event:fomc', category: 'event', severity: 'alert', emoji: '🏛️', title: 'FOMC rate decision in 4 days', detail: 'Jul 29, 18:00 UTC — positioning risk into the print.', market: '' },
    ])
  if (path.endsWith('/v1/agent/predict/markets')) return json({ markets: PREDICT_MARKETS })
  if (path.endsWith('/terminal/perps/account'))
    return json({ connected: true, address: '0x71C…9a2F', accountValue: 24817.43, maintenanceMarginUsed: 612.4, totalMarginUsed: 2480.9, withdrawable: 21100.2 })
  if (path.endsWith('/terminal/perps/positions')) return json({ positions: PERPS_POSITIONS })
  if (path.endsWith('/terminal/perps/orders')) return json({ orders: PERPS_ORDERS })
  if (path.endsWith('/terminal/predict/positions')) return json({ positions: PREDICT_POSITIONS })
  if (path.endsWith('/terminal/execution/quality')) return json(EXECUTION_QUALITY)
  if (path.endsWith('/terminal/perps/risk')) {
    const coin = (search.get('coin') || 'ETH').split('-')[0].toUpperCase()
    const side = search.get('side') === 'short' ? 'short' : 'long'
    const size = parseFloat(search.get('size') || '0') || 0
    const leverage = parseFloat(search.get('leverage') || '1') || 1
    const marginMode = search.get('marginMode') || 'isolated'
    return perpsRiskFixture(coin, side, size, leverage, marginMode)
  }
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
