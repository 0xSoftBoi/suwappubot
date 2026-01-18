# Suwappu: Cross-Chain DEX Bot & Liquidity SDK

[![Agent-Ready](https://img.shields.io/badge/Agent--Ready-Model--Context--Protocol-blueviolet)](README_AGENT.md)
[![A2A-Optimized](https://img.shields.io/badge/A2A-Optimized-blue)](agent-card.json)

Suwappu is a high-performance liquidity infrastructure and cross-chain swap bot. It allows humans and **other AI agents** to swap tokens across 7+ chains with native performance and machine-readable discovery.

## Features

- Cross-chain stablecoin swaps (Ethereum, BSC, Polygon, Arbitrum, Optimism, Base, Solana)
- Support for major stablecoins (USDT, USDC, DAI, BUSD)
- Powered by Li.Fi API for cross-chain swaps
- Jupiter API integration for Solana swaps
- Secure wallet management with encrypted private keys (EVM + Solana)
- Real-time price quotes and fee estimation
- Telegram and WhatsApp Business API integration
- Agent-First Design: Built-in MCP support, A2A auth, and semantic tool discovery

## Quick Start

### Prerequisites

- Python 3.10+
- Telegram Bot Token (from [@BotFather](https://t.me/botfather))
- RPC endpoints for supported chains (Alchemy, Infura, or public RPCs)
- PostgreSQL database (or SQLite for development)

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd suwappubot

# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Configure environment
cp .env.template .env
# Edit .env with your configuration
```

### Running Locally

```bash
# Run the monolith (API + Bot)
uvicorn api.main:app --host 0.0.0.0 --port 8000 --reload
```

The bot uses **polling mode** by default, which works for single-instance local development.

## Configuration

### Required Settings

| Variable | Description |
|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather |
| `ENCRYPTION_KEY` | 32-byte hex key for encrypting wallet private keys |
| `DATABASE_URL` | Database connection string |

### Optional Settings

| Variable | Description | Default |
|----------|-------------|---------|
| `USE_WEBHOOK` | Enable webhook mode for Telegram | `false` |
| `WEBHOOK_URL` | Public URL for webhook endpoint | - |
| `WEBHOOK_SECRET_TOKEN` | Custom secret for webhook verification | auto-generated |
| `LIFI_API_KEY` | Li.Fi API key for higher rate limits | - |
| `JUPITER_API_KEY` | Jupiter API key | - |
| `LOG_LEVEL` | Logging level | `INFO` |

See `.env.template` for all available options.

## Deployment

### Telegram Bot: Polling vs Webhook Mode

Suwappu supports two modes for receiving Telegram updates:

| Mode | Use Case | Replicas |
|------|----------|----------|
| **Polling** | Local development | Single instance only |
| **Webhook** | Production | Multiple replicas supported |

#### Polling Mode (Default)

The bot polls Telegram's servers for updates. Simple but causes conflicts with multiple replicas:

```
telegram.error.Conflict: terminated by other getUpdates request
```

**Use for:** Local development, single-instance deployments.

#### Webhook Mode (Production)

Telegram pushes updates to your server. Safe with multiple replicas since Telegram sends each update exactly once.

**Enable webhook mode:**

```bash
# In your production environment
USE_WEBHOOK=true
WEBHOOK_URL=https://api.your-domain.com/telegram/webhook
# Optional: custom secret (auto-generated from bot token if not set)
WEBHOOK_SECRET_TOKEN=your_custom_secret
```

**Requirements:**
- HTTPS endpoint (TLS termination at load balancer is fine)
- Publicly accessible URL
- Port 443, 80, 88, or 8443

### Production Deployment (ECS/Kubernetes)

1. **Set environment variables:**
   ```bash
   USE_WEBHOOK=true
   WEBHOOK_URL=https://api.your-domain.com/telegram/webhook
   DATABASE_URL=postgresql://user:pass@host:5432/suwappu
   ```

2. **Deploy multiple replicas** - no polling conflicts with webhook mode

3. **Verify webhook is set:**
   ```bash
   curl https://api.telegram.org/bot<TOKEN>/getWebhookInfo
   ```

4. **Check logs for:**
   ```
   ✓ Telegram webhook set: https://api.your-domain.com/telegram/webhook
   ```

### Docker

```bash
# Build
docker build -t suwappu .

# Run (polling mode for local)
docker run -p 8000:8000 --env-file .env suwappu

# Run (webhook mode for production)
docker run -p 8000:8000 \
  -e USE_WEBHOOK=true \
  -e WEBHOOK_URL=https://api.your-domain.com/telegram/webhook \
  --env-file .env suwappu
```

### Docker Compose

```bash
# Local development (polling)
docker-compose -f docker-compose.local.yml up

# Production (webhook)
docker-compose up
```

## Architecture

```mermaid
flowchart TB
    subgraph Users["Users"]
        TG["Telegram Client"]
        WA["WhatsApp Client"]
        Agent["AI Agents"]
    end

    subgraph TelegramEco["Telegram Ecosystem"]
        Bot["Bot Commands"]
        MiniApp["Mini App Dashboard"]
    end

    subgraph Infrastructure["AWS Infrastructure"]
        subgraph ECS["ECS Fargate"]
            API["FastAPI Backend<br/>:10000"]
        end
        RDS[(PostgreSQL<br/>RDS)]
        ECR["ECR Registry"]
        SM["Secrets Manager"]
        CW["CloudWatch Logs"]
    end

    subgraph External["External Services"]
        LiFi["Li.Fi API"]
        Jupiter["Jupiter API"]
        RPCs["RPC Endpoints<br/>Alchemy/Public"]
    end

    subgraph Chains["Supported Chains"]
        ETH["Ethereum"]
        BSC["BSC"]
        POLY["Polygon"]
        ARB["Arbitrum"]
        OPT["Optimism"]
        BASE["Base"]
        SOL["Solana"]
    end

    TG --> Bot
    TG --> MiniApp
    WA --> API
    Agent --> API

    Bot --> API
    MiniApp --> API

    API --> RDS
    API --> LiFi
    API --> Jupiter
    API --> RPCs
    SM --> ECS
    ECR --> ECS
    ECS --> CW

    LiFi --> ETH & BSC & POLY & ARB & OPT & BASE
    Jupiter --> SOL
    RPCs --> Chains

    style Infrastructure fill:#ff9900,color:#000
    style TelegramEco fill:#0088cc,color:#fff
    style External fill:#28a745,color:#fff
    style Chains fill:#6f42c1,color:#fff
```

### Project Structure

```
suwappubot/
├── api/                  # FastAPI application
│   ├── main.py           # Lifespan manager, webhook endpoint
│   ├── webapp.py         # Telegram Mini App validation
│   └── routes/           # API route modules
├── bot/                  # Telegram bot logic
│   ├── main.py           # Handler registration
│   ├── config/           # Settings and configuration
│   ├── handlers/         # Command and callback handlers
│   ├── services/         # Business logic (swaps, wallets, fees)
│   └── models/           # SQLAlchemy models
├── database/             # Database setup and migrations
├── webapp/               # Telegram Mini App (React/Vite)
├── tui/                  # Terminal UI for monitoring (Bun/Ink)
└── .github/workflows/    # CI/CD pipelines
```

### Environment Setup

```mermaid
flowchart LR
    subgraph Local["Local Development"]
        DC["docker-compose.local.yml"]
        ENV_L[".env.local"]
        PG_L[(Postgres Container)]
        REDIS_L[(Redis Container)]
    end

    subgraph Dev["AWS Development"]
        ECS_D["ECS: suwappu-dev-service"]
        SEC_D["Secrets: suwappu/dev-secrets"]
        RDS_D[(RDS PostgreSQL)]
        VERCEL["Vercel: suwappu.dev"]
    end

    subgraph Prod["AWS Production"]
        ECS_P["ECS: SuwappuStack-SuwappuService"]
        SEC_P["Secrets: suwappu/app-secrets"]
        RDS_P[(RDS PostgreSQL)]
    end

    DC --> PG_L & REDIS_L
    ENV_L --> DC
    SEC_D --> ECS_D
    ECS_D --> RDS_D
    SEC_P --> ECS_P
    ECS_P --> RDS_P

    style Local fill:#28a745,color:#fff
    style Dev fill:#ffc107,color:#000
    style Prod fill:#dc3545,color:#fff
```

### Key Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Health check |
| `POST /telegram/webhook` | Telegram webhook receiver |
| `POST /webhook` | WhatsApp webhook receiver |
| `GET /tools` | Agent tool discovery |
| `GET /.well-known/ai-plugin.json` | MCP manifest |

## Commands

| Command | Description |
|---------|-------------|
| `/start` | Start the bot and show main menu |
| `/swap` | Initiate a cross-chain swap |
| `/balance` | Check wallet balances across chains |
| `/wallet` | Wallet management |
| `/help` | Show help information |

## Supported Chains & Tokens

| Chain | Tokens |
|-------|--------|
| Ethereum | USDT, USDC, DAI, ETH |
| BSC | USDT, BUSD, BNB |
| Polygon | USDT, USDC, MATIC |
| Arbitrum | USDT, USDC, ETH |
| Optimism | USDT, USDC, ETH |
| Base | USDT, USDC, ETH |
| Solana | USDT, USDC, SOL |

## Agent Interoperability (A2A)

Suwappu is designed for the agentic economy. Other AI agents can discover and use Suwappu via:

- **Integration Guide**: [README_AGENT.md](README_AGENT.md)
- **Tool Discovery**: `GET /tools`
- **MCP Manifest**: `GET /.well-known/ai-plugin.json`
- **A2A Agent Card**: `GET /agent-card.json`

## Security

- Private keys are encrypted at rest using AES-256-GCM
- Webhook requests verified via `X-Telegram-Bot-Api-Secret-Token` header
- HTTPS required for production webhook endpoints
- Never share private keys or bot tokens

## Testing

```bash
# Run all tests
pytest tests/

# Run with coverage
pytest tests/ --cov=bot --cov=api
```

## Troubleshooting

### Polling Conflicts

**Error:** `telegram.error.Conflict: terminated by other getUpdates request`

**Cause:** Multiple instances trying to poll simultaneously.

**Solution:** Enable webhook mode for multi-replica deployments:
```bash
USE_WEBHOOK=true
WEBHOOK_URL=https://your-domain.com/telegram/webhook
```

### Webhook Not Receiving Updates

1. Verify webhook is set:
   ```bash
   curl https://api.telegram.org/bot<TOKEN>/getWebhookInfo
   ```

2. Check the URL is publicly accessible

3. Verify HTTPS is working (self-signed certs not allowed)

4. Check logs for secret token verification failures

### Database Connection Issues

**Error:** `Database initialization failed - API running in degraded mode`

**Solution:** Verify `DATABASE_URL` is correct and the database is accessible.

## API-TS Infrastructure

The TypeScript API (`api-ts/`) is deployed on AWS ECS Fargate with separate dev and production environments.

### Architecture

```mermaid
flowchart TB
    subgraph Internet["Internet"]
        Users["Users / Agents"]
    end

    subgraph DNS["DNS (suwappu.bot)"]
        DevDNS["devapi.suwappu.bot"]
        ProdDNS["api.suwappu.bot"]
    end

    subgraph AWS["AWS us-east-1"]
        subgraph ALB["Application Load Balancers"]
            DevLB["suwapp-suwap-ppzluzyhsvuj<br/>DEV ALB"]
            ProdLB["suwappu-api-prod<br/>PROD ALB"]
        end

        subgraph ECS["ECS Cluster: suwappu-cluster"]
            DevService["suwappu-api-ts-dev<br/>Task: suwappu-api-ts-dev:4"]
            ProdService["suwappu-api-ts-prod<br/>Task: suwappu-api-ts-prod:1"]
        end

        subgraph TG["Target Groups"]
            DevTG["suwappu-api-ts-dev<br/>:8000"]
            ProdTG["suwappu-api-ts-prod<br/>:8000"]
        end

        ECR["ECR: suwappu-api-ts"]
        RDS[(RDS PostgreSQL)]
        SM["Secrets Manager"]
    end

    Users --> DevDNS & ProdDNS
    DevDNS --> DevLB
    ProdDNS --> ProdLB
    DevLB --> DevTG --> DevService
    ProdLB --> ProdTG --> ProdService
    DevService & ProdService --> RDS
    SM --> ECS
    ECR --> ECS

    style DevLB fill:#ffc107,color:#000
    style ProdLB fill:#28a745,color:#fff
    style DevService fill:#ffc107,color:#000
    style ProdService fill:#28a745,color:#fff
```

### Environments

#### API (api-ts)
| Environment | Domain | Load Balancer DNS | ECS Service | Image Tag |
|-------------|--------|-------------------|-------------|-----------|
| **Development** | `devapi.suwappu.bot` | `suwapp-suwap-ppzluzyhsvuj-1262209256.us-east-1.elb.amazonaws.com` | `suwappu-api-ts-dev` | `development` |
| **Production** | `api.suwappu.bot` | `suwappu-api-prod-1251755078.us-east-1.elb.amazonaws.com` | `suwappu-api-ts-prod` | `latest` |

#### Webapp (webapp)
| Environment | Domain | Load Balancer DNS | ECS Service | Image Tag |
|-------------|--------|-------------------|-------------|-----------|
| **Development** | `devfront.suwappu.bot` | `suwappu-webapp-dev-1074869316.us-east-1.elb.amazonaws.com` | `suwappu-webapp-dev` | `development` |
| **Production** | `app.suwappu.bot` | `suwappu-webapp-prod-494496315.us-east-1.elb.amazonaws.com` | `suwappu-webapp-prod` | `latest` |

### DNS Records (suwappu.bot)

Add these CNAME records to your DNS provider:

#### API Endpoints
| Type | Name | Value | Purpose |
|------|------|-------|---------|
| CNAME | `api` | `suwappu-api-prod-1251755078.us-east-1.elb.amazonaws.com` | Production API |
| CNAME | `devapi` | `suwapp-suwap-ppzluzyhsvuj-1262209256.us-east-1.elb.amazonaws.com` | Development API |

#### Webapp Endpoints
| Type | Name | Value | Purpose |
|------|------|-------|---------|
| CNAME | `app` | `suwappu-webapp-prod-494496315.us-east-1.elb.amazonaws.com` | Production Webapp |
| CNAME | `devfront` | `suwappu-webapp-dev-1074869316.us-east-1.elb.amazonaws.com` | Development Webapp |

### SSL Certificate

**Certificate ARN:** `arn:aws:acm:us-east-1:905418423235:certificate/74e95aae-e397-44cc-9005-d964c97ebc41`

**Domains:** `api.suwappu.bot`, `*.suwappu.bot`

**DNS Validation Records:**

| Type | Name | Value |
|------|------|-------|
| CNAME | `_16ec242628bf5f4ce403c01e2d963f99.api` | `_3bb764a49e402d61b97e1a5e349f2c7e.jkddzztszm.acm-validations.aws.` |
| CNAME | `_e3b65c239aa4569ad15ac3818d1e75ec` | `_b735bde063cb06a22005607fcb1cec81.jkddzztszm.acm-validations.aws.` |

### AWS Resources

```mermaid
flowchart LR
    subgraph ECS["ECS Resources"]
        Cluster["Cluster:<br/>suwappu-cluster"]
        DevSvc["Service:<br/>suwappu-api-ts-dev"]
        ProdSvc["Service:<br/>suwappu-api-ts-prod"]
        DevTask["Task Def:<br/>suwappu-api-ts-dev:4"]
        ProdTask["Task Def:<br/>suwappu-api-ts-prod:1"]
    end

    subgraph ALB["Load Balancers"]
        DevALB["ALB:<br/>Suwapp-Suwap-PpZLUzYhsvuj"]
        ProdALB["ALB:<br/>suwappu-api-prod"]
    end

    subgraph TG["Target Groups"]
        DevTG["TG:<br/>suwappu-api-ts-dev"]
        ProdTG["TG:<br/>suwappu-api-ts-prod"]
    end

    Cluster --> DevSvc & ProdSvc
    DevSvc --> DevTask
    ProdSvc --> ProdTask
    DevALB --> DevTG --> DevSvc
    ProdALB --> ProdTG --> ProdSvc

    style DevSvc fill:#ffc107,color:#000
    style ProdSvc fill:#28a745,color:#fff
    style DevALB fill:#ffc107,color:#000
    style ProdALB fill:#28a745,color:#fff
```

### Health Check Script

Monitor all API instances:

```bash
# Basic health check
./scripts/health-check.sh

# Include DNS resolution
./scripts/health-check.sh --dns

# Watch mode (every 10s)
./scripts/health-check.sh --watch --dns
```

### Useful AWS CLI Commands

```bash
# Check service status
aws --profile Swappu ecs describe-services \
  --cluster suwappu-cluster \
  --services suwappu-api-ts-prod suwappu-api-ts-dev \
  --query 'services[*].[serviceName,runningCount,desiredCount]' \
  --output table

# View recent logs
aws --profile Swappu logs tail /ecs/suwappu --follow

# Check certificate status
aws --profile Swappu acm describe-certificate \
  --certificate-arn arn:aws:acm:us-east-1:905418423235:certificate/74e95aae-e397-44cc-9005-d964c97ebc41 \
  --query 'Certificate.[Status,DomainValidationOptions[*].ValidationStatus]'

# Force new deployment
aws --profile Swappu ecs update-service \
  --cluster suwappu-cluster \
  --service suwappu-api-ts-prod \
  --force-new-deployment
```

## License

MIT

## Disclaimer

This bot interacts with blockchain networks and handles cryptocurrency. Use at your own risk. Always test with small amounts first.
