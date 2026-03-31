# Suwappu Trading Terminal

Standalone browser-based DEX trading terminal at `terminal.suwappu.bot`. Built for feature parity with Hyperliquid and Axiom terminals.

## Quick Start

```bash
cd terminal
bun install
bun run dev          # Vite dev server at http://localhost:5173
bun vite build       # Production build
bunx playwright test # Run all 74 E2E tests
```

**Critical**: Always use `bun`, never `npm` or `tsc` (tsc hangs in this project).

## Stack

| Tech | Purpose |
|------|---------|
| React 18 + Vite 6 | UI framework + bundler |
| TailwindCSS | Styling (dark terminal theme) |
| React Query | Server state + caching |
| allotment | Resizable split-pane layout |
| TradingView Lightweight Charts | Candlestick charts |
| RainbowKit + wagmi | Wallet connect auth |
| Playwright | E2E testing (74 tests) |

**Note**: Vite 6 required. Vite 7 is incompatible with Node 25.

## Architecture

```
terminal/
  src/
    App.tsx                     # Router: / = TradingLayout, /points = PointsDashboard
    main.tsx                    # Providers: Wagmi > ReactQuery > RainbowKit > Auth > BottomTab > Hotkeys
    contexts/
      AuthContext.tsx            # Wallet connect + JWT auth
      BottomTabContext.tsx       # Bottom panel tab state (8 tabs)
      HotkeysContext.tsx         # Global keyboard shortcuts
    components/
      layout/
        TradingLayout.tsx       # Main layout: Chart|OrderBook|Swap (top) + 8 tabbed panels (bottom)
        Header.tsx              # Logo + ChainSelector + PairSelector + wallet connect
        ChainSelector.tsx       # Multi-chain dropdown (ETH, ARB, BSC, BASE, etc.)
        PairSelector.tsx        # Ctrl+K token pair search
      chart/
        PriceChart.tsx          # TradingView Lightweight Charts wrapper
        ChartToolbar.tsx        # Time intervals (1m/5m/15m/1h/4h/1D)
      orderbook/
        OrderBookPanel.tsx      # L2 bid/ask ladder with depth bars, spread display
        RecentTradesPanel.tsx   # Live trade feed with flash animations
      trade/
        SwapPanel.tsx           # Main trade panel with OrderTabs (Swap|Limit|DCA)
        LimitOrderPanel.tsx     # Price target + expiry
        DCAPanel.tsx            # Dollar-cost averaging scheduler
      discover/
        DiscoveryPanel.tsx      # 3 tabs: Pulse | New Pairs | Trending
        PulseTab.tsx            # Axiom-style pulse feed with insider metrics
        PulseTokenRow.tsx       # Data-dense row with age, mcap, holders, insider %
        PulseFilters.tsx        # Market cap, liquidity, holder filters
        InsiderMetrics.tsx      # Top10%, Dev%, Sniper% mini bars
        NewPairsTable.tsx       # GeckoTerminal new pairs feed
        TrendingTable.tsx       # GeckoTerminal trending tokens
      portfolio/
        PortfolioPanel.tsx      # Holdings | History tabs
        HoldingsTable.tsx       # Multi-chain token balances
        TradeHistory.tsx        # Past swaps with status
      watchlist/
        WatchlistPanel.tsx      # Token watchlist with add/remove, localStorage
        WatchlistItem.tsx       # Compact row with chain badge
      copy/
        CopyTradingDashboard.tsx # Leaderboard | Following | Feed tabs
        TraderLeaderboard.tsx   # Top traders by PnL/win rate
      tracker/
        WalletTrackerPanel.tsx  # Track wallets, activity feed, profile cards
        AddWalletForm.tsx       # EVM + SOL address validation
        WalletActivityFeed.tsx  # Buy/sell activity table
        WalletProfileCard.tsx   # Wallet stats + holdings
      tweets/
        TweetMonitorPanel.tsx   # Follow crypto accounts, sentiment filter
        TweetCard.tsx           # Tweet with inline $TOKEN mentions
        AddAccountModal.tsx     # Add/remove tracked accounts
      copilot/
        CopilotPanel.tsx        # AI chat assistant
      alerts/
        AlertsPanel.tsx         # Price/volume/whale alerts
      dca/
        DCAManager.tsx          # DCA order management
      lending/
        LendingPanel.tsx        # DeFi lending markets
      perps/
        PerpsPanel.tsx          # HyperLiquid perpetuals (stub)
      predict/
        PredictionPanel.tsx     # Polymarket predictions (stub)
      points/
        PointsDashboard.tsx     # XP, milestones, rewards, leaderboard
      hotkeys/
        HotkeysHelpOverlay.tsx  # ? key overlay showing all shortcuts
    hooks/
      useChartData.ts           # OHLCV data with mock generator
      useOrderBook.ts           # Mock L2 order book, 15 levels
      useRecentTrades.ts        # Mock trade feed
      useSwapQuote.ts           # Multi-provider quote aggregation
      useSwapExecute.ts         # Swap execution
      usePortfolio.ts           # Multi-chain holdings
      useDiscovery.ts           # GeckoTerminal API integration
      usePulse.ts               # Pulse feed with 3 stages + filters
      useWatchlist.ts           # localStorage-backed watchlist
      useWalletTracker.ts       # Tracked wallets + mock activity
      useTweetMonitor.ts        # Mock tweet generation + sentiment
      useCopyTrading.ts         # Trader leaderboard data
      useAlerts.ts, useDCA.ts, useLending.ts, usePoints.ts, useCopilot.ts
      useLayoutSizes.ts         # Persisted panel sizes
      useSelectedPair.ts        # Current trading pair state
      useTokens.ts              # Token search/selection
    lib/
      api.ts                    # API client (JWT auth, no Telegram)
      auth.ts                   # SIWE-style challenge/verify
      wagmi.ts                  # RainbowKit + wagmi config
      copilot.ts                # AI copilot API
    types/
      api.ts                    # All TypeScript interfaces
  tests/                        # 74 Playwright E2E tests
  Dockerfile                    # Multi-stage: bun build -> nginx serve
  nginx.conf                    # SPA routing, gzip, security headers
```

## Layout Structure

```
+----------------------------------------------------------+
| Header: Logo | Chain Selector | Pair Search | Wallet     |
+--------------------+-----------+-------------------------+
|                    | Order Book| Swap Panel              |
|   Price Chart      | (bids/    | [Swap | Limit | DCA]   |
|   (TradingView)    |  asks)    | Token inputs            |
|                    +-----------+ Quote comparison         |
|                    | Recent    | Slippage control         |
|                    | Trades    |                         |
+--------------------+-----------+-------------------------+
| [Portfolio|Discovery|Watchlist|Copy|Tracker|Tweets|DeFi|AI] |
| (Active bottom panel content)                            |
+----------------------------------------------------------+
```

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `?` | Toggle hotkeys help overlay |
| `P` | Switch to Portfolio tab |
| `D` | Switch to Discovery tab |
| `T` | Switch to Tweets tab |
| `W` | Switch to Wallet Tracker tab |
| `B` | Focus buy/swap input |
| `S` | Focus sell input |
| `1-6` | Chart intervals (1m/5m/15m/1h/4h/1D) |
| `Ctrl+K` | Open pair search |
| `Escape` | Close modal/overlay |

## API Integration

The terminal uses the same API as the webapp (`api-ts/`):
- **Auth**: `flexAuth` middleware supports `Authorization: Bearer <jwt>` — no changes needed
- **CORS**: `terminal.suwappu.bot` already in `ALLOWED_ORIGINS` default (see `api-ts/src/config/EnvService.ts`)
- **Endpoints**: All existing `/webapp/*` and `/v1/agent/*` routes work with JWT auth
- **Dev mode**: `X-Dev-User-Id: '12345'` header on localhost

## Deployment

### Infrastructure (needs one-time setup)

The terminal deploys as Docker (Nginx) on ECS Fargate, same pattern as webapp.

**Prerequisites** (add to CDK stack or create manually):
1. ECR repository: `suwappu-terminal`
2. ECS service: `suwappu-terminal-prod` (and `-dev`)
3. ALB listener rule: Host `terminal.suwappu.bot` -> terminal target group
4. DNS: CNAME `terminal.suwappu.bot` -> ALB DNS name

```bash
# Manual ECR repo creation (if not using CDK)
aws ecr create-repository --repository-name suwappu-terminal --region us-east-1

# DNS (Gandi): Add CNAME record
# terminal.suwappu.bot -> (ALB DNS from CDK outputs)
```

### CI/CD

`.github/workflows/deploy-terminal.yml` — auto-deploys on push to `main`/`dev` when `terminal/` files change.

### Manual Deploy

```bash
# Build and push Docker image
cd /path/to/monorepo
docker build -f terminal/Dockerfile --build-arg VITE_API_URL=https://api.suwappu.bot -t 905418423235.dkr.ecr.us-east-1.amazonaws.com/suwappu-terminal:latest .
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 905418423235.dkr.ecr.us-east-1.amazonaws.com
docker push 905418423235.dkr.ecr.us-east-1.amazonaws.com/suwappu-terminal:latest

# Update ECS service
aws ecs update-service --cluster suwappu-cluster --service suwappu-terminal-prod --force-new-deployment
```

## Testing

```bash
cd terminal
bunx playwright test --reporter=list     # All 74 tests
bunx playwright test tests/terminal.spec.ts  # Specific file
bunx playwright test --ui                # Interactive UI mode
```

All tests use mock data generators (no real API calls needed). Test files match component directories.

## Mock Data

All hooks generate realistic mock data for development:
- `useOrderBook.ts` — 15-level bid/ask ladder, 500ms updates
- `useRecentTrades.ts` — Trade feed every 1-3s
- `usePulse.ts` — Token discovery feed, 5s refresh
- `useTweetMonitor.ts` — Tweet generation every 10-20s
- `useWalletTracker.ts` — Wallet activity every 5-10s
- `useCopyTrading.ts` — Trader leaderboard with mock PnL

## Future Roadmap

### High Priority (Hyperliquid/Axiom Parity)
- [ ] **TP/SL on positions** — Take profit/stop loss for perps
- [ ] **TWAP/Scale orders** — Time-weighted average price orders
- [ ] **MEV Protection toggle** — Flashbots/MEV blocker integration
- [ ] **Funding rates display** — Real-time funding for perps
- [ ] **Cross/Isolated margin toggle** — Margin mode for perps
- [ ] **Real WebSocket price streams** — Replace polling with WS (`/terminal/ws`)
- [ ] **Real OHLCV data** — GeckoTerminal API integration (currently mocked)

### Medium Priority
- [ ] **Multi-wallet/Subaccounts** — Switch between connected wallets
- [ ] **Real wallet auth flow** — SIWE challenge/verify (API routes exist, needs frontend flow)
- [ ] **Portfolio PnL chart** — Historical portfolio value
- [ ] **Advanced chart indicators** — MA, RSI, MACD overlays
- [ ] **Copy trading execution** — Actually follow/copy traders (mock only now)
- [ ] **Alert notifications** — Browser push + sound alerts

### Low Priority
- [ ] **Polymarket trading** — CLOB integration for prediction markets
- [ ] **Mobile responsive** — Terminal layout for smaller screens
- [ ] **Custom themes** — User-selectable color schemes
- [ ] **API key management** — For programmatic access
- [ ] **Export trade history** — CSV/Excel export

## CDK Infrastructure Addition

Add to `infra/lib/suwappu-stack.ts` (after the webapp ECS service section):

```typescript
// ==================== Terminal ECS Service ====================
const terminalRepo = new ecr.Repository(this, 'TerminalRepository', {
  repositoryName: 'suwappu-terminal',
  imageScanOnPush: true,
  lifecycleRules: [{ maxImageCount: 10, description: 'Keep last 10 images' }],
});

const terminalTaskDef = new ecs.FargateTaskDefinition(this, 'TerminalTaskDef', {
  memoryLimitMiB: 512,
  cpu: 256,
});

terminalTaskDef.addContainer('terminal', {
  image: ecs.ContainerImage.fromEcrRepository(terminalRepo, 'latest'),
  portMappings: [{ containerPort: 80 }],
  logging: ecs.LogDrivers.awsLogs({
    streamPrefix: 'terminal',
    logRetention: logs.RetentionDays.TWO_WEEKS,
  }),
  healthCheck: {
    command: ['CMD-SHELL', 'wget --no-verbose --tries=1 --spider http://localhost/health || exit 1'],
    interval: cdk.Duration.seconds(30),
    timeout: cdk.Duration.seconds(5),
    retries: 3,
  },
});

const terminalService = new ecs.FargateService(this, 'TerminalService', {
  cluster: this.cluster,
  taskDefinition: terminalTaskDef,
  desiredCount: 1,
  assignPublicIp: false,
  deploymentController: { type: ecs.DeploymentControllerType.ECS },
  circuitBreaker: { rollback: true },
  serviceName: 'suwappu-terminal-prod',
});

// Add to ALB HTTPS listener
httpsListener.addTargets('TerminalTarget', {
  port: 80,
  targets: [terminalService],
  priority: 25,
  conditions: [elbv2.ListenerCondition.hostHeaders(['terminal.suwappu.bot'])],
  healthCheck: {
    path: '/health',
    healthyThresholdCount: 2,
    interval: cdk.Duration.seconds(30),
  },
});
```

## Gotchas

- **Vite 6 only**: Vite 7 breaks with Node 25. Pin `"vite": "^6.0.0"` in package.json.
- **bun, never npm/tsc**: `tsc` hangs indefinitely. `bun vite build` for builds, `bunx playwright test` for tests.
- **Mock data everywhere**: All hooks return mock data. Real API integration needs the hooks updated to call `api.ts` endpoints.
- **No real auth yet**: AuthContext has wallet connect UI but the SIWE challenge/verify flow is stubbed. API's `flexAuth` middleware is ready.
- **Playwright strict mode**: Always use specific selectors (`getByTestId`, `getByRole`, `.first()`) — never bare `getByText` that could match multiple elements.
- **HUSKY=0**: Use `HUSKY=0` prefix for git operations in worktrees to avoid hook hangs.
