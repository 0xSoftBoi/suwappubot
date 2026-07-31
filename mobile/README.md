# Suwappu Mobile

Native iOS/Android client for [suwappu.bot](https://www.suwappu.bot). Expo SDK 52,
Expo Router, React Native 0.76 with the New Architecture enabled.

Talks to the same **api-ts** service as the webapp (`https://api.suwappu.bot`),
using the same auth headers (`X-Telegram-Init-Data` / `Authorization: Bearer`).

## Setup

```bash
cd mobile
bun install
bun run ios          # or: bun run android
bun run check        # TypeScript
```

Point at the dev API with `EXPO_PUBLIC_API_URL=https://devapi.suwappu.bot bun run ios`.
Builds are configured per-profile in `eas.json`.

Native `ios/` and `android/` directories are **generated** — run
`bun run prebuild` rather than committing them.

## Layout

```
app/                    expo-router routes (file = route)
  _layout.tsx           boot sequence: splash hold, auth restore, cache rehydrate
  (tabs)/               Portfolio · Swap · Activity
src/
  lib/
    api.ts              fetch client: dedupe, timeouts, backoff, ETags
    endpoints.ts        typed api-ts wrappers + per-endpoint policy
    queryClient.ts      TanStack Query config, persistence, app-state bridges
    queryKeys.ts        centralised keys (precise invalidation)
    storage.ts          MMKV stores + Query persister adapter
    auth.ts             Keychain-backed token storage
    perf.ts             timing marks, p50/p95, time-to-interactive
    config.ts           API base URL, timeout budgets
  hooks/                data hooks + prefetching
  components/           FlashList-based lists, memoised rows
  theme/                @suwappu/design-tokens → RN StyleSheet
  types/                api-ts response shapes
```

## Performance

The infrastructure choices — MMKV over AsyncStorage, persisted query cache,
request dedupe, FlashList, `expo-image`, `inlineRequires`, prefetching — and the
budgets they're held to are documented in
[`docs/mobile/performance.md`](../docs/mobile/performance.md). Read it before
adding a dependency or a new list screen.

## Conventions

- `StyleSheet.create` at module scope. No inline style objects in render.
- List rows are `memo`'d with explicit comparators; the API returns fresh object
  identities on every poll, so shallow compare never hits.
- Pick a `staleTime` from `STALE` in `queryClient.ts` — never leave it default.
- Writes get `retries: 0`. Replaying a swap execution charges the user twice.
- Add new query keys to `queryKeys.ts` so invalidation stays targeted.
