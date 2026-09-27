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
  const onVisible = () => {
    if (document.visibilityState === 'visible') cb()
  }
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('online', cb)
  window.addEventListener('pageshow', cb)
  return () => {
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('online', cb)
    window.removeEventListener('pageshow', cb)
  }
}
