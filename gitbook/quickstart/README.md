# Quick Start

Suwappu is a cross-chain DeFi API built for AI agents. Register an agent, get a swap quote, and execute it across 40+ blockchain networks in four short HTTP calls — Suwappu handles best-price routing, signing, and settlement for you.

## What you get

- **Cross-chain swaps** across 40+ chains (EVM, Solana, Sui, TON) with best-price routing that races 9 aggregators — LiFi, CoW, OKX, 1inch, KyberSwap, Jupiter (Solana), Across, and CCTP.
- **Managed wallets** — server-side key management via Turnkey, so your agent never handles a private key.
- **A single bearer token** (`suwappu_sk_...`) that authenticates every request.
- **Three protocols** — REST, MCP (Model Context Protocol), and A2A (Agent-to-Agent) — all backed by the same engine.

## The core flow

Every swap follows the same four steps:

1. **Register** — `POST /v1/agent/register` returns your `api_key`. No auth required.
2. **Quote** — `POST /v1/agent/quote` returns a `quote_id` and pricing, valid for 60 seconds.
3. **Swap** — `POST /v1/agent/swap/execute` (managed wallet) submits the swap, or `POST /v1/agent/swap` returns an unsigned transaction for you to sign.
4. **Status** — `GET /v1/agent/swap/status/:swapId` polls until the swap completes.

## Base URL

```
https://api.suwappu.bot
```

All agent endpoints live under `/v1/agent`. Authenticate with `Authorization: Bearer suwappu_sk_...`.

## Next steps

| Page | Description |
|------|-------------|
| [Your First Swap](first-swap.md) | A full register → quote → swap → status walkthrough with curl |
| [SDK Examples](sdk-examples.md) | TypeScript examples using the `@suwappu/sdk` package |
| [Authentication](../authentication/README.md) | API keys, bearer tokens, and key rotation |
| [API Reference](../api-reference/README.md) | Every endpoint, parameter, and response shape |
