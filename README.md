# Suwappu 🌸

Cross-chain DEX bot & liquidity infrastructure for humans and AI agents.

[![Agent-Ready](https://img.shields.io/badge/Agent--Ready-MCP-blueviolet)](docs/README_AGENT.md)
[![A2A-Optimized](https://img.shields.io/badge/A2A-Optimized-blue)](agent-card.json)

## Overview

```mermaid
flowchart LR
    subgraph Clients["Clients"]
        TG["📱 Telegram"]
        WA["💬 WhatsApp"]
        AI["🤖 AI Agents"]
    end

    subgraph Suwappu["Suwappu Platform"]
        Bot["Bot Service"]
        API["API (TypeScript)"]
        Web["Webapp (React)"]
    end

    subgraph Chains["7 Chains"]
        EVM["EVM Chains"]
        SOL["Solana"]
    end

    TG --> Bot --> API
    TG --> Web --> API
    WA --> API
    AI --> API
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

| Component | Description | README |
|-----------|-------------|--------|
| **API (TypeScript)** | Hono + Effect-TS backend | [api-ts/README.md](api-ts/README.md) |
| **Webapp** | React + Vite Mini App | [webapp/README.md](webapp/README.md) |
| **Bot** | Python Telegram handlers | [bot/](bot/) |
| **Infrastructure** | AWS CDK stacks | [infra/README.md](infra/README.md) |
| **Agent Integration** | MCP & A2A guide | [docs/README_AGENT.md](docs/README_AGENT.md) |

### Additional Docs

- [Deployment Guide](docs/DEPLOYMENT.md)
- [AWS Infrastructure](docs/AWS_DEPLOYMENT.md)
- [Scaling Guide](docs/SCALING_GUIDE.md)
- [Health Check](HEALTH_CHECK.md)

---

## Architecture

### System Overview

```mermaid
flowchart TB
    subgraph Users["👥 Users"]
        TG["Telegram Client"]
        WA["WhatsApp Client"]
        Agent["AI Agents"]
    end

    subgraph TelegramEco["Telegram Ecosystem"]
        Bot["🤖 Bot Commands"]
        MiniApp["📱 Mini App"]
    end

    subgraph AWS["☁️ AWS Infrastructure"]
        subgraph ECS["ECS Fargate"]
            APIService["API Service\n(Hono/Effect)"]
            WebService["Webapp Service\n(React/Nginx)"]
            BotService["Bot Service\n(Python)"]
        end
        
        ALB["Application\nLoad Balancer"]
        RDS[(PostgreSQL)]
        SM["Secrets Manager"]
        ECR["ECR Registry"]
    end

    subgraph External["🔗 External APIs"]
        LiFi["Li.Fi API"]
        Jupiter["Jupiter API"]
        RPCs["RPC Endpoints"]
    end

    subgraph Chains["⛓️ Supported Chains"]
        ETH["Ethereum"]
        BSC["BSC"]
        POLY["Polygon"]
        ARB["Arbitrum"]
        OPT["Optimism"]
        BASE["Base"]
        SOL["Solana"]
    end

    TG --> Bot & MiniApp
    WA --> APIService
    Agent --> APIService

    Bot --> BotService --> APIService
    MiniApp --> WebService
    WebService --> APIService

    ALB --> APIService & WebService & BotService
    APIService --> RDS
    APIService --> LiFi & Jupiter & RPCs
    SM --> ECS
    ECR --> ECS

    LiFi --> ETH & BSC & POLY & ARB & OPT & BASE
    Jupiter --> SOL

    style AWS fill:#ff9900,color:#000
    style TelegramEco fill:#0088cc,color:#fff
    style External fill:#28a745,color:#fff
```

### Data Flow

```mermaid
sequenceDiagram
    participant U as User
    participant TG as Telegram
    participant W as Webapp
    participant A as API
    participant L as Li.Fi/Jupiter
    participant C as Chain

    U->>TG: Open Mini App
    TG->>W: Load webapp
    W->>A: GET /webapp/user (initData)
    A-->>W: User profile + wallets
    
    U->>W: Request swap
    W->>A: POST /webapp/swap/quote
    A->>L: Get quote
    L-->>A: Quote response
    A-->>W: Display quote
    
    U->>W: Confirm swap
    W->>A: POST /webapp/swap/execute
    A->>C: Submit transaction
    C-->>A: Tx hash
    A-->>W: Swap confirmed
    W-->>U: Show success
```

### Deployment Environments

```mermaid
flowchart LR
    subgraph Dev["🟡 Development"]
        DevAPI["devapi.suwappu.bot"]
        DevWeb["devfront.suwappu.bot"]
    end

    subgraph Prod["🟢 Production"]
        ProdAPI["api.suwappu.bot"]
        ProdWeb["app.suwappu.bot"]
    end

    subgraph AWS["AWS ECS"]
        DevCluster["suwappu-cluster\n(dev services)"]
        ProdCluster["suwappu-cluster\n(prod services)"]
    end

    DevAPI --> DevCluster
    DevWeb --> DevCluster
    ProdAPI --> ProdCluster
    ProdWeb --> ProdCluster

    style Dev fill:#ffc107,color:#000
    style Prod fill:#28a745,color:#fff
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
├── api-ts/           # TypeScript API (Hono + Effect)
│   ├── src/
│   │   ├── routes/   # API endpoints
│   │   ├── services/ # Business logic
│   │   └── db/       # Drizzle schema
│   └── README.md     # 📖 API docs
│
├── webapp/           # Telegram Mini App (React)
│   ├── src/
│   │   ├── pages/    # Route pages
│   │   ├── components/
│   │   └── theme/    # Design system
│   └── README.md     # 📖 Webapp docs
│
├── bot/              # Python Telegram bot
│   ├── handlers/     # Command handlers
│   └── services/     # Swap/wallet logic
│
├── infra/            # AWS CDK infrastructure
│   └── README.md     # 📖 Infra docs
│
├── docs/             # Additional documentation
│   ├── README_AGENT.md
│   ├── DEPLOYMENT.md
│   └── ...
│
├── .github/workflows/  # CI/CD pipelines
└── docker-compose.yml
```

---

## Supported Chains & Tokens

| Chain | ID | Tokens | Bridge |
|-------|-----|--------|--------|
| Ethereum | 1 | USDT, USDC, DAI, ETH | Li.Fi |
| BSC | 56 | USDT, BUSD, BNB | Li.Fi |
| Polygon | 137 | USDT, USDC, MATIC | Li.Fi |
| Arbitrum | 42161 | USDT, USDC, ETH | Li.Fi |
| Optimism | 10 | USDT, USDC, ETH | Li.Fi |
| Base | 8453 | USDT, USDC, ETH | Li.Fi |
| Solana | - | USDT, USDC, SOL | Jupiter |

---

## Bot Commands

| Command | Description |
|---------|-------------|
| `/start` | Start bot, show menu |
| `/swap` | Initiate cross-chain swap |
| `/balance` | Check wallet balances |
| `/wallet` | Wallet management |
| `/help` | Help & support |

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
- **Agent Card:** `GET /agent-card.json`

See [docs/README_AGENT.md](docs/README_AGENT.md) for integration guide.

---

## Deployment

### Environments

| Environment | API | Webapp | Branch |
|-------------|-----|--------|--------|
| **Production** | api.suwappu.bot | app.suwappu.bot | `main` |
| **Development** | devapi.suwappu.bot | devfront.suwappu.bot | `dev` |

### CI/CD

Push to `main` or `dev` triggers GitHub Actions → ECR → ECS deployment.

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for details.

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
