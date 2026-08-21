# Suwappu Features

Suwappu is a multi-surface cross-chain execution platform. Users can trade through
Telegram and web/terminal surfaces, while applications and AI agents can integrate the
same underlying capabilities through SDK, REST, MCP, and A2A interfaces.

Feature availability is **surface-dependent**. A capability existing in the monorepo does
not mean every client exposes it, and a routing integration does not mean every chain pair
uses it. For current chain/router counts, use
[`showcase/src/data/stats.generated.json`](../../showcase/src/data/stats.generated.json)
instead of copying a number into an integration.

## Start here

| Goal | Guide / surface |
|---|---|
| Cross-chain trading | Terminal / Telegram; routing is chain-gated and quote-driven |
| HyperLiquid | [HyperLiquid](hyperliquid.md) |
| Tempo fee-payer / MPP | [Tempo](tempo.md) |
| AI agent or API integration | [Agent clients](../agent-clients.md) |
| First integration | [Quickstart](../quickstart.md) |

## Major shipped feature areas

### Swaps and execution

- **Cross-chain + same-chain swaps** — the platform currently supports 45 mainnet chains;
  eligible routing integrations are raced for quotes and the best eligible result is
  selected. The Agent API intentionally serves a smaller discovered chain set.
- **Limit orders** — buy/sell orders at a target price (`/o`).
- **DCA** — scheduled recurring execution (`/dca`).
- **MEV-aware execution paths** — provider-specific protection where supported by the
  selected route.
- **Transaction simulation** — pre-execution simulation is available to supported flows.

### Active trading

- **Perpetuals** — HyperLiquid perps and position workflows. See
  [HyperLiquid](hyperliquid.md).
- **Copy trading** — follow and mirror traders (`/traders`, `/following`).
- **Sniping** — launch/token-sniping workflows (`/snipe`).
- **Prediction markets** — event-market discovery and trading (`/predict`).

### Capital and payments

- **Lending & savings** — earn/borrow workflows (`/save`, `/borrow`).
- **BTC bridging** — Bitcoin bridge workflows (`/btc`).
- **Gasless onboarding** — Tempo fee-payer flows. See [Tempo](tempo.md).
- **Machine payments** — MPP/x402-adjacent payment and agent commerce work where
  supported by the relevant interface.

### Portfolio, automation, and account controls

- Portfolio and PnL views.
- Price alerts and transaction history.
- Points, rewards, referrals, and account-level settings.
- TOTP 2FA, spending limits, withdrawal allowlists, and security-sensitive action logs.

## Surfaces

| Surface | Role |
|---|---|
| **Telegram** | Conversational trading, wallet/account workflows, alerts, orders and advanced commands |
| **Webapp / Terminal** | Market discovery, charts, trading, positions, portfolio and product navigation |
| **WhatsApp** | Messaging-native flows and notifications |
| **Discord** | Community/market alerts and discovery workflows |
| **TypeScript / Python SDK** | Application integration with explicit prepare-vs-managed-execute semantics |
| **Agent REST** | Lowest-level explicit API integration |
| **Hosted MCP** | Structured agent tool surface |
| **A2A** | Natural-language quotes, prices and discovery; no execution method today |
| **Browser extension / mobile** | Wallet/native-client surfaces |

## Important execution boundary

Do not assume that an API method named “swap” moves funds.

- MCP `execute_swap` prepares an **unsigned self-custody transaction**.
- Agent REST `POST /v1/agent/swap` prepares; `POST /v1/agent/swap/execute` is managed
  server-side execution.
- SDKs expose explicit self-custody preparation and managed execution paths.
- A2A has no fund-moving execution method today.

See [Build on Suwappu](../agent-clients.md) for the authoritative custody map and security
baseline.

## Protocol and research work is not automatically a user feature

The repository includes protocol primitives, execution-replay systems, plans, and
research. Those artifacts are intentionally visible, but they should not be presented as
shipped user-facing behavior merely because code exists in the monorepo.

Examples:

- [`contracts/primitives/`](../../contracts/primitives/) contains Solidity protocol
  primitives with tests/readiness material.
- `bot/services/execution_sync*.py` contains shadow/read-only execution calibration and
  replay infrastructure; production route selection remains authoritative today.
- `docs/plans/` and `docs/research/` are forward-looking or point-in-time by definition.

For the full documentation map, see [Suwappu Documentation](../README.md).
