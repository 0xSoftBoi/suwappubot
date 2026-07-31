# Mobile performance infrastructure

The baseline layers the Suwappu iOS/Android app is built on, why each one is
there, and what it costs you to remove it. Everything listed here is
implemented in `mobile/` — this is a description of the code, not a wishlist.

---

## 1. Runtime: Hermes + New Architecture

`app.json` → `"jsEngine": "hermes"`, `"newArchEnabled": true`.

Hermes ships precompiled bytecode, so there is no parse-and-compile pass at
launch — the usual 300–600ms of JSC startup on a mid-range Android just isn't
spent. The New Architecture (Fabric + TurboModules) removes the async JSON
bridge: native module calls become synchronous JSI calls, and layout is
committed on the native side. In practice this is what makes gesture-driven UI
(swipe-to-dismiss, sheet drags) track the finger instead of lagging it.

`reactCompiler: true` under `experiments` auto-memoises components, which
removes most of the hand-written `useMemo`/`useCallback` that otherwise rots.

## 2. Storage: MMKV, not AsyncStorage

`src/lib/storage.ts`

AsyncStorage is promise-based SQLite over a bridge. Every read is
serialize → bridge → deserialize, so any screen that needs persisted state
waits at least a frame before it can paint. MMKV is memory-mapped and
synchronous over JSI: reads are effectively free and can happen *during*
render.

Consequence: no "loading flash", no `undefined` first pass, no
`useEffect`-then-`setState` dance for cached values.

## 3. Cache: persisted TanStack Query with per-data-class staleness

`src/lib/queryClient.ts`

Two things carry the win.

**Persisted cache.** The query cache is written to MMKV and rehydrated during
boot, so a cold start paints the user's real portfolio immediately and swaps
fresh data in underneath. Stale-then-fresh beats spinner-then-fresh every time.

**Per-data-class `staleTime`.** The common mistake is one global staleTime,
which either serves stale prices or refetches static config on every focus.
`STALE` encodes how fast each kind of data actually changes:

| class      | staleTime | applies to                     |
|------------|-----------|--------------------------------|
| `realtime` | 5s        | quotes, prices                 |
| `balance`  | 15s       | portfolio, wallet balances     |
| `activity` | 60s       | swap history, orders           |
| `config`   | 24h       | token lists, chains, fee tiers |

Quotes and swap-status are explicitly **excluded** from persistence
(`shouldDehydrateQuery`). A restored quote is a stale price, and showing a
stale price on a swap screen is a correctness bug, not a caching win.

## 4. Network layer: dedupe, timeout, backoff, ETags

`src/lib/api.ts`

Four behaviours that matter far more on a phone than in a browser tab:

- **In-flight dedupe.** Three components mounting at once and each asking for
  the portfolio produce *one* request. On LTE that is 400ms instead of 1.2s.
- **Hard timeouts via `AbortController`.** Without one, a request on a flaky
  cell connection hangs until the OS gives up (~75s on iOS) with a spinner
  pinned on screen the whole time. Budgets: 6s fast / 12s default / 30s slow.
- **Exponential backoff with full jitter**, and only on retryable failures.
  Non-idempotent writes get `retries: 0` — replaying a swap execution is how
  you charge a user twice. Without jitter, every client that failed during a
  blip retries in lockstep and re-DDoSes the API the moment it recovers.
- **ETag conditional requests** for token lists and chain config. A warm client
  pays ~200 bytes for a 304 instead of ~200KB for the full list.

Per-endpoint policy lives in `src/lib/endpoints.ts`, not at call sites.

## 5. App-state bridges: stop working when nobody's looking

`installAppStateBridges()` in `src/lib/queryClient.ts`

Out of the box, TanStack Query assumes a browser. It never learns the app was
backgrounded, so it keeps polling in the user's pocket; and it never learns the
device went offline, so it burns retries against a dead radio. Wiring
`focusManager` to `AppState` and `onlineManager` to NetInfo fixes both.

Paired with `refetchIntervalInBackground: false` on every polling hook, and a
`refetchInterval` callback on `useSwapStatus` that returns `false` once the
swap settles — an unbounded poll is a battery leak.

## 6. Lists: FlashList with a known item size

`src/components/TokenList.tsx`, `TokenRow.tsx`

FlatList keeps every rendered cell mounted (memory grows linearly with scroll
distance) and blanks cells during fast flings. FlashList recycles a fixed pool
of views, so a 500-token portfolio costs what a 20-token one does.
`estimatedItemSize` is the one input it genuinely needs — we pass the exact row
height.

Rows are `memo`'d with an explicit comparator on the fields actually rendered,
because the API returns fresh object identities on every poll and a default
shallow compare would never hit. `renderItem`/`keyExtractor` are `useCallback`'d
so FlashList's own memoisation isn't defeated.

## 7. Images: `expo-image`

Token logos are the single largest source of scroll jank in a wallet UI. RN's
built-in `Image` has a weak cache and decodes on paths that contend with JS.
`expo-image` has a two-tier memory+disk cache (`cachePolicy="memory-disk"`),
decodes off-thread, and supports `recyclingKey` so a recycled FlashList cell
doesn't flash the previous token's logo.

Transitions are set to 80ms, not the 300ms default — a logo fading in late reads
as slowness even when the data arrived instantly.

## 8. Bundle & startup

- **`inlineRequires`** (`metro.config.js`) defers module evaluation until first
  use. On a bundle this size it is the biggest single TTI win: screens the user
  hasn't opened never execute at startup.
- **Splash held until the cache is rehydrated** (`app/_layout.tsx`).
  `preventAutoHideAsync()` runs at module scope, before React mounts, so there
  is no white frame between splash and first paint. The splash hides only once
  auth is restored and the persisted cache is warm — the first screen appears
  with content, not a skeleton.
- **Native stack animations** (`expo-router` `Stack` + `react-native-screens`)
  run on the UI thread, leaving the JS thread free to render the destination
  screen mid-transition.
- **Reanimated** worklets (`babel.config.js` plugin, must stay last) keep
  gesture and animation work off the JS thread entirely.
- **ProGuard + resource shrinking** on Android release builds
  (`expo-build-properties`).

## 9. Prefetching

`src/hooks/usePrefetch.ts`

The cheapest win available: fetch the next screen's data while the user is
still on this one. By the time the ~300ms navigation animation finishes the
data is cached and the destination renders with content on its first frame. All
prefetches run inside `InteractionManager.runAfterInteractions` so they can't
compete with the animation for the JS thread.

## 10. Measurement

`src/lib/perf.ts`

Not an APM — the point is to make regressions *visible*. Every network call and
screen mount records a duration; slow ones warn in dev with their budget.
`stats()` returns p50/p95/max per operation for a debug screen or for shipping
to telemetry. `reportTimeToInteractive()` fires once the first interaction
batch drains, which is the number that actually correlates with "the app opened
fast".

Without this, "the app feels slow" is unactionable. With it you get a ranked
list.

## 11. Secrets

`src/lib/auth.ts`

The webapp keeps its JWT in `localStorage` because inside a Telegram webview it
has no better option. Native does: `expo-secure-store` maps to the iOS Keychain
and Android Keystore. Reads are cached in memory because SecureStore *is* a
real async bridge call, and we don't want one on the hot path of every request.

---

## Performance budgets

Enforce these in review; `perf.ts` gives you the numbers.

| Metric                          | Budget  |
|---------------------------------|---------|
| Cold start → first content      | < 1.5s  |
| Warm start → first content      | < 400ms |
| Tab switch (prefetched)         | < 100ms |
| Quote request p95               | < 2s    |
| Scroll                          | 60fps, no blank cells |
| JS bundle (iOS, release)        | < 3MB   |

## What is deliberately not here yet

- **No Sentry / crash reporting.** `perf.ts` exposes `stats()` and an
  `onReport` hook on `reportTimeToInteractive` — wire those to whichever
  backend you pick.
- **No image CDN resizing** for token logos. Currently served at whatever size
  the API returns.
- **No `packages/shared`.** `mobile/src/types/api.ts` is a hand-copy of
  `webapp/src/types/api.ts`. When a shared package lands, delete it and import.
- **No offline mutation queue.** Reads are offline-first
  (`networkMode: 'offlineFirst'`); writes are online-only by design, since
  queuing a swap to replay later is a money-path hazard.
