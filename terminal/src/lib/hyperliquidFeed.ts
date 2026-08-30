/**
 * Browser-direct HyperLiquid market-data WebSocket client for order-flow
 * signals. HL's public WS (`wss://api.hyperliquid.xyz/ws`) is keyless, so the
 * browser connects directly — same rationale as coinbaseFeed.ts (our edge
 * proxies plain fetch() and can't forward the WS upgrade).
 *
 * Subscriptions (per coin, both public):
 *   - `trades` → the live tape: side (B/A aggressor), px, sz, time, users.
 *     We derive CVD (cumulative volume delta), taker buy/sell and large prints.
 *   - `l2Book` → full L2 snapshots (px, sz, n per level). We derive best bid/
 *     ask, top-N depth and order-book imbalance.
 *
 * One socket per coin, reference-counted across hooks; capped backoff reconnect.
 */

export interface HlTrade {
  id: string
  price: number
  size: number
  notional: number // px * sz, USD
  side: 'buy' | 'sell' // aggressor
  time: number // ms
}

export interface CvdPoint {
  time: number
  value: number // cumulative signed size (coin units) since connect
}

export interface HlFlowState {
  status: 'connecting' | 'live' | 'error'
  trades: HlTrade[] // newest-first, capped
  cvd: number // running cumulative volume delta (coin units)
  cvdSeries: CvdPoint[] // capped, for a sparkline
  bestBid: number | null
  bestAsk: number | null
  bidDepth: number // Σ size over top DEPTH_LEVELS bids (coin units)
  askDepth: number // Σ size over top DEPTH_LEVELS asks
  imbalance: number // bidDepth / (bidDepth + askDepth), 0..1
}

type Listener = (state: HlFlowState) => void

const WS_URL = 'wss://api.hyperliquid.xyz/ws'
const MAX_TRADES = 60
const MAX_CVD_POINTS = 150
const DEPTH_LEVELS = 10
const BACKOFF_BASE_MS = 1_000
const BACKOFF_MAX_MS = 30_000

interface RawLevel {
  px: string
  sz: string
  n: number
}

class CoinFeed {
  private ws: WebSocket | null = null
  private trades: HlTrade[] = []
  private cvd = 0
  private cvdSeries: CvdPoint[] = []
  private bestBid: number | null = null
  private bestAsk: number | null = null
  private bidDepth = 0
  private askDepth = 0
  private status: HlFlowState['status'] = 'connecting'
  private listeners = new Set<Listener>()
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private closed = false

  constructor(private readonly coin: string) {
    this.connect()
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    fn(this.snapshot())
    return () => {
      this.listeners.delete(fn)
    }
  }

  get listenerCount(): number {
    return this.listeners.size
  }

  destroy(): void {
    this.closed = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.listeners.clear()
    this.teardownSocket()
  }

  private teardownSocket(): void {
    if (this.ws) {
      this.ws.onopen = null
      this.ws.onmessage = null
      this.ws.onerror = null
      this.ws.onclose = null
      try {
        this.ws.close()
      } catch {
        /* ignore */
      }
      this.ws = null
    }
  }

  private connect(): void {
    if (this.closed) return
    this.status = 'connecting'
    let ws: WebSocket
    try {
      ws = new WebSocket(WS_URL)
    } catch {
      this.scheduleReconnect()
      return
    }
    this.ws = ws

    ws.onopen = () => {
      if (this.ws !== ws) return
      this.reconnectAttempts = 0
      for (const type of ['trades', 'l2Book']) {
        ws.send(JSON.stringify({ method: 'subscribe', subscription: { type, coin: this.coin } }))
      }
    }

    ws.onmessage = (ev) => {
      if (this.ws !== ws) return
      let msg: { channel?: string; data?: unknown }
      try {
        msg = JSON.parse(ev.data as string)
      } catch {
        return
      }
      // One malformed or unexpected message must not kill the whole feed: an
      // uncaught throw here leaves the socket open but the handler dead, so the
      // book/tape silently freezes and the terminal looks down.
      try {
        this.handle(msg)
      } catch (err) {
        console.error('[hyperliquidFeed] dropped message', err)
      }
    }

    ws.onerror = () => {
      if (this.ws !== ws) return
      this.status = 'error'
      this.emit()
    }

    ws.onclose = () => {
      if (this.ws !== ws || this.closed) return
      this.ws = null
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer) return
    this.status = 'error'
    this.emit()
    const delay = Math.min(BACKOFF_BASE_MS * 2 ** this.reconnectAttempts, BACKOFF_MAX_MS)
    this.reconnectAttempts += 1
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }

  private handle(msg: { channel?: string; data?: unknown }): void {
    if (msg.channel === 'trades' && Array.isArray(msg.data)) {
      // HL sends trades oldest-first within a batch; process in order so CVD
      // accumulates correctly, then the list is newest-first.
      for (const t of msg.data as Array<Record<string, unknown>>) {
        if ((t.coin as string) !== this.coin) continue
        const price = Number(t.px)
        const size = Number(t.sz)
        if (!Number.isFinite(price) || !Number.isFinite(size)) continue
        const side: 'buy' | 'sell' = t.side === 'B' ? 'buy' : 'sell'
        this.cvd += side === 'buy' ? size : -size
        this.trades.unshift({
          id: String(t.tid ?? `${t.time}-${t.hash}`),
          price,
          size,
          notional: price * size,
          side,
          time: Number(t.time),
        })
      }
      if (this.trades.length > MAX_TRADES) this.trades.length = MAX_TRADES
      const last = this.trades[0]
      this.cvdSeries.push({ time: last ? last.time : 0, value: this.cvd })
      if (this.cvdSeries.length > MAX_CVD_POINTS) this.cvdSeries.shift()
      this.status = 'live'
      this.emit()
      return
    }

    if (msg.channel === 'l2Book' && msg.data && typeof msg.data === 'object') {
      const data = msg.data as { coin?: string; levels?: [RawLevel[], RawLevel[]] }
      if (data.coin !== this.coin || !data.levels) return
      const [bids, asks] = data.levels
      this.bestBid = bids?.[0] ? Number(bids[0].px) : null
      this.bestAsk = asks?.[0] ? Number(asks[0].px) : null
      this.bidDepth = (bids ?? []).slice(0, DEPTH_LEVELS).reduce((s, l) => s + Number(l.sz), 0)
      this.askDepth = (asks ?? []).slice(0, DEPTH_LEVELS).reduce((s, l) => s + Number(l.sz), 0)
      this.status = 'live'
      this.emit()
    }
  }

  private snapshot(): HlFlowState {
    const denom = this.bidDepth + this.askDepth
    return {
      status: this.status,
      trades: this.trades.slice(),
      cvd: this.cvd,
      cvdSeries: this.cvdSeries.slice(),
      bestBid: this.bestBid,
      bestAsk: this.bestAsk,
      bidDepth: this.bidDepth,
      askDepth: this.askDepth,
      imbalance: denom > 0 ? this.bidDepth / denom : 0.5,
    }
  }

  private emit(): void {
    const snap = this.snapshot()
    for (const fn of this.listeners) fn(snap)
  }
}

// Reference-counted registry: one socket per coin shared across hooks.
const feeds = new Map<string, CoinFeed>()

export function acquireHlFeed(coin: string, fn: Listener): () => void {
  let feed = feeds.get(coin)
  if (!feed) {
    feed = new CoinFeed(coin)
    feeds.set(coin, feed)
  }
  const unsub = feed.subscribe(fn)
  return () => {
    unsub()
    const f = feeds.get(coin)
    if (f && f.listenerCount === 0) {
      f.destroy()
      feeds.delete(coin)
    }
  }
}
