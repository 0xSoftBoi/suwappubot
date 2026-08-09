# Gecko (Suwappu Mobile)

Gecko is the working codename for Suwappu's native iOS/Android experience. The V0 surface is intentionally simple: **Today · Ask · Money · Activity**. It exposes account analytics and a read-only assistant without exposing or embedding money-movement primitives in the native client.

The app uses Expo SDK 57, Expo Router, React Native 0.86, TanStack Query, and the shared Suwappu design tokens. User-scoped requests use an existing session JWT stored in `expo-secure-store`. There is deliberately no synthetic dev user or native authentication shortcut; without a stored session the UI renders an honest disconnected state.

## Setup

```bash
cd mobile
bun install
bun run ios          # or: bun run android
bun run check        # TypeScript
```

Point at a development API with `EXPO_PUBLIC_API_URL=https://devapi.suwappu.bot bun run ios`. Never put privileged credentials in an `EXPO_PUBLIC_*` variable.

Native `ios/` and `android/` directories are generated. Run `bun run prebuild` rather than committing them.

For App Store builds, `eas.json` pins the Expo SDK 57 iOS image line so EAS uses Xcode 26. Apple has required App Store Connect uploads to use Xcode 26+ and the iOS 26 SDK since April 28, 2026; see <https://developer.apple.com/news/upcoming-requirements/>. The app declares no tracking, aggregates dependency privacy manifests, suppresses an unused Face ID permission, and links Privacy, Terms, and Support from the native UI.

## V0 API contract

- `GET /v1/mobile/snapshot` — priced holdings and history with an explicit coverage flag. V0 reports `best_effort` and never turns that into a gain/loss claim.
- `POST /v1/mobile/ask` with `{ "text": "…" }` — explanations only; this client provides no execution primitive.
- `GET /webapp/swaps` — JWT-scoped activity history, displayed without infrastructure details.

Networking is centralized in `src/lib/endpoints.ts`; SecureStore JWT handling is in `src/lib/auth.ts`; server-state hooks are in `src/hooks/use-gecko.ts`.

## Production sign-in milestone

Fresh installs intentionally stop at the disconnected state until native sign-in is wired. Do not revive the repository's incomplete passkey flow or put an agent key in the bundle.

If Telegram OIDC is used for primary-account sign-in, App Review guideline 4.8 also requires an equivalent privacy-preserving login option unless an enumerated exception applies. Plan the account model and Sign in with Apple path together rather than shipping Telegram-only auth. Any flow that creates accounts also needs in-app account deletion before App Store submission.

Fresh installs are therefore **not App Review-ready yet**. Native authentication, reviewer-accessible test credentials/demo mode, account deletion where applicable, App Store privacy labels, and regulated-financial-services/legal-entity review remain release gates. The read-only Gecko V0 does not expose a native crypto execution path.
