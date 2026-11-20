/**
 * Shared liveness plumbing for the browser-direct market-data WebSockets
 * (Coinbase, Hyperliquid).
 *
 * A socket can die without ever firing `close`: laptop sleep, Wi-Fi/cellular
 * handoff, a Telegram webview being suspended, or a browser freezing a
 * background tab. The book/tape then silently freezes (or sits on the "error"
 * dot waiting out a 30s backoff) and the terminal reads as disconnected. Feeds
 * use these helpers to (1) treat a message gap as a dead socket and (2)
 * reconnect immediately when the user comes back or the network returns.
 */

/** No inbound message for this long on an open socket => treat it as dead. */
export const FEED_STALE_MS = 20_000
/** How often the watchdog checks for a stale socket. */
export const FEED_WATCHDOG_MS = 5_000

/**
 * Calls `cb` when the page becomes visible again or the browser regains
 * network. Returns an unsubscribe. No-ops outside a browser (tests/SSR).
 */
export function onFeedResume(cb: () => void): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {}
  // One resume (e.g. a BFCache restore) can fire visibilitychange, online and
  // pageshow together; coalesce them into a single callback.
  let pending: ReturnType<typeof setTimeout> | null = null
  const fire = () => {
    if (pending) return
    pending = setTimeout(() => {
      pending = null
      cb()
    }, 250)
  }
  const onVisible = () => {
    if (document.visibilityState === 'visible') fire()
  }
  // pageshow also fires on the initial load; only a BFCache restore matters.
  const onPageShow = (e: PageTransitionEvent) => {
    if (e.persisted) fire()
  }
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('online', fire)
  window.addEventListener('pageshow', onPageShow)
  return () => {
    if (pending) clearTimeout(pending)
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('online', fire)
    window.removeEventListener('pageshow', onPageShow)
  }
}

/**
 * Whether a resume should force a reconnect: yes if there's no socket (dead or
 * waiting out backoff) or an open socket has gone quiet; no if a connect is
 * already in flight or the socket is still delivering.
 */
export function shouldReconnectOnResume(ws: WebSocket | null, lastMessageAt: number): boolean {
  if (!ws) return true
  if (ws.readyState === WebSocket.CONNECTING) return false
  if (ws.readyState !== WebSocket.OPEN) return true
  return Date.now() - lastMessageAt > FEED_WATCHDOG_MS
}
