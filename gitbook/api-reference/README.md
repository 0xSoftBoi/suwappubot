# API Reference

The complete reference for Suwappu's agent API. All endpoints are served under `https://api.suwappu.bot/v1/agent` and, unless noted as public, require an `Authorization: Bearer suwappu_sk_...` header.

## Base URL

```
https://api.suwappu.bot/v1/agent
```

## Conventions

- Requests and responses are JSON. Send `Content-Type: application/json` on any request with a body.
- Successful responses include `"success": true`. Errors include `"error"` and usually a `"message"`. See [Error Codes](errors.md).
- Amounts in requests are human-readable decimal strings (e.g. `"0.1"`), not wei or lamports.
- Quotes expire 60 seconds after they are issued.

## Endpoints

### Account

| Endpoint | Method | Description |
|----------|--------|-------------|
| [`/register`](registration.md) | POST | Register a new agent (public) |
| [`/me`](agent-profile.md) | GET / PATCH / DELETE | Read, update, or delete your agent profile |
| [`/keys/rotate`](keys.md) | POST | Rotate your API key |

### Market data

| Endpoint | Method | Description |
|----------|--------|-------------|
| [`/chains`](chains.md) | GET | List supported chains (public) |
| [`/tokens`](tokens.md) | GET | List available tokens per chain |
| [`/prices`](prices.md) | GET | Get USD prices for token symbols |

### Trading

| Endpoint | Method | Description |
|----------|--------|-------------|
| [`/quote`](quote.md) | POST | Get a swap quote |
| [`/swap`](swap.md) | POST | Build an unsigned swap transaction |
| [`/swap/execute`](swap-execute.md) | POST | Execute a swap with your managed wallet |
| [`/swap/status/:id`](swap-status.md) | GET | Get the status of a swap |
| [`/swaps`](swap-history.md) | GET | Paginated swap history |
| [`/execute`](execute.md) | POST | Run a natural-language command |

### Wallets and portfolio

| Endpoint | Method | Description |
|----------|--------|-------------|
| [`/portfolio`](portfolio.md) | GET | Get wallet balances and total USD value |
| [`/wallets`](wallets.md) | GET / POST | List or create managed wallets |

### Webhooks

| Endpoint | Method | Description |
|----------|--------|-------------|
| [`/webhooks`](webhooks.md) | GET | List webhook delivery events |
| [`/webhooks/test`](webhooks.md) | POST | Send a test webhook to your callback URL |

## Other surfaces

Perpetual futures, prediction markets, and lending live under `/v1/agent/perps`, `/v1/agent/predict`, and `/v1/agent/lend` — see [Perpetual Futures](perps.md), [Prediction Markets](predict.md), and [Lending](lend.md). The same engine is also exposed over [MCP and A2A](../protocols/README.md).
