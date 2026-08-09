# Gecko mobile performance contract

Gecko's V0 native client is built around one rule: make the read-only money
surface feel immediate without weakening the account boundary. The app uses
Expo SDK 52, Hermes, React Native's New Architecture, TanStack Query, MMKV,
SecureStore, and the shared Suwappu React Native design tokens.

## Startup and cache

`mobile/app/_layout.tsx` holds the splash until SecureStore auth restoration
and Query cache hydration finish. `mobile/src/lib/queryClient.ts` then keeps
two server-state classes on explicit freshness budgets:

| class | stale time | used for |
|---|---:|---|
| `balance` | 15s | Gecko account snapshot |
| `activity` | 60s | account activity |

The persisted cache is versioned with `gecko-v0`, but V0 persists only the
non-user `health` query. Financial snapshot/activity data stays memory-only
until Gecko has a per-install encrypted cache. Changing the signed-in JWT also
clears in-memory and persisted data before the next account can read it.

## Network behavior

`mobile/src/lib/api.ts` provides request deduplication, hard timeouts,
AbortController cancellation, retryable-error backoff with jitter, and ETag
support. The in-flight key includes a non-secret auth revision so a request
started for one account cannot be joined after the session changes.

GETs may retry retryable transport failures. Writes default to zero retries.
Gecko V0 has one POST, `/v1/mobile/ask`, and that endpoint is read-only: it can
explain account analytics but cannot quote, sign, or broadcast a transaction.

## Foreground and navigation work

`installAppStateBridges()` connects TanStack Query to React Native `AppState`
and NetInfo, so reconnect/focus refreshes happen at useful times rather than
burning retries while the app is backgrounded. `mobile/src/hooks/use-prefetch.ts`
warms the snapshot and activity queries after interactions.

Activity uses FlashList with a fixed estimated row height. Today, Ask, and
Money use ScrollView because their V0 content is short and bounded enough that
virtualization would add complexity without a measurable win.

## Secrets and user data

The native client accepts only an end-user session JWT. It is stored with
`expo-secure-store`; no agent key, wallet private key, Telegram initData, or
synthetic development identity belongs in the bundle. Account changes clear
the Query cache and HTTP ETag cache to prevent cross-user reuse.

Production native sign-in is intentionally a separate security milestone. A
preview with no stored JWT renders a disconnected state rather than inventing
account data or embedding a privileged credential.

## Review budgets

Use `mobile/src/lib/perf.ts` to keep regressions observable. Review against
these client-side budgets:

| Metric | Budget |
|---|---:|
| Cold start to first renderable state | < 1.5s |
| Warm start to first renderable state | < 400ms |
| Prefetched tab switch | < 100ms |
| Scrolling activity | 60fps without blank rows |

Upstream balance RPC latency is measured separately from client rendering; do
not hide an unavailable provider behind fabricated balances or history.
