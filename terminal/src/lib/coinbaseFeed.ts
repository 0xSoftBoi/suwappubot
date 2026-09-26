/**
 * Browser-direct Coinbase Exchange WebSocket market-data client.
 *
 * WHY DIRECT (not via our edge): production fronts api.suwappu.bot with a
 * Cloudflare Worker (`cloudflare/suwappu-router.worker.js`) that proxies every
 * request with plain `fetch(proxied)`. Plain fetch() does NOT forward the
 * WebSocket `Upgrade` handshake, so a WS routed through our edge would 426/fail
 * unless the Worker is rewritten to detect upgrades and return the upstream's
 * `webSocket`. Coinbase's Exchange feed is public and unauthenticated, so the
 * browser can connect to it directly — no backend, no edge change, works today.
 *
 * Channels used (both public, no auth required):
 *   - `level2_batch` → `snapshot` (full book) + `l2update` (incremental deltas).
 *     `level2` itself now requires auth; `level2_batch` is the public, ~50ms
 *     debounced equivalent and is what we use to stay key-free in the browser.
 *   - `matches` → live trade tape (`match` / `last_match`).
 *
 * One WebSocket per product id, reference-counted: multiple hooks (order book +
 * trades for the same pair) share a single socket. Reconnects with capped
 * exponential backoff; rebuilds the book from the next `snapshot` on reconnect.
 */

export interface BookLevel {
  price: number
  size: number
}

export interface RawTrade {
  id: string
  price: number
  size: number
  side: 'buy' | 'sell'
  time: number
}

export interface CoinbaseFeedState {
  /** sorted desc by price */
  bids: BookLevel[]
  /** sorted asc by price */
  asks: BookLevel[]
  /** newest-first, capped */
  trades: RawTrade[]
  status: 'connecting' | 'live' | 'error'
}

type Listener = (state: CoinbaseFeedState) => void

const WS_URL = 'wss://ws-feed.exchange.coinbase.com'
const MAX_TRADES = 60
const BACKOFF_BASE_MS = 1_000
const BACKOFF_MAX_MS = 30_000

/**
 * Bound how often a burst of incremental market-data messages can cross the
 * feed -> React boundary. Coinbase already batches L2 changes at roughly 50ms,
 * but trade messages can interleave with those book updates. Coalescing them
 * here keeps the UI fresh while avoiding a full-book sort + subscriber render
 * for every individual WebSocket message.
 */
export const COINBASE_UI_FLUSH_MS = 75

interface L2Message {
  type: string
  product_id?: string
  bids?: [string, string][]
  asks?: [string, string][]
  changes?: [string, string, string][]
}

interface MatchMessage {
  type: string
  product_id?: string
  trade_id?: number
  price?: string
  size?: string
  /** Coinbase `side` is the maker side; taker side is the opposite. */
  side?: 'buy' | 'sell'
  time?: string
}

/**
 * A live connection to one Coinbase product. Bid/ask levels are kept in
 * price->size maps so `l2update` deltas are O(1); the sorted arrays the UI
 * consumes are materialized at most once per state version. Incremental book
 * and trade messages are flushed to subscribers on a short bounded cadence.
 */
class ProductFeed {
  private ws: WebSocket | null = null
  private bids = new Map<number, number>()
  private asks = new Map<number, number>()
  private trades: RawTrade[] = []
  private status: CoinbaseFeedState['status'] = 'connecting'
  private listeners = new Set<Listener>()
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private stateVersion = 0
  private cachedSnapshotVersion = -1
  private cachedSnapshot: CoinbaseFeedState | null = null
  private closed = false

  constructor(private readonly productId: string) {
    this.connect()
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    // Push current snapshot immediately so late subscribers aren't blank.
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
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = null
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
    this.markDirty()

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
      ws.send(
        JSON.stringify({
          type: 'subscribe',
          product_ids: [this.productId],
          channels: ['level2_batch', 'matches'],
        }),
      )
    }

    ws.onmessage = (ev) => {
      if (this.ws !== ws) return
      let msg: L2Message & MatchMessage
      try {
        msg = JSON.parse(ev.data as string)
      } catch {
        return
      }
      if (msg.product_id && msg.product_id !== this.productId) return
      // One malformed or unexpected message must not kill the whole feed: an
      // uncaught throw here leaves the socket open but the handler dead, so the
      // book/tape silently freezes and the terminal looks down.
      try {
        this.handle(msg)
      } catch (err) {
        console.error('[coinbaseFeed] dropped message', err)
      }
    }

    ws.onerror = () => {
      if (this.ws !== ws) return
      this.status = 'error'
      this.markDirty()
      this.emitNow()
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
    this.markDirty()
    this.emitNow()
    const delay = Math.min(
      BACKOFF_BASE_MS * 2 ** this.reconnectAttempts,
      BACKOFF_MAX_MS,
    )
    this.reconnectAttempts += 1
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      // Drop the stale book; the fresh `snapshot` rebuilds it from scratch.
      this.bids.clear()
      this.asks.clear()
      this.markDirty()
      this.connect()
    }, delay)
  }

  private handle(msg: L2Message & MatchMessage): void {
    switch (msg.type) {
      case 'snapshot': {
        this.bids.clear()
        this.asks.clear()
        for (const [p, s] of msg.bids ?? []) this.setLevel('buy', +p, +s)
        for (const [p, s] of msg.asks ?? []) this.setLevel('sell', +p, +s)
        this.status = 'live'
        this.markDirty()
        // The initial/reconnect snapshot is the point at which the live book
        // becomes usable, so publish it immediately rather than adding latency.
        this.emitNow()
        break
      }
      case 'l2update': {
        for (const [side, p, s] of msg.changes ?? []) {
          this.setLevel(side === 'buy' ? 'buy' : 'sell', +p, +s)
        }
        this.status = 'live'
        this.markDirty()
        this.scheduleEmit()
        break
      }
      case 'last_match':
      case 'match': {
        if (msg.price == null || msg.size == null || msg.trade_id == null) break
        // Coinbase reports the *maker* side; the aggressor (taker) is the
        // opposite — that's the side traders read as the trade's direction.
        const takerSide: 'buy' | 'sell' = msg.side === 'sell' ? 'buy' : 'sell'
        const trade: RawTrade = {
          id: String(msg.trade_id),
          price: +msg.price,
          size: +msg.size,
          side: takerSide,
          time: msg.time ? Date.parse(msg.time) : Date.now(),
        }
        // `last_match` is the one-shot trade Coinbase sends on subscribe; treat
        // it the same as a live `match` but guard against duplicate ids.
        if (this.trades[0]?.id === trade.id) break
        this.trades = [trade, ...this.trades].slice(0, MAX_TRADES)
        this.status = 'live'
        this.markDirty()
        this.scheduleEmit()
        break
      }
      default:
        break
    }
  }

  private setLevel(side: 'buy' | 'sell', price: number, size: number): void {
    const book = side === 'buy' ? this.bids : this.asks
    if (!Number.isFinite(price)) return
    if (size > 0) book.set(price, size)
    else book.delete(price)
  }

  private snapshot(): CoinbaseFeedState {
    if (
      this.cachedSnapshot &&
      this.cachedSnapshotVersion === this.stateVersion
    ) {
      return this.cachedSnapshot
    }
    const bids = [...this.bids.entries()]
      .map(([price, size]) => ({ price, size }))
      .sort((a, b) => b.price - a.price)
    const asks = [...this.asks.entries()]
      .map(([price, size]) => ({ price, size }))
      .sort((a, b) => a.price - b.price)
    const state = { bids, asks, trades: this.trades, status: this.status }
    this.cachedSnapshot = state
    this.cachedSnapshotVersion = this.stateVersion
    return state
  }

  private markDirty(): void {
    this.stateVersion += 1
  }

  private scheduleEmit(): void {
    if (this.listeners.size === 0 || this.flushTimer) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      this.emitNow()
    }, COINBASE_UI_FLUSH_MS)
  }

  private emitNow(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    if (this.listeners.size === 0) return
    const state = this.snapshot()
    for (const fn of this.listeners) fn(state)
  }
}

// Reference-counted registry: one ProductFeed per product id, shared by all
// hooks. Destroyed when the last subscriber unsubscribes.
const feeds = new Map<string, ProductFeed>()

export function subscribeCoinbase(
  productId: string,
  listener: Listener,
): () => void {
  let feed = feeds.get(productId)
  if (!feed) {
    feed = new ProductFeed(productId)
    feeds.set(productId, feed)
  }
  const unsub = feed.subscribe(listener)
  return () => {
    unsub()
    const f = feeds.get(productId)
    if (f && f.listenerCount === 0) {
      f.destroy()
      feeds.delete(productId)
    }
  }
}
