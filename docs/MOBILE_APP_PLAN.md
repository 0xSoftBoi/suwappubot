# Suwappu Mobile App — Comprehensive Development Plan

**Date:** 2026-03-06
**Status:** ~40% complete → roadmap to 100%

---

## Current State Assessment

### What's Built (Scaffolding + Functional)
| Area | Status | Notes |
|------|--------|-------|
| Expo Router structure | Done | File-based routing, 5 tabs, auth flow, features stack |
| Tab navigation | Done | Home, Swap, Portfolio, Discover, More |
| Auth context | Done | Passkey registration/login, OAuth (Google/Twitter), JWT persistence |
| Push notifications wiring | Done | Deep link mapping per category, notification categories |
| Home dashboard | Done | Portfolio value, quick actions, recent swaps |
| Swap screen | Done | Token selection, quote fetching, execution, confirm sheet |
| Portfolio screen | Done | Token list, chain filter, allocation bar, swap history |
| Discover tab | Done | Trending tokens, earn feature cards |
| More tab | Done | Menu grid to all features, user card, logout |
| Feature screens (scaffolded) | Done | Alerts, Orders, DCA, Sniping, Copy Trading, Points, Referrals, Settings |
| UI component library | Partial | EmptyState, StatusBadge, ConfirmSheet, TokenAmountInput, etc. |
| Theme system | Done | Dark theme with Suwappu colors, spacing/radius tokens |
| Zustand store | Done | UI state (selectedTraderId, pendingDeepLink, globalLoading) |
| React Query setup | Done | 30s stale time, 5m GC, 2 retries |
| Error boundary | Done | AppErrorBoundary with retry |
| Hooks (data fetching) | Scaffolded | useAlerts, useCopyTrading, useDCA, useOrders, usePoints, useReferrals, useSniping, useTokenDiscovery, useTokenPrice, useWallets |

### What's MISSING (Critical Gaps)
| Area | Status | Impact |
|------|--------|--------|
| **`lib/api.ts`** | MISSING | Every screen imports this — app literally cannot run without it |
| **`lib/auth.ts`** | MISSING | Token persistence (SecureStore), wallet address extraction |
| **`lib/authEvents.ts`** | MISSING | 401 unauthorized event bus |
| **`lib/passkey.ts`** | MISSING | Passkey creation/authentication wrappers |
| **`lib/notifications.ts`** | MISSING | Push notification registration, categories, unregister |
| Send/Receive flow | MISSING | No send or receive screens (webapp has them) |
| Token search | Partial | TokenSearchBar component exists but no full search screen |
| Swap history (dedicated) | MISSING | Portfolio shows recent, but no full history page |
| Token logos/icons | MISSING | All tokens show as text symbols only |
| Price charts | Partial | PriceChart component exists, unknown if functional |
| Onboarding flow | Basic | Just welcome → create/login. No walkthrough or tutorial |
| Haptic feedback | MISSING | expo-haptics is installed but never used |
| Animations | MISSING | reanimated installed but minimal usage |
| Offline support | MISSING | No caching strategy, error states only |
| WalletConnect/External wallets | MISSING | No WC integration for connecting external wallets |
| Biometric lock | MISSING | No app-level lock screen (separate from passkey auth) |
| Tests | MISSING | Zero test files |
| Premium/subscription | MISSING | Webapp has it, mobile doesn't |

---

## Competitive Landscape

### Top Competitor Analysis

**Phantom** — Market leader, 10M+ users
- Instant portfolio view with token logos and 24h change
- Built-in swap with Jupiter (Solana) + LI.FI (EVM)
- NFT gallery with floor price
- Burn spam tokens feature
- In-app browser (dApp browser)
- Staking directly from wallet
- Multi-chain but Solana-first UX

**Trust Wallet** — 100M+ downloads
- 100+ chains supported
- Built-in dApp browser
- Staking for 20+ assets
- Custom token import
- WalletConnect v2 deep integration
- In-app purchase of crypto (fiat on-ramp)

**Uniswap Mobile**
- Best-in-class swap UX (clean, minimal)
- NFT marketplace integrated
- Activity feed with rich tx details
- Fiat on-ramp (Moonpay)
- Push notifications for price alerts
- QR code wallet connect

**Rainbow Wallet** — Design-first
- Beautiful token detail pages with sparkline charts
- Points/rewards system
- ENS integration
- Gas-optimized swaps
- "Discover" tab with trending tokens
- Smooth animations (reanimated)

**Zerion** — Portfolio tracking king
- Cross-chain portfolio with PnL tracking
- "Positions" view (DeFi positions, LP, staking)
- Transaction history with human-readable descriptions
- Wallet scoring / health metrics
- Gas tracker widget

**Banana Gun / Maestro / BONKbot** — Trading bots gone mobile
- Ultra-fast snipe execution
- Auto-buy on liquidity events
- Copy trading leaderboards
- Revenue sharing / token-based rewards
- Simple, utilitarian UX (speed > beauty)

**OKX Wallet**
- 100+ chains
- DEX aggregator across all chains
- Cross-chain bridge built-in
- DeFi discovery + yield opportunities
- Ordinals/inscriptions support

### Key Trends in 2025-2026
1. **AI-powered trading** — natural language commands, AI agents for execution
2. **Account abstraction** — gasless transactions, session keys, social recovery
3. **Cross-chain by default** — users shouldn't think about chains
4. **Fiat on/off ramps** — seamless USD ↔ crypto
5. **Social features** — copy trading, leaderboards, on-chain reputation
6. **Push notifications** — price alerts, order fills, smart notifications
7. **Speed** — sub-second quotes, instant execution
8. **Security theatre → real security** — biometric, hardware-backed keys (Turnkey TEE is an advantage)

---

## Development Plan — Phases

### Phase 1: Foundation (Make It Run) — Priority: CRITICAL

The app cannot launch without these core lib files. Everything else depends on them.

#### 1.1 `lib/api.ts` — API Client
```
- HTTP client wrapping fetch() with JWT auth headers
- Base URL from EXPO_PUBLIC_API_URL env var
- Methods matching all hook imports:
  - getPortfolio(), getSwaps(limit, offset)
  - getChains(), getTokens(chain)
  - getSwapQuote(params), executeSwap(params), getSwapStatus(id)
  - getMe(), updatePreferences(prefs)
  - getAlerts(), createAlert(), deleteAlert(), toggleAlert()
  - getOrders(), createOrder(), cancelOrder()
  - getDCAOrders(), createDCA(), pauseDCA(), cancelDCA()
  - getSnipeOrders(), createSnipe()
  - getCopyTraders(), followTrader(), unfollowTrader()
  - getPointsStats(), checkin(), getLeaderboard(), getPointsHistory()
  - getReferralCode(), getReferralStats()
  - getWallets(), linkWallet()
  - searchTokens(query, chains), getTokenPrices(symbols)
  - getTrendingTokens(chain, limit)
  - Passkey: passkeyRegisterInit(), passkeyRegisterComplete(), passkeyAuthenticateInit(), passkeyAuthenticateComplete()
  - logout()
- 401 interceptor that fires authEvents.emit('unauthorized')
- Request/response typing from @suwappu/shared
```

#### 1.2 `lib/auth.ts` — Token Storage
```
- saveAuthToken(token, expiresAt, method, walletAddress?) → expo-secure-store
- loadAuthToken() → string | null
- clearAuthToken()
- getAuthToken() → string | null (sync from memory cache)
- getWalletAddress() → string | null
- isTokenExpiringSoon() → boolean (< 1 hour remaining)
```

#### 1.3 `lib/authEvents.ts` — Event Emitter
```
- Simple typed EventEmitter for 'unauthorized' events
- Used by api.ts to signal AuthContext
```

#### 1.4 `lib/passkey.ts` — Passkey Wrappers
```
- createPasskey(options) → wraps react-native-passkeys create
- getPasskeyCredential(options) → wraps react-native-passkeys get
- Handle platform differences (iOS Keychain attestation)
```

#### 1.5 `lib/notifications.ts` — Push Notifications
```
- registerForPushNotifications() → get Expo push token, send to backend
- setupNotificationCategories() → alert_triggered, order_filled, swap_completed, copy_trade, dca_executed
- unregisterPushNotifications() → remove token from backend
```

**Deliverable:** App boots, authenticates, and loads portfolio data.

---

### Phase 2: Core Trading Experience — Priority: HIGH

#### 2.1 Token Selector Bottom Sheet
- Searchable token list with logos (from CoinGecko/backend)
- Recent tokens section
- Chain badge on each token
- Balance display for owned tokens
- Used by Swap, Orders, DCA, Alerts create screens

#### 2.2 Chain Selector
- Visual chain picker (icons + names)
- Used across swap, portfolio filter, token search
- "Auto" option for cross-chain routing

#### 2.3 Swap UX Polish
- Swap direction toggle (actually swap fromToken/toToken)
- Preset amount buttons (25%, 50%, 75%, MAX)
- USD value display below amounts
- Slippage settings in swap screen (not just settings)
- Swap status polling after execution
- Haptic feedback on confirm and success
- Skeleton loading states

#### 2.4 Send Flow
- New screen: `(features)/wallet/send.tsx`
- Address input with clipboard paste + QR scan
- Token selector + amount input
- Fee estimation
- Confirm sheet with all details
- Transaction status tracking

#### 2.5 Receive Flow
- New screen: `(features)/wallet/receive.tsx`
- QR code with wallet address
- Chain selector (show address per chain)
- Copy address button with haptic feedback
- Share via system share sheet

#### 2.6 Swap History (Full)
- New screen or section in portfolio
- Filter by status (completed, pending, failed)
- Search by token
- Tap to see full tx details
- Block explorer deep links

---

### Phase 3: Token Discovery & Research — Priority: HIGH

#### 3.1 Token Detail Page Enhancement
- Price chart (candlestick or line, multiple timeframes)
- Token metadata (market cap, volume, supply, chain)
- Holdings section (your balance + value)
- Quick swap button ("Buy" / "Sell")
- Price alerts shortcut
- Related tokens
- Contract address with copy + explorer link

#### 3.2 Discovery Page Enhancement
- Trending tokens (real-time from backend/CoinGecko)
- New listings (recently launched)
- Top gainers/losers
- Search with autocomplete
- Chain filter
- Category tags (DeFi, Meme, L2, Stablecoin, etc.)

#### 3.3 Watchlist
- Add/remove tokens from watchlist
- Dedicated watchlist view or section on Home
- Push notification option per watched token
- Persist in backend (synced with bot)

---

### Phase 4: Advanced Trading Features — Priority: MEDIUM

#### 4.1 Price Alerts (Complete)
- Wire up to real backend API
- Create alert with token selector + condition + target
- Active alerts list with enable/disable toggle
- Triggered alerts history
- Push notification delivery

#### 4.2 Limit Orders (Complete)
- Wire up to real backend API
- Create: limit buy, limit sell, stop loss, take profit
- Active orders with cancel button
- Filled orders history
- Price proximity indicators

#### 4.3 DCA (Complete)
- Wire up to real backend API
- Create DCA: token, amount, frequency (hourly/daily/weekly)
- Active DCA list with pause/resume/cancel
- Execution history per DCA
- Total invested vs current value

#### 4.4 Token Sniping (Complete)
- Wire up to real backend API
- Create snipe order: token, mode (instant/conditional/first_block)
- Auto-snipe rules
- Active snipes with status
- Snipe history with P&L

#### 4.5 Copy Trading (Complete)
- Trader leaderboard with real data
- Trader profile page with performance history
- Follow config: copy mode, max amount, daily limit, stop loss
- Active follows with P&L tracking
- Copy trade execution log

---

### Phase 5: Engagement & Growth Features — Priority: MEDIUM

#### 5.1 Points & Gamification (Complete)
- Points stats with level visualization
- Daily check-in with streak tracking
- Milestone cards with progress bars
- Rewards redemption
- Leaderboard (global + friends)
- XP level tiers (Bronze → Diamond) with fee discount display

#### 5.2 Referrals (Complete)
- Referral code generation + sharing
- Stats dashboard (referrals, volume, commissions)
- Referred users list
- Share via system share sheet

#### 5.3 Premium/Subscription
- Tier display (Free, Pro, Whale)
- Feature comparison
- In-App Purchase integration (StoreKit 2 via expo-in-app-purchases)
- Upgrade flow
- Feature gating based on plan

---

### Phase 6: UX Polish & Native Feel — Priority: HIGH (parallel with Phase 2-5)

#### 6.1 Animations & Transitions
- Page transitions with shared element transitions (expo-router)
- List item animations (FlatList/FlashList enter/exit)
- Swap card flip animation
- Pull-to-refresh with custom animation
- Tab bar animations
- Loading skeleton shimmer effects
- Success confetti / particle effect on swap complete

#### 6.2 Haptic Feedback
- Button press haptics (light)
- Swap confirm (medium)
- Swap success (heavy/success)
- Error states (error pattern)
- Tab switch (selection)
- Pull-to-refresh trigger

#### 6.3 Token Logos & Asset Display
- Token logo fetching from CoinGecko/TrustWallet assets
- Fallback to generated avatar (first letter + color from address hash)
- Chain badge overlay on token icons
- Image caching strategy

#### 6.4 Empty States
- Custom illustrations per feature
- Clear CTAs ("Create your first alert", "Make your first swap")
- Contextual tips

#### 6.5 Loading States
- Skeleton screens (not spinners) for all data-loading screens
- Optimistic UI updates for mutations (alert toggle, order cancel)
- Background data refresh indicators

#### 6.6 Onboarding
- 3-screen walkthrough (Swap across chains → Earn rewards → Trade like a pro)
- Skip option
- Only show on first launch
- Deep link into specific features post-onboarding

---

### Phase 7: Security & Reliability — Priority: HIGH

#### 7.1 Biometric App Lock
- Optional Face ID / Touch ID lock on app foreground
- Configurable in Settings
- Grace period (don't require re-auth within 30s)
- Fallback to passcode

#### 7.2 Transaction Confirmation
- Always require biometric confirmation for:
  - Swap execution
  - Send transactions
  - Wallet linking
- Clear display of what's being signed

#### 7.3 Error Handling
- Global error boundary already exists → enhance with Sentry/Bugsnag
- Network connectivity detection (NetInfo)
- Offline mode banner
- Retry strategies per API call type
- Rate limit handling (429 backoff)

#### 7.4 Secure Storage
- JWT in expo-secure-store (hardware-backed keychain)
- Never log sensitive data
- Certificate pinning for API calls
- Jailbreak detection (optional)

---

### Phase 8: iOS-Specific Features — Priority: MEDIUM

#### 8.1 Widgets (iOS 17+)
- Portfolio value widget (small)
- Top token prices widget (medium)
- Quick swap widget (large)
- Uses Expo Widget API or native Swift extension

#### 8.2 Spotlight Search
- Index owned tokens for Spotlight search
- "Search ETH balance" → opens portfolio
- "Swap USDC" → opens swap pre-filled

#### 8.3 Live Activities
- Swap in progress → Live Activity showing status
- Large swap execution → Dynamic Island
- Order fill notification → Live Activity

#### 8.4 App Shortcuts (Siri)
- "Swap ETH to USDC"
- "Check my portfolio"
- "Show Bitcoin price"

#### 8.5 App Clips
- Lightweight swap experience shareable via link
- No download required for quick swap

---

### Phase 9: Testing & Quality — Priority: HIGH (parallel throughout)

#### 9.1 Unit Tests
- Test all hooks (useAlerts, useSwap, etc.) with mock API
- Test AuthContext flows
- Test lib/ utilities
- Use React Native Testing Library

#### 9.2 Integration Tests
- Auth flow: welcome → register → home
- Swap flow: select tokens → quote → confirm → status
- Navigation: deep links, tab switching, back navigation
- Use Detox or Maestro for E2E

#### 9.3 CI/CD
- EAS Build for dev/preview/production
- GitHub Actions: lint + type-check + test on PR
- TestFlight distribution for preview builds
- App Store submission pipeline

---

## Feature Parity: Mobile vs Webapp vs Bot

| Feature | Bot | Webapp | Mobile | Priority |
|---------|-----|--------|--------|----------|
| Auth (Passkey) | N/A | Done | Scaffolded | P0 |
| Auth (OAuth) | N/A | N/A | Scaffolded | P0 |
| Portfolio view | /b | Done | Done | - |
| Swap | /s | Done | Done | - |
| Send | N/A | Done | MISSING | P1 |
| Receive | N/A | Done | MISSING | P1 |
| Swap history | N/A | Done | Partial | P1 |
| Price alerts | /a | Done | Scaffolded | P2 |
| Limit orders | /o | Done | Scaffolded | P2 |
| DCA | N/A | Planned | Scaffolded | P2 |
| Sniping | /snipe | N/A | Scaffolded | P2 |
| Copy trading | N/A | Done | Scaffolded | P2 |
| Points/XP | /xp | Done | Scaffolded | P2 |
| Referrals | /ref | Done | Scaffolded | P3 |
| Settings | N/A | Done | Scaffolded | P2 |
| Premium | N/A | Done | MISSING | P3 |
| Token search | N/A | Done | Partial | P1 |
| Push notifications | N/A | N/A | Wired | P1 |
| Biometric lock | N/A | N/A | MISSING | P1 |
| Tests | Partial | Done | MISSING | P1 |

---

## Recommended Execution Order

```
Week 1-2:  Phase 1 (Foundation — lib/ files, app must boot)
Week 2-3:  Phase 2 (Core Trading — swap polish, send/receive)
Week 3-4:  Phase 6.1-6.5 (UX Polish — animations, haptics, skeletons)
Week 4-5:  Phase 3 (Token Discovery — charts, search, watchlist)
Week 5-6:  Phase 7 (Security — biometric lock, tx confirmation)
Week 6-8:  Phase 4 (Advanced Trading — alerts, orders, DCA, sniping, copy)
Week 8-9:  Phase 5 (Engagement — points, referrals, premium)
Week 9-10: Phase 9 (Testing — unit + E2E + CI/CD)
Week 10+:  Phase 8 (iOS-Specific — widgets, Live Activities, Siri)
```

---

## Unique Differentiators We Should Lean Into

1. **No seed phrases** — Passkey auth with Turnkey TEE is a massive UX advantage over Phantom/Trust Wallet. Market this heavily.
2. **Cross-chain by default** — 9+ chains with Li.Fi routing. Most competitors are single-chain or clunky multi-chain.
3. **Telegram + iOS synergy** — Same wallet works in Telegram bot AND iOS app. Unique in the market.
4. **Trading bot features in a wallet** — Sniping, copy trading, DCA, limit orders all in one app. Competitors split these across separate apps.
5. **AI-powered** (future) — Natural language trading commands. "Buy $50 of ETH every Monday" → auto-creates DCA.
6. **Gamification** — Points, XP, levels, leaderboards tied to real trading activity. Retains users.

---

## Tech Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Navigation | expo-router (file-based) | Already set up, works well |
| State | React Query + Zustand | Server state (RQ) + UI state (Zustand). Already configured. |
| Auth | Passkey + OAuth | Passkey for web3 native, OAuth for mainstream users |
| Wallet | Turnkey TEE | Server-side signing, no seed phrases on device |
| API | Shared TypeScript types | Same types as webapp + api-ts via @suwappu/shared |
| Lists | @shopify/flash-list | Already installed, better perf than FlatList for token lists |
| Animations | react-native-reanimated | Already installed, just need to use it |
| Charts | TBD | Options: Victory Native, react-native-wagmi-charts, or WebView + lightweight-charts |
| Secure storage | expo-secure-store | Hardware-backed keychain on iOS |
| Push | expo-notifications | Already installed and wired |
