# Suwappu 🌸

Cross-chain DEX bot & liquidity infrastructure for humans and AI agents.

[![Agent-Ready](https://img.shields.io/badge/Agent--Ready-MCP-blueviolet)](docs/features/agent_integration.md)
[![A2A-Optimized](https://img.shields.io/badge/A2A-Optimized-blue)](agent-card.json)

## Overview

```mermaid
flowchart LR
    subgraph Clients["Clients"]
        TG["Telegram"]
        WA["WhatsApp"]
        AI["AI Agents"]
    end

    subgraph Suwappu["Suwappu Platform"]
        Bot["Bot (Python)"]
        API["API (TypeScript)"]
        Web["Webapp (React)"]
        SC["Showcase (Next.js)"]
    end

    subgraph Providers["9 Swap Providers"]
        EVM["EVM Chains (6)"]
        SOL["Solana"]
    end

    TG --> Bot & Web
    WA --> Bot
    AI --> API
    Bot --> API
    Web --> API
    API --> EVM & SOL
```

**Swap tokens across 7 chains** via Telegram, WhatsApp, or programmatic API.

| Feature | Description |
|---------|-------------|
| **Cross-Chain Swaps** | ETH, BSC, Polygon, Arbitrum, Optimism, Base, Solana |
| **Telegram Mini App** | Native in-app experience |
| **Agent API** | MCP + A2A ready for AI integrations |
| **Secure Wallets** | AES-256-GCM encrypted keys |

---

## 📚 Documentation

| Category | Description | Key Links |
|-----------|-------------|--------|
| **Core Components** | Service-specific readmes | [API (TS)](api-ts/README.md) • [Webapp](webapp/README.md) • [Bot](bot/) • [Infra](infra/README.md) |
| **Architecture** | High-level design | [Scaling Guide](docs/architecture/scaling_guide.md) |
| **Development** | Setup & Debugging | [Debug Guide](docs/development/debug.md) • [Local Setup](docs/development/local_setup.md) • [Migrations](docs/development/migrations.md) |
| **Deployment** | AWS, CI/CD, Releases | [AWS Guide](docs/deployment/aws_deployment.md) • [CI/CD](docs/deployment/ci_cd.md) • [Releasing](docs/deployment/releasing.md) |
| **Features** | Swaps, Agents, Mobile | [Agent Integration](docs/features/agent_integration.md) • [Mobile Plan](docs/features/mobile_plan.md) |
| **Operations** | Health & Improvements | [Health Check](docs/operations/health_check.md) • [Improvements](docs/operations/improvements.md) |

---


## Architecture

### System Overview

```mermaid
flowchart TB
    subgraph Clients["Entry Points"]
        TG["Telegram Bot\n/s /w /b /p /a /o"]
        MiniApp["Telegram Mini App"]
        WA["WhatsApp"]
        AgentAPI["AI Agents\nMCP + A2A"]
        Dash["Dashboard"]
        Mobile["Mobile (iOS)"]
        Showcase["Showcase\nwww.suwappu.bot"]
    end

    subgraph Backend["Backend Services"]
        BotService["Python Monolith\nBot + FastAPI\nSwap Engine, Alerts,\nOrders, Sniping"]
        APITS["TypeScript API\nHono + Effect-TS\nAgent routes, Webapp routes"]
        WebService["Webapp\nReact + Vite\n(Nginx)"]
        ShowcaseService["Showcase\nNext.js"]
    end

    subgraph Data["Data Layer"]
        PG[(PostgreSQL 15\nMulti-AZ)]
        Redis[(Redis 7.1\nCache + Sessions)]
    end

    subgraph SwapProviders["Swap Providers (9)"]
        CoW["CoW Protocol"]
        Socket["Socket"]
        Jup["Jupiter + Jito"]
        CCTP["Circle CCTP"]
        Across["Across"]
        Wormhole["Wormhole"]
        LiFi["Li.Fi"]
        LZ["LayerZero/Stargate"]
        CCIP["Chainlink CCIP"]
    end

    subgraph Chains["7 Chains"]
        EVM["ETH / BSC / Polygon\nArbitrum / Optimism / Base"]
        SOL["Solana"]
    end

    TG --> BotService
    MiniApp --> WebService
    WA --> BotService
    AgentAPI --> APITS
    Dash --> APITS
    Mobile --> APITS
    Showcase --> ShowcaseService

    BotService --> APITS
    WebService --> APITS
    APITS --> PG & Redis
    BotService --> PG & Redis

    BotService --> CoW & Socket & Jup & CCTP & Across & Wormhole & LiFi & LZ & CCIP

    CoW & Socket & Across & LiFi & LZ & CCIP --> EVM
    Jup --> SOL
    Wormhole & CCTP --> EVM & SOL
```

### AWS Infrastructure

```mermaid
flowchart TB
    subgraph VPC["VPC (2 AZs)"]
        subgraph Public["Public Subnets"]
            ALB["ALB\n+ ACM Certificate"]
            NAT["NAT Gateway"]
        end

        subgraph Private["Private Subnets (ECS Fargate)"]
            subgraph ProdServices["Production"]
                BotProd["suwappu-bot-prod"]
                APIProd["suwappu-api-ts-prod"]
                WebProd["suwappu-webapp-prod"]
                ShowcaseSvc["suwappu-showcase"]
            end
            subgraph DevServices["Development"]
                BotDev["suwappu-bot-dev"]
                APIDev["suwappu-api-ts-dev"]
                WebDev["suwappu-webapp-dev"]
            end
        end

        subgraph Isolated["Isolated Subnets"]
            RDS[(RDS PostgreSQL 15\nt3.micro, Multi-AZ\n20-100 GB GP3)]
            ElastiCache[(ElastiCache Redis 7.1\ncache.t4g.micro)]
        end
    end

    WAF["WAF\nAWS Common Rules\nRate Limit: 300/IP"]
    WAF --> ALB
    ALB --> ProdServices & DevServices
    Private --> NAT --> Internet["Internet\n(Outbound)"]
    Private --> Isolated

    subgraph Support["Supporting Services"]
        SM["Secrets Manager\nsuwappu/app-secrets\nsuwappu/db-credentials"]
        ECR["ECR\nsuwappu\nsuwappu-api-ts\nsuwappu-webapp\nsuwappu-showcase"]
        KMS["KMS\nRDS Encryption Key"]
        S3["S3\nsuwappu-db-backups\n90-day lifecycle"]
        CW["CloudWatch\nContainer Insights\nLog Groups"]
        SNS["SNS Alerts\n5xx, CPU, Storage"]
    end

    SM --> Private
    ECR --> Private
    KMS --> RDS
```

**Domains:**

| Environment | Bot | API (TS) | Webapp | Showcase |
|-------------|-----|----------|--------|----------|
| **Production** | bot.suwappu.bot | api.suwappu.bot | app.suwappu.bot | www.suwappu.bot |
| **Development** | devbot.suwappu.bot | devapi.suwappu.bot | devfront.suwappu.bot | — |

### Swap Routing

The SwapEngine orchestrates 9 providers with priority-based routing:

```mermaid
flowchart LR
    Request["Swap\nRequest"] --> Engine["SwapEngine\nPriority Router"]

    Engine --> P1["1. CoW Protocol\nSame-chain EVM\nMEV-protected, P2P"]
    Engine --> P2["2. Socket\nSuper-aggregated\ncross-chain + same-chain"]
    Engine --> P3["3. Jupiter + Jito\nSolana swaps\nMEV bundles"]
    Engine --> P4["4. Circle CCTP\nNative USDC\ncross-chain (0 fee)"]
    Engine --> P5["5. Across\nFast EVM bridges\n~0.04% fee"]
    Engine --> P6["6. Wormhole\nSolana <> EVM\nbridging"]
    Engine --> P7["7. Li.Fi\nAggregated\nfallback"]
    Engine --> P8["8. LayerZero\nSame-token\ncross-chain"]
    Engine --> P9["9. Chainlink CCIP\nGeneric\ncross-chain"]

    P1 & P2 & P5 & P7 & P8 & P9 --> EVM["EVM Chains"]
    P3 --> SOL["Solana"]
    P4 & P6 --> EVM & SOL
```

### CI/CD Pipeline

```mermaid
flowchart LR
    Push["Push to\nmain / dev"] --> Detect["Detect\nChanges"]

    Detect --> BotCI["Bot CI\nruff + pytest"]
    Detect --> APICI["API-TS CI\ntypecheck + biome"]
    Detect --> WebCI["Webapp CI\nlint + build + test"]
    Detect --> ShowCI["Showcase CI\nlint + build"]

    BotCI --> Build1["Docker Build\n+ Trivy Scan"]
    APICI --> Build2["Docker Build\n+ Trivy Scan"]
    WebCI --> Build3["Docker Build"]
    ShowCI --> Build4["Docker Build"]

    Build1 & Build2 & Build3 & Build4 --> ECR["Push to ECR"]

    ECR --> Backup["Pre-deploy\nDB Backup → S3"]
    Backup --> Deploy["ECS Deploy\nCircuit Breaker\n+ Rollback"]
    Deploy --> Health["Health Check\n+ Summary"]
```

### Data Flow

```mermaid
sequenceDiagram
    participant U as User
    participant TG as Telegram
    participant W as Webapp
    participant A as API
    participant SE as SwapEngine
    participant C as Chain

    U->>TG: Open Mini App
    TG->>W: Load webapp
    W->>A: GET /webapp/user (initData)
    A-->>W: User profile + wallets

    U->>W: Request swap
    W->>A: POST /webapp/swap/quote
    A->>SE: Get best quote (9 providers)
    SE-->>A: Best quote + provider
    A-->>W: Display quote

    U->>W: Confirm swap
    W->>A: POST /webapp/swap/execute
    A->>C: Submit transaction
    C-->>A: Tx hash
    A-->>W: Swap confirmed
    W-->>U: Show success
```

---

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) v1.3+
- PostgreSQL 14+
- Telegram Bot Token

### Local Development

```bash
# Clone
git clone https://github.com/0xSoftBoi/suwappubot.git
cd suwappubot

# API (TypeScript)
cd api-ts
bun install
cp .env.example .env
bun run dev

# Webapp (separate terminal)
cd webapp
bun install
bun run dev

# Bot (Python - optional)
cd bot
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
python -m bot.main
```

### Docker

```bash
# Full stack local
docker-compose -f docker-compose.local.yml up

# Production (webhook mode)
docker-compose up
```

---

## Project Structure

```
suwappubot/
├── api/              # Python FastAPI (webhook handlers, legacy API)
├── api-ts/           # TypeScript API (Hono + Effect-TS + Drizzle)
├── bot/              # Python Telegram bot (handlers, services, models)
├── webapp/           # Telegram Mini App (React + Vite)
├── showcase/         # Homepage (Next.js) → www.suwappu.bot
├── dashboard/        # Admin Dashboard
├── mobile/           # Expo iOS Mobile App
├── tui/              # Terminal Monitoring Dashboard
├── packages/shared/  # Shared TypeScript types (api-ts, webapp, mobile)
├── infra/            # AWS CDK infrastructure
├── database/         # DB init + runtime migrations
├── scripts/          # Utility scripts (sw worktree manager, db-backup)
├── cpp/              # C++ core for high-performance math
├── tests/            # Python unit & integration tests
├── docs/             # Centralized documentation
│   ├── architecture/ # Design & roadmap
│   ├── deployment/   # AWS, CI/CD, releases
│   ├── development/  # Setup, debug, migrations
│   ├── features/     # Feature-specific guides
│   ├── operations/   # Health, post-mortems, fixes
│   └── archive/      # Historical docs
└── .github/workflows/# CI/CD pipelines (4 deploy + 1 CI + 1 rollback)
```

---

## Supported Chains & Tokens

| Chain | ID | Native | Stables | Providers |
|-------|-----|--------|---------|-----------|
| Ethereum | 1 | ETH | USDT, USDC, DAI | CoW, Socket, Li.Fi, Across |
| BSC | 56 | BNB | USDT, BUSD | Socket, Li.Fi, Stargate |
| Polygon | 137 | MATIC | USDT, USDC | CoW, Socket, Li.Fi, Across |
| Arbitrum | 42161 | ETH | USDT, USDC | CoW, Socket, Li.Fi, Across |
| Optimism | 10 | ETH | USDT, USDC | CoW, Socket, Li.Fi, Across |
| Base | 8453 | ETH | USDT, USDC | CoW, Socket, Li.Fi, Across |
| Solana | — | SOL | USDT, USDC | Jupiter + Jito, Wormhole |

---

## Bot Commands

| Command | Description |
|---------|-------------|
| `/start` | Main menu |
| `/s` | Quick swap — `/s <amount> <token>` |
| `/w` | Wallet management |
| `/b` | Check balances |
| `/p` | Portfolio overview |
| `/a` | Price alerts |
| `/o` | Limit orders & DCA |
| `/snipe` | Token sniping |
| `/hx` | Transaction history |
| `/g` | Gas tracker |
| `/f` | Favorite tokens |
| `/ref` | Referral program |
| `/xp` | Points & XP |
| `/checkin` | Daily check-in |
| `/traders` | Copy trading |
| `/tax` | Tax export |
| `/set` | Settings |
| `/h` | Help |

---

## Agent Integration

Suwappu is designed for the **agentic economy**. AI agents can:

```mermaid
flowchart LR
    Agent["🤖 AI Agent"] --> Discover["GET /tools"]
    Discover --> Quote["POST /v1/agent/quote"]
    Quote --> Execute["POST /v1/agent/swap"]
    Execute --> Result["Swap Complete"]
```

- **Tool Discovery:** `GET /tools`
- **MCP Manifest:** `GET /.well-known/ai-plugin.json`
- **Agent Skill:** [docs/features/agent_skill.md](docs/features/agent_skill.md)

See [docs/features/agent_integration.md](docs/features/agent_integration.md) for integration guide.

---

## Deployment

### Environments

All services run in a single `suwappu-cluster` on ECS Fargate.

| Environment | Bot | API (TS) | Webapp | Showcase | Branch |
|-------------|-----|----------|--------|----------|--------|
| **Production** | bot.suwappu.bot | api.suwappu.bot | app.suwappu.bot | www.suwappu.bot | `main` |
| **Development** | devbot.suwappu.bot | devapi.suwappu.bot | devfront.suwappu.bot | — | `dev` |

### CI/CD

Push to `main` or `dev` triggers GitHub Actions per service (path-filtered). Pipeline: Docker build → Trivy scan → ECR push → pre-deploy DB backup → ECS deploy with circuit breaker + rollback → health check.

See [docs/deployment/aws_deployment.md](docs/deployment/aws_deployment.md) for details.

---

## Contributing

1. Fork & create feature branch
2. Follow existing patterns
3. Add tests for new features
4. PR with description

### Code Style

- **TypeScript:** Effect-TS patterns, strict mode
- **React:** Functional components, hooks
- **Python:** Type hints, async/await

---

## Security

- Private keys encrypted with AES-256-GCM
- Telegram auth via HMAC validation
- API keys for agent/admin endpoints
- HTTPS required in production

Report vulnerabilities to security@suwappu.bot

---

## License

MIT

---

## Links

- **Production:** https://app.suwappu.bot
- **API Docs:** https://api.suwappu.bot/docs
- **Telegram Bot:** [@SuwappuBot](https://t.me/SuwappuBot)
