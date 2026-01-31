# Suwappu iOS App — App Store Readiness Plan

## Current State (Phase 3 Complete)

### What's Built

**Core App (Phase 1-2)**
- Expo Router tab navigator: Home, Swap, Portfolio, Discover, More
- Passkey + OAuth authentication with JWT persistence in iOS Keychain
- Cross-chain swap interface with quote fetching and execution
- Portfolio with token balances, chain filtering, swap history
- Push notifications with deep linking
- Feature screens: Alerts, Limit Orders, DCA, Copy Trading, Sniping, Points/XP, Referrals, Settings

**Phase 3 — App Store Compliance**
- SafeAreaProvider wrapping root layout
- `PrivacyInfo.xcprivacy` with required API usage reasons
- Privacy Policy + Terms of Service WebView screens linked from Settings
- `buildNumber: "1"` in app.json
- Apple App Site Association file served from API `.well-known/`
- Custom dark-themed error boundary
- 401 token expiry handling (auto-logout + redirect)

**Phase 3 — Competitive Features**
- Token detail screen with price charts (line chart, 1H/1D/1W/1M/1Y timeframes)
- Token discovery/trending screen with search (DexScreener API)
- Transaction detail screen with explorer links
- Swap confirmation sheet with price impact warnings
- Portfolio allocation bar (stacked horizontal bar by chain)

### TypeScript Status
`npx tsc --noEmit` — 0 errors

---

## What's Needed for TestFlight

### 1. Apple Developer Program ($99/year)

**Required.** No free alternative for TestFlight distribution.

- Sign up at https://developer.apple.com/programs/
- Processing takes up to 48 hours after payment

Once enrolled, collect these values:
| Value | Where to find it |
|-------|-----------------|
| **Apple Team ID** | developer.apple.com → Membership → Team ID (10-char string like `A1B2C3D4E5`) |
| **App Store Connect App ID** | appstoreconnect.apple.com → create app → General → Apple ID (numeric, like `1234567890`) |

### 2. Install & Configure EAS

```bash
# Install EAS CLI globally
npm install -g eas-cli

# Log in to Expo account (create one at expo.dev if needed — free)
eas login

# Link project (generates projectId automatically)
cd mobile
eas init
```

### 3. Fill In Placeholder Values

**`mobile/app.json`** — `extra.eas.projectId`
- `eas init` fills this automatically

**`mobile/eas.json`** — submit section
```json
"submit": {
  "production": {
    "ios": {
      "appleId": "YOUR_APPLE_ID_EMAIL",
      "ascAppId": "YOUR_APP_STORE_CONNECT_APP_ID",
      "appleTeamId": "YOUR_TEAM_ID"
    }
  }
}
```

**`api/static/.well-known/apple-app-site-association`**
- Replace `TEAM_ID` with your real Apple Team ID in the `appIDs` array

### 4. Fix Missing Assets

**Notification icon** — `assets/images/notification-icon.png` is referenced in `app.json` but doesn't exist.
- Add a 96x96 white-on-transparent PNG
- OR remove the `expo-notifications` plugin entry temporarily

**App icon** — `assets/images/icon.png` exists but verify:
- Exactly 1024x1024 pixels
- No transparency / no alpha channel (Apple rejects alpha)
- No rounded corners (iOS applies them automatically)

### 5. Ensure API & Legal URLs are Live

| URL | Purpose |
|-----|---------|
| `https://api.suwappu.xyz` | App's backend — must return data or app shows empty states |
| `https://suwappu.xyz/privacy` | Privacy Policy — Apple reviewers check this |
| `https://suwappu.xyz/terms` | Terms of Service — Apple reviewers check this |
| `https://app.suwappu.xyz/.well-known/apple-app-site-association` | Universal links (can set up later) |

### 6. App Store Connect Setup

Before submitting, create the app record in App Store Connect:
1. Go to appstoreconnect.apple.com → My Apps → "+"
2. Bundle ID: `xyz.suwappu.app`
3. Fill in app name, primary language, SKU
4. This gives you the `ascAppId` for eas.json

---

## Build & Submit Commands

```bash
cd mobile

# Build for iOS (runs on EAS cloud servers, ~15-20 min)
eas build --platform ios --profile production

# Submit to TestFlight after build completes
eas submit --platform ios --profile production

# OR build + auto-submit in one step
eas build --platform ios --profile production --auto-submit
```

After submission:
- Apple's automated processing takes 5-30 minutes
- Build appears in App Store Connect → TestFlight
- Add internal testers (up to 25, instant access)
- Add external testers (up to 10,000, requires brief Apple review)

---

## Free Testing Options (No $99 Required)

| Method | Command | Limitations |
|--------|---------|-------------|
| Expo Go on phone | `npx expo start` | No native modules (SecureStore, notifications won't work) |
| Simulator dev build | `eas build --profile development --platform ios` | Simulator only, no real device |
| Xcode free provisioning | Open in Xcode, run on your device | Your device only, re-sign every 7 days |

---

## Post-TestFlight: App Store Review Checklist

Before submitting for public App Store review, also ensure:

- [ ] Privacy Policy URL is accessible and accurate
- [ ] App doesn't crash on launch (test cold start)
- [ ] Login flow works end-to-end (passkey or OAuth)
- [ ] No placeholder/lorem ipsum text visible
- [ ] All screens handle empty states gracefully
- [ ] App works without network (shows errors, doesn't crash)
- [ ] Screenshots prepared (6.7" and 6.5" iPhone sizes minimum)
- [ ] App description and keywords written
- [ ] Support URL provided in App Store Connect
- [ ] Age rating questionnaire completed (likely 17+ due to crypto/financial)
- [ ] Export compliance: "No" to encryption beyond standard HTTPS (unless using custom crypto)
- [ ] Content rights: confirm you own all assets

---

## Architecture Reference

```
mobile/
├── app/
│   ├── _layout.tsx          # Root: SafeAreaProvider + QueryClient + Auth + Theme
│   ├── index.tsx             # Splash/redirect
│   ├── (auth)/               # Login, welcome screens
│   ├── (tabs)/
│   │   ├── index.tsx         # Home dashboard
│   │   ├── swap.tsx          # Swap with confirmation sheet
│   │   ├── portfolio.tsx     # Portfolio with allocation bar
│   │   ├── earn.tsx          # Discover tab (trending + earn features)
│   │   └── more.tsx          # More menu
│   └── (features)/
│       ├── alerts/           # Price alerts
│       ├── orders/           # Limit orders
│       ├── dca/              # DCA plans
│       ├── copy-trading/     # Copy trading
│       ├── sniping/          # Token sniping
│       ├── points/           # XP/points system
│       ├── referral/         # Referral program
│       ├── settings/         # Settings + legal links
│       ├── legal/            # Privacy policy, terms (WebView)
│       ├── token/[address]   # Token detail with price chart
│       ├── discover/         # Full discovery screen (trending/gainers/new/search)
│       └── tx/[hash]         # Transaction detail with explorer link
├── components/
│   ├── charts/               # PriceChart, PriceHeader
│   ├── discovery/            # TrendingTokenRow, TokenSearchBar
│   ├── portfolio/            # AllocationBar
│   ├── swap/                 # SwapConfirmSheet
│   └── ui/                   # AppErrorBoundary
├── contexts/AuthContext.tsx
├── hooks/                    # useTokenPrice, useTokenDiscovery
├── lib/
│   ├── api.ts                # MobileApiClient (401 interception)
│   ├── auth.ts               # JWT storage (SecureStore)
│   ├── authEvents.ts         # Event emitter for unauthorized
│   ├── theme.ts              # Colors, spacing, radius tokens
│   ├── passkey.ts            # WebAuthn helpers
│   └── notifications.ts     # Push notification setup
└── ios/
    └── PrivacyInfo.xcprivacy # Apple privacy manifest
```

### API Endpoints (backend: api/routes/mobile.py)

Phase 3 additions:
```
GET  /v1/mobile/token/{chain}/{address}/price?timeframe=1d
GET  /v1/mobile/discover/trending?chain=all&limit=50
GET  /v1/mobile/discover/gainers?timeframe=24h
GET  /v1/mobile/discover/new?chain=all
GET  /v1/mobile/discover/search?q=<query>
```

All discovery endpoints use DexScreener's public API. Token price endpoint returns synthetic OHLCV data derived from DexScreener pair data.
