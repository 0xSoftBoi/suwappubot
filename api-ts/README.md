# Suwappu API (TypeScript)

A high-performance TypeScript API built with **Effect-TS**, **Hono**, and **Drizzle ORM**. This is the next-generation API layer for Suwappu, designed for deployment on AWS Fargate.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Runtime | [Bun](https://bun.sh) v1.3+ |
| Framework | [Hono](https://hono.dev) v4.6+ |
| Effect System | [Effect-TS](https://effect.website) v3.10+ |
| Database | [Drizzle ORM](https://orm.drizzle.team) + PostgreSQL |
| Validation | [@effect/schema](https://effect.website/docs/schema) |

## Project Structure

```
api-ts/
├── src/
│   ├── index.ts              # Bun.serve entry point
│   ├── app.ts                # Hono app composition
│   ├── runtime.ts            # Effect ManagedRuntime
│   ├── config/
│   │   └── EnvService.ts     # Environment config (Effect Layer)
│   ├── middleware/
│   │   ├── auth.ts           # X-Agent-Key / X-Admin-Key validation
│   │   ├── telegram.ts       # X-Telegram-Init-Data HMAC validation
│   │   └── cors.ts           # CORS configuration
│   ├── routes/
│   │   ├── health.ts         # GET /health
│   │   ├── tools.ts          # GET /tools (agent discovery)
│   │   ├── webapp.ts         # /webapp/* (Telegram Mini App)
│   │   ├── users.ts          # /users/{id}/* (user resources)
│   │   └── agent.ts          # /v1/agent/* (AI agent API)
│   ├── services/
│   │   ├── TelegramAuthService.ts
│   │   ├── UserService.ts
│   │   ├── WalletService.ts
│   │   ├── SwapService.ts
│   │   └── MainLayer.ts      # Effect Layer composition
│   ├── db/
│   │   ├── client.ts         # Drizzle client factory
│   │   ├── DrizzleService.ts # Effect Layer for DB
│   │   └── schema/           # Drizzle table definitions
│   └── errors/
│       └── index.ts          # Tagged error types
├── ecs/
│   ├── task-definition-dev.json
│   └── setup-dev.sh
├── scripts/
│   └── ping-dev.sh           # Health check script
├── Dockerfile
├── docker-compose.yml
└── package.json
```

## Quick Start

### Local Development

```bash
# Install dependencies
bun install

# Set environment variables
cp .env.example .env
# Edit .env with your values

# Run development server (hot reload)
bun run dev

# Type check
bun run check

# Production build
bun run build
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Server port (default: 8000) |
| `NODE_ENV` | No | Environment (development/production) |
| `DATABASE_URL` | Yes* | PostgreSQL connection string |
| `TELEGRAM_BOT_TOKEN` | Yes* | Telegram bot token for auth |
| `AGENT_API_KEY` | Yes | API key for agent endpoints |
| `ADMIN_API_KEY` | No | API key for admin endpoints |
| `ALLOWED_ORIGINS` | No | CORS allowed origins (comma-separated) |
| `ALCHEMY_API_KEY` | No | Alchemy API for RPC/token data |
| `LIFI_API_KEY` | No | Li.Fi API for cross-chain swaps |

*Required for database/auth features, API runs in degraded mode without them.

## API Endpoints

### Public

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |

### Agent API (requires `X-Agent-Key` header)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/tools` | Agent tool discovery (A2A protocol) |
| GET | `/users/{id}/wallets` | List user wallets |
| GET | `/users/{id}/portfolio` | User portfolio with balances |
| GET | `/users/{id}/swaps` | User swap history |
| POST | `/v1/agent/execute` | Execute natural language command |
| POST | `/v1/agent/wallets` | Create wallet (stub) |

### Webapp API (requires `X-Telegram-Init-Data` header)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/webapp/validate` | Validate Telegram initData |
| GET | `/webapp/users/me/portfolio` | Current user portfolio |
| GET | `/webapp/users/me/swaps` | Current user swap history |

## Deployments

### Environments

| Environment | URL | Branch | ECS Service |
|-------------|-----|--------|-------------|
| Development | https://devapi.suwappu.dev | `dev` | `suwappu-api-ts-dev` |
| Production | https://api.suwappu.dev | `main` | `suwappu-api-ts-prod` |

### AWS Infrastructure

```
Region: us-east-1
Account: 905418423235

┌─────────────────────────────────────────────────────────────┐
│                        Route 53 / Vercel DNS                │
│  devapi.suwappu.dev ─┬─► ALB ─► Target Group ─► ECS Fargate │
│  api.suwappu.dev ────┘                                      │
└─────────────────────────────────────────────────────────────┘
```

| Resource | Value |
|----------|-------|
| ECS Cluster | `suwappu-cluster` |
| ECR Repository | `suwappu-api-ts` |
| ALB | `Suwapp-Suwap-PpZLUzYhsvuj-1262209256.us-east-1.elb.amazonaws.com` |
| Target Group (dev) | `suwappu-api-ts-dev` (port 8000) |
| Log Group | `/ecs/suwappu` (stream prefix: `api-ts-dev`) |
| RDS | `suwappustack-suwappudatabase7fc7bcd8-nlylumxmlxo6.cgpw024wqms5.us-east-1.rds.amazonaws.com` |

### Task Definition

| Setting | Value |
|---------|-------|
| CPU | 256 (0.25 vCPU) |
| Memory | 512 MB |
| Platform | Fargate (Linux) |
| Container Port | 8000 |

### Secrets (AWS Secrets Manager)

Secrets are pulled from two sources:
- `suwappu/app-secrets` - Application secrets (DATABASE_URL, TELEGRAM_BOT_TOKEN, LIFI_API_KEY, etc.)
- `suwappu/db-credentials` - Database credentials and AGENT_API_KEY

### IAM Roles

| Role | Purpose |
|------|---------|
| `SuwappuStack-SuwappuTaskExecutionRole23EC76C6-*` | Task execution (ECR pull, secrets, logs) |
| `SuwappuStack-SuwappuTaskTaskRoleB8E1A138-*` | Task role (runtime permissions) |

### Security Groups

| Security Group | Ports | Source |
|----------------|-------|--------|
| `sg-0cc9f4d21fa8a5175` | 8000, 10000 | ALB security group |

### DNS Configuration (Vercel)

```
devapi.suwappu.dev  CNAME  Suwapp-Suwap-PpZLUzYhsvuj-1262209256.us-east-1.elb.amazonaws.com
api.suwappu.dev     CNAME  Suwapp-Suwap-PpZLUzYhsvuj-1262209256.us-east-1.elb.amazonaws.com
```

## Deployment

### Manual Deployment (Dev)

```bash
# First time setup
cd api-ts
./ecs/setup-dev.sh

# Subsequent deployments
AWS_PROFILE=Swappu aws ecs update-service \
  --cluster suwappu-cluster \
  --service suwappu-api-ts-dev \
  --force-new-deployment
```

### CI/CD (GitHub Actions)

Deployments are triggered automatically:
- Push to `dev` branch → deploys to `devapi.suwappu.dev`
- Push to `main` branch → deploys to `api.suwappu.dev`

Only changes in `api-ts/` directory trigger deployments.

Workflow: `.github/workflows/deploy-api-ts.yml`

### Health Check

```bash
# Quick ping
./scripts/ping-dev.sh

# Manual check
curl https://devapi.suwappu.dev/health
```

### View Logs

```bash
# Stream logs
aws logs tail /ecs/suwappu --filter-pattern api-ts-dev --follow --profile Swappu

# Recent logs
aws logs tail /ecs/suwappu --filter-pattern api-ts-dev --since 30m --profile Swappu
```

## Testing

### With curl

```bash
# Health check
curl https://devapi.suwappu.dev/health

# Get tools (requires API key)
curl https://devapi.suwappu.dev/tools \
  -H "X-Agent-Key: YOUR_API_KEY"

# Validate Telegram auth
curl -X POST https://devapi.suwappu.dev/webapp/validate \
  -H "X-Telegram-Init-Data: YOUR_INIT_DATA"

# Execute agent command
curl -X POST https://devapi.suwappu.dev/v1/agent/execute \
  -H "X-Agent-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"user_id": "1", "command": "swap 0.1 ETH to USDC on Base"}'
```

## Architecture

### Effect-TS Pattern

The API uses Effect-TS for dependency injection and error handling:

```typescript
// Services are defined as Context Tags
class UserService extends Context.Tag('UserService')<UserService, UserServiceInterface>() {}

// Layers provide implementations
const UserServiceLive = Layer.succeed(UserService, { ... })

// Effects compose services
const getUser = Effect.gen(function* () {
  const userService = yield* UserService
  return yield* userService.getUserById(id)
})

// Runtime executes effects
const result = await runEffect(getUser)
```

### Error Handling

Errors are modeled as tagged unions using `Data.TaggedError`:

```typescript
class NotFoundError extends Data.TaggedError('NotFoundError')<{
  message?: string
  resource?: string
}> {}

// Pattern matching for HTTP responses
const response = Match.value(error).pipe(
  Match.tag('NotFoundError', (e) => ({ status: 404, body: { error: 'Not Found' } })),
  Match.tag('ValidationError', (e) => ({ status: 400, body: { error: e.message } })),
  Match.exhaustive
)
```

## Related Documentation

- [Effect-TS Documentation](https://effect.website/docs)
- [Hono Documentation](https://hono.dev/docs)
- [Drizzle ORM Documentation](https://orm.drizzle.team/docs/overview)
- [AWS ECS Fargate](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/AWS_Fargate.html)
