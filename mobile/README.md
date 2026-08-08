# Gecko (Suwappu Mobile)

Gecko is the working codename for Suwappu's native iOS/Android experience. The V0 surface is intentionally simple: **Today · Ask · Money · Activity**. It exposes account analytics and a read-only assistant without exposing or embedding money-movement primitives in the native client.

The app uses Expo SDK 52, Expo Router, React Native 0.76, TanStack Query, and the shared Suwappu design tokens. User-scoped requests use an existing session JWT stored in `expo-secure-store`. There is deliberately no synthetic dev user or native authentication shortcut; without a stored session the UI renders an honest disconnected state.

## Setup

```bash
cd mobile
bun install
bun run ios          # or: bun run android
bun run check        # TypeScript
```

Point at a development API with `EXPO_PUBLIC_API_URL=https://devapi.suwappu.bot bun run ios`. Never put privileged credentials in an `EXPO_PUBLIC_*` variable.

Native `ios/` and `android/` directories are generated. Run `bun run prebuild` rather than committing them.

## V0 API contract

- `GET /v1/mobile/snapshot` — priced holdings and history with an explicit coverage flag. V0 reports `best_effort` and never turns that into a gain/loss claim.
- `POST /v1/mobile/ask` with `{ "text": "…" }` — explanations only; this client provides no execution primitive.
- `GET /webapp/swaps` — JWT-scoped activity history, displayed without infrastructure details.

Networking is centralized in `src/lib/endpoints.ts`; SecureStore JWT handling is in `src/lib/auth.ts`; server-state hooks are in `src/hooks/use-gecko.ts`.

## Production sign-in milestone

Fresh installs intentionally stop at the disconnected state until native sign-in is wired. Do not revive the repository's incomplete passkey flow or put an agent key in the bundle.

The preferred handoff is Telegram's current OIDC Authorization Code flow with PKCE: open the system browser, return through a registered callback, exchange the code server-side using the BotFather-issued client secret, validate the ID token, then mint Suwappu's existing end-user JWT + rotating refresh token. Telegram documents the native/OIDC flow at <https://core.telegram.org/widgets/login>.
