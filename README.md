# Suwappu 🌸

Cross-chain DEX infrastructure for humans and AI agents — swap tokens across 14 chains via Telegram, WhatsApp, Discord, or programmatic API.

[![Agent-Ready](https://img.shields.io/badge/Agent--Ready-MCP-blueviolet)](docs/agent-clients.md)
[![ClawHub](https://img.shields.io/badge/ClawHub-suwappu--dex-ff4d4d)](https://clawhub.ai/0xsoftboi/suwappu-dex)
[![A2A Protocol](https://img.shields.io/badge/A2A-Protocol-blue)](api-ts/agent-card.json)
[![Chains](https://img.shields.io/badge/Chains-14-green)]()
[![Providers](https://img.shields.io/badge/Swap_Providers-15+-orange)]()

## Overview

**14 chains. 15+ swap providers. 3 agent protocols. 5 frontends.**

| | |
|---|---|
| **Chains** | 12 EVM (ETH, BSC, Polygon, Arbitrum, Optimism, Base, Avalanche, Fantom, Linea, Mantle, Gnosis, Scroll) + Solana + TRON |
| **Swap Providers** | CoW Protocol, Socket, Jupiter, Jito, Li.Fi, Circle CCTP, Across, Wormhole, LayerZero, Chainlink CCIP, OKX DEX, 1inch, KyberSwap, 0x, SunSwap + more |
| **Agent Protocols** | REST API (50+ endpoints) · MCP (22 tools) · A2A (JSON-RPC) |
| **Platforms** | Telegram Bot · WhatsApp · Discord · Web Terminal · Browser Extension |
| **SDKs** | [`@suwappu/sdk`](https://www.npmjs.com/package/@suwappu/sdk) · [`@suwappu/mcp-server`](https://www.npmjs.com/package/@suwappu/mcp-server) · Python SDK |

---

## Architecture

```mermaid
flowchart LR
    subgraph Clients["Entry Points"]
        TG["Telegram Bot"]
        WA["WhatsApp"]
        DC["Discord"]
        AI["AI Agents\nMCP + A2A + REST"]
        Web["Webapp + Terminal"]
        Ext["Browser Extension"]
    end

    subgraph Backend["Backend"]
        Bot["Python Monolith\nSwap Engine · 60+ Handlers\n120+ Services"]
        API["TypeScript API\nHono + Effect-TS\n50+ Endpoints"]
    end

    subgraph Providers["15+ Swap Providers"]
        EVM["12 EVM Chains"]
        SOL["Solana"]
        TRON["TRON"]
    end

    TG & WA & DC --> Bot
    AI & Web & Ext --> API
    Bot --> API
    API --> EVM & SOL & TRON
    Bot --> EVM & SOL & TRON
```

---

## Features

### Trading
- **Cross-chain swaps** — 15+ providers raced in parallel per route, best-price selection, slippage protection
- **MEV protection** — CoW Protocol batch auctions (EVM) + Jito bundles (Solana)
- **Limit orders** — Buy/sell triggers, stop-loss, trailing stop with expiry
- **DCA orders** — Dollar-cost averaging on daily/weekly/monthly intervals
- **Token sniping** — Pump.fun + Raydium launch detection, instant/conditional/first-block modes
- **Perpetuals** — HyperLiquid integration (1-20x leverage, TP/SL, position monitoring)
- **Copy trading** — Follow up to 5 traders, auto-mirror swaps, PnL leaderboard

### Security
- **Anti-rug engine** — Safety scoring (0-100), honeypot detection, mint/freeze authority checks, blacklist, liquidity analysis
- **Transaction simulation** — Simulate before execution
- **Wallet encryption** — AES-256-GCM envelope encryption with AWS KMS (auto-migrates from legacy Fernet)
- **Turnkey TEE wallets** — Hardware-isolated key management with sub-org policies
- **2FA** — TOTP (Google Authenticator compatible) with configurable threshold (default $1,000+)
- **Spending limits** — Per-swap ($5K), hourly ($10K), daily ($50K) — user-customizable
- **Withdrawal whitelisting** — Pre-approved addresses with 24h cooldown

### Agent Integration

| Protocol | Endpoint | Tools/Skills |
|----------|----------|-------------|
| **REST API** | `/v1/agent/*` | 50+ endpoints — swaps, wallets, portfolio, perps, predictions, lending, webhooks |
| **MCP** | `/mcp` | 22 tools — quotes, swaps, portfolio, perps, predictions, lending, wallet policies, and more |
| **A2A** | `/a2a` | Natural language — "swap 0.5 ETH to USDC on base", "price ETH SOL BTC" |

**Framework toolkits:** [LangChain](https://github.com/0xSoftBoi/suwappu-langchain) · [CrewAI](https://github.com/0xSoftBoi/suwappu-crewai-crew) · **[OpenClaw](packages/openclaw/SKILL.md)** (zero-code, native MCP). Add Suwappu to any OpenClaw agent in one command:

```bash
openclaw mcp add suwappu --url https://api.suwappu.bot/mcp \
  --transport streamable-http \
  --header "Authorization=Bearer $SUWAPPU_API_KEY" --exclude execute_swap
```

See [docs/features/openclaw_integration.md](docs/features/openclaw_integration.md).

### Engagement
- **Points/XP system** — Levels (Bronze → Platinum), daily check-ins, milestones, reward store
- **3-tier referrals** — 30% fee share to referrers
- **Subscription tiers** — Free / Pro ($9.99) / Premium ($29.99) / Enterprise ($99.99) with rate limits
- **x402 micropayments** — Token-gated access protocol
- **Tax export** — CSV/JSON yearly reports with cost-basis tracking

### Multi-Platform

| Platform | Capabilities |
|----------|-------------|
| **Telegram** | Full feature set — 60+ commands across 60+ handlers, Mini App, inline keyboards |
| **WhatsApp** | Swaps, orders, DCA, alerts, voice messages, conversation flows |
| **Discord** | Whale alerts, trending tokens, leaderboard, analysis forum |
| **Web Terminal** | TradingView charts, order book, 20+ panels, keyboard shortcuts |
| **Browser Extension** | MV3 wallet — injects `window.ethereum`/`window.solana`, EIP-1193/6963 + Wallet Standard |

---

## Quick Start

### MCP (Claude Desktop / Cursor)

Add to your Claude Desktop config:

```json
{
  "mcpServers": {
    "suwappu": {
      "url": "https://api.suwappu.bot/mcp",
      "headers": { "Authorization": "Bearer suwappu_sk_YOUR_KEY" }
    }
  }
}
```

Or via npm:

```bash
npm install -g @suwappu/mcp-server
SUWAPPU_API_KEY=suwappu_sk_YOUR_KEY npx @suwappu/mcp-server
```

### A2A (Agent-to-Agent)

```bash
# Discover capabilities
curl https://api.suwappu.bot/.well-known/agent.json

# Natural language swap
curl -X POST https://api.suwappu.bot/a2a \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"message/send","params":{"message":{"role":"user","parts":[{"type":"text","text":"swap 0.5 ETH to USDC on base"}]}}}'
```

### Local Development

```bash
# TypeScript API
cd api-ts && bun install && bun run dev

# Webapp
cd webapp && npm install && npm run dev

# Bot (Python)
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn api.main:app --host 0.0.0.0 --port 8000 --reload
```

Each service needs its own `.env` — see [`.env.schema`](.env.schema) for the full contract
and `python3 scripts/doctor.py` to check what's configured locally.

---

## Swap Routing

The SwapEngine races all eligible providers for a given route in parallel and returns the
best output amount — it's quote comparison, not a fixed priority list:

```
Request → Pre-checks (spending limits, safety score, MEV config)
        → SwapEngine: race eligible providers in parallel, pick best output
           Same-chain EVM   — CoW Protocol (MEV-protected batch auctions), OKX DEX,
                              1inch, KyberSwap, 0x, Li.Fi
           Solana           — Jupiter + Jito (MEV bundle protection)
           Cross-chain      — Socket, Li.Fi, Circle CCTP (USDC), Across, Wormhole,
                              LayerZero, Chainlink CCIP
           Chain-specific   — SunSwap (TRON), plus other per-chain DEX integrations
        → Points-based fee discount (up to 50%)
```

---

## Supported Chains

| Chain | ID | Native | Type | Swap Providers |
|-------|-----|--------|------|---------------|
| Ethereum | 1 | ETH | EVM | CoW, Socket, Li.Fi, Across, CCTP, CCIP, LayerZero |
| BSC | 56 | BNB | EVM | Socket, Li.Fi, Across, LayerZero |
| Polygon | 137 | MATIC | EVM | CoW, Socket, Li.Fi, Across, CCTP |
| Arbitrum | 42161 | ETH | EVM | CoW, Socket, Li.Fi, Across, CCTP, LayerZero |
| Optimism | 10 | ETH | EVM | CoW, Socket, Li.Fi, Across, CCTP, LayerZero |
| Base | 8453 | ETH | EVM | CoW, Socket, Li.Fi, Across, CCTP |
| Avalanche | 43114 | AVAX | EVM | Socket, Li.Fi, Across, CCTP |
| Fantom | 250 | FTM | EVM | Socket, Li.Fi |
| Linea | 59144 | ETH | EVM | Socket, Li.Fi |
| Mantle | 5000 | MNT | EVM | Socket, Li.Fi |
| Gnosis | 100 | xDAI | EVM | Socket, Li.Fi |
| Scroll | 534352 | ETH | EVM | Socket, Li.Fi |
| Solana | — | SOL | Solana | Jupiter, Jito, Wormhole |
| TRON | — | TRX | TRON | Li.Fi |

---

## Bot Commands

Core commands below — the bot has grown to 60+ handlers (savings, borrow, P2P, bulk pay,
airdrops, gift cards, and more); see [docs/features/README.md](docs/features/README.md) for
the fuller map, or `/start` in the bot for the current menu.

| Command | Description |
|---------|-------------|
| `/s` | Quick swap — `/s <amount> <token>` |
| `/w` | Wallet management (create/import EVM, Solana, TRON) |
| `/b` | Balances across all chains |
| `/p` | Portfolio overview with PnL |
| `/o` | Limit orders + DCA |
| `/snipe` | Token sniping (Pump.fun, Raydium) |
| `/perps` | Perpetuals (HyperLiquid, 1-20x) |
| `/traders` | Copy trading leaderboard |
| `/a` | Price alerts |
| `/hx` | Transaction history |
| `/xp` | Points, levels, rewards |
| `/checkin` | Daily check-in (streak bonus) |
| `/ref` | Referral program (30% fee share) |
| `/tax` | Tax export (CSV/JSON) |
| `/c` | Custodial deposits/withdrawals |
| `/sub` | Subscription tiers |
| `/set` | Settings (slippage, 2FA, limits, notifications) |
| `/g` | Gas tracker |
| `/f` | Favorite tokens |

---

## Project Structure

```
suwappubot/
├── api-ts/             # TypeScript API (Hono + Effect-TS + Drizzle)
│   └── src/
│       ├── routes/     # 22 route modules, 50+ endpoints
│       ├── services/   # Services (swap, agent, perps, lending, etc.)
│       └── middleware/  # Auth (bearer, telegram, flex, admin, internal)
├── bot/                # Python Telegram bot
│   ├── handlers/       # 60+ command handlers
│   ├── services/       # 120+ services (swap engine, sniping, copy, security)
│   └── config/         # Chain configs, token configs, settings
├── api/                # Python FastAPI (webhook handlers)
├── webapp/             # React + Vite Telegram Mini App — 29 pages, dev-only, not deployed
├── terminal/           # Live Telegram Mini App (app.suwappu.bot) — 20+ panels, TradingView
├── extension/          # Browser wallet extension (MV3, EIP-1193/6963 + Wallet Standard)
├── showcase/           # Marketing site (Next.js)
├── contracts/          # SUWP token + on-chain harness (Solidity)
├── cloudflare/         # Cloudflare Worker (router)
├── packages/
│   ├── shared/         # Shared TypeScript types
│   ├── sdk/            # @suwappu/sdk (npm, published)
│   ├── openclaw/       # @suwappu/openclaw (npm, published)
│   ├── design-tokens/  # @suwappu/design-tokens
│   └── sdk-python/     # Python SDK (development)
├── gitbook/            # API documentation (50+ files)
├── infra/              # AWS CDK — legacy, unused for app deploys (see Deployment)
├── database/           # DB init + runtime migrations
├── docs/               # Architecture, deployment, and feature docs
├── skills/             # Claude Code skills for this repo
├── monitoring/         # External health-check endpoint manifest
├── tests/              # Python tests
└── .github/workflows/  # CI/CD
```

`@suwappu/mcp-server` is published to npm but not vendored in this monorepo.

---

## API Endpoints (TypeScript)

| Route Module | Auth | Key Endpoints |
|-------------|------|--------------|
| **Agent** (`/v1/agent/*`) | Bearer | register, quote, swap, execute, portfolio, prices, tokens, wallets, wallet policies, webhooks, key rotation |
| **Perps** (`/v1/agent/perps/*`) | Bearer | markets, quote, positions |
| **Predictions** (`/v1/agent/predict/*`) | Bearer | markets, market details (Polymarket) |
| **Lending** (`/v1/agent/lend/*`) | Bearer | markets, market details (Morpho) |
| **MCP** (`/mcp`) | Bearer | 22 tools via JSON-RPC |
| **A2A** (`/a2a`) | Bearer | message/send, tasks/get, tasks/cancel |
| **Webapp Swap** (`/webapp/swap/*`) | Telegram | quote, execute, status, chains, tokens |
| **Webapp Auth** (`/webapp/*`) | Various | validate, telegram auth, Turnkey OAuth, trending, token info/chart |
| **Public** (`/public/swap/*`) | Optional | chains, tokens, quote, execute, status (rate-limited) |
| **Admin** (`/admin/*`) | Admin key | stats, agents, swaps, webhooks |
| **Internal** (`/internal/*`) | Internal key | Service-to-service swap, user, events, payment verification |
| **Health** (`/health`) | None | Health + DB connectivity |

---

## npm Packages

| Package | Version | Description |
|---------|---------|-------------|
| [`@suwappu/sdk`](https://www.npmjs.com/package/@suwappu/sdk) | 0.5.2 | TypeScript SDK + `suwappu` CLI |
| [`@suwappu/mcp-server`](https://www.npmjs.com/package/@suwappu/mcp-server) | 0.1.1 | MCP server for Claude Desktop/Cursor |
| [`@suwappu/openclaw`](https://www.npmjs.com/package/@suwappu/openclaw) | 0.2.0 | OpenClaw skill module |

---

## Deployment

Deploy target is **Railway** — there is no AWS/ECS/EC2 deploy path anymore. Railway is wired
to GitHub, so merging to `main`/`dev` auto-deploys any service whose watched paths changed.
See [docs/deployment/railway.md](docs/deployment/railway.md) and the `/deploy` skill.
(The AWS Dockerfiles/CDK under `infra/` are left in place for reversibility, not because
they're live.)

**`webapp/` is unused in production** — it has no Railway service and deploys nowhere. The
live Telegram Mini App (`app.suwappu.bot`) is served by `terminal/`.

| Service | Production URL | Branch |
|---------|-----------------|--------|
| `python-api` (bot + FastAPI) | python-api-*.up.railway.app (no custom domain) | `main` |
| `api-ts` | api.suwappu.bot | `main` |
| `terminal` (live Mini App) | app.suwappu.bot · terminal.suwappu.bot | `main` |
| `showcase` | www.suwappu.bot | `main` |

Development env uses the same services on the `dev` branch, e.g. `devapi.suwappu.bot` for
api-ts.

CI/CD: GitHub Actions auto-deploys on push to `main`/`dev` (see
[docs/deployment/monitoring.md](docs/deployment/monitoring.md) for how each layer's health is
checked post-deploy).

---

## Security

- **Wallet encryption** — AES-256-GCM envelope encryption with AWS KMS
- **Turnkey TEE** — Hardware-isolated key management
- **2FA** — TOTP with backup codes, configurable threshold
- **Spending limits** — Per-swap, hourly, daily (user-customizable)
- **Anti-rug** — Safety scoring, honeypot detection, authority checks, emergency auto-sell
- **Token analysis** — GoPlus Security API integration
- **Transaction simulation** — Simulate before executing
- **Withdrawal whitelisting** — 24h cooldown for new addresses
- **WAF** — AWS WAF with rate limiting (300 req/IP)
- **Audit logging** — All security-sensitive actions logged

Report vulnerabilities to **security@suwappu.bot** — see [SECURITY.md](./SECURITY.md).

### Supply chain

We practice continuous open-source dependency scanning and ship a
checked-in Software Bill of Materials (SBOM).

- **Checked-in SBOM.** A [CycloneDX](https://cyclonedx.org/) SBOM lives
  at [`sbom/suwappubot.cdx.json`](./sbom/suwappubot.cdx.json) —
  every dependency across every ecosystem in this monorepo (Python,
  npm, bun), deduplicated. Generated with
  [Syft](https://github.com/anchore/syft), which auto-detects every
  package manifest/lockfile in the tree; nothing is hand-authored.

  Regenerate the SBOM:

  ```sh
  curl -sSfL https://raw.githubusercontent.com/anchore/syft/main/install.sh | sh -s -- -b /usr/local/bin
  syft . -o cyclonedx-json=sbom/suwappubot.cdx.json
  ```

- **CI workflows (SHA-pinned).** Two additive workflows live under
  `.github/workflows/`:
  - [`sbom.yml`](./.github/workflows/sbom.yml) — on each published
    Release, regenerates the CycloneDX SBOM with Syft and attaches it
    as a Release asset.
  - [`scorecard.yml`](./.github/workflows/scorecard.yml) — weekly +
    on push to `main`, runs [OpenSSF Scorecard](https://securityscorecards.dev/)
    and uploads SARIF to the repo Security tab.

  Both workflows pin every action to a full commit SHA (a stricter
  convention than this repo's other workflows, deliberately — a
  supply-chain-security workflow pinning its own dependencies loosely
  would undercut the point). This repo's Actions billing is active, so
  both run for real starting with the first push/release after merge —
  not dormant pending billing, unlike the initial rollout on other
  Suwappu satellite repos.

  Not audited, not SOC 2 — this is dependency-inventory tooling
  (what's in the tree and how it's fetched), not a security
  certification. See [SECURITY.md](./SECURITY.md) for the actual
  security posture and vulnerability-reporting process.

---

## Documentation

| Resource | Description |
|----------|-------------|
| [GitBook API Docs](gitbook/) | Full API reference (50+ files) |
| [Agent Clients](docs/agent-clients.md) | MCP, A2A, REST setup for AI agents |
| [Features](docs/features/README.md) | User-facing feature guides (HyperLiquid, Tempo, etc.) |
| [Deployment](docs/deployment/) | Railway, CI/CD, monitoring |
| [CLAUDE.md](CLAUDE.md) | Local setup, build commands, migrations, architecture gotchas |

### Governance

| Resource | Description |
|----------|-------------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | System boundaries, decision taxonomy, standing decisions |
| [CONVENTIONS.md](CONVENTIONS.md) | Toolchain, git, code, testing, and naming rules |
| [AGENTS.md](AGENTS.md) | Policy for AI agents working in this repo |
| [CONTRIBUTING.md](CONTRIBUTING.md) · [SUPPORT.md](SUPPORT.md) · [SECURITY.md](SECURITY.md) | Contributing, getting help, vulnerability reporting |
| [CHANGELOG.md](CHANGELOG.md) | Notable changes |
| [`.env.schema`](.env.schema) · [`capabilities.yaml`](capabilities.yaml) | Generated env contract · optional-provider manifest (`python3 scripts/doctor.py` to probe) |

---

## Links

- **Webapp:** https://app.suwappu.bot
- **API:** https://api.suwappu.bot
- **Showcase:** https://www.suwappu.bot
- **Telegram Bot:** [@SuwappuBot](https://t.me/SuwappuBot)
- **Agent Card:** https://api.suwappu.bot/.well-known/agent.json
