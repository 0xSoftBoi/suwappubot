# Quick Start

Suwappu is a cross-chain DeFi API built for AI agents. The safest onboarding path gets you to a useful quote with **zero capital at risk**, then makes you choose custody before an execution path appears.

## What you get

- cross-chain token discovery and best-route quotes across 40+ supported networks;
- `POST /swap/simulate` for a zero-funds execution preflight;
- managed wallets for server-side signing, or unsigned self-custody transaction preparation;
- REST, MCP, and A2A interfaces with different authority levels;
- policy, approval, audit, idempotency, and kill-switch primitives for production agents.

## The core swap lifecycle

1. **Register** — `POST /v1/agent/register` returns your API key. No auth required.
2. **Choose custody** — create/fund a managed wallet, or supply a self-custody address that you control.
3. **Quote** — `POST /v1/agent/quote` returns a short-lived `quote_id`; bind it to the intended wallet when you will simulate/prepare it.
4. **Simulate** — `POST /v1/agent/swap/simulate` moves zero funds and returns `would_execute`, costs, checks, and warnings.
5. **Act explicitly** — managed `POST /v1/agent/swap/execute` signs/broadcasts; self-custody `POST /v1/agent/swap` only returns an unsigned transaction.
6. **Reconcile** — managed execution returns a `swap_id` for status/webhook reconciliation. A self-custody caller tracks the transaction it signed/submitted itself.

MCP's historical `execute_swap` tool belongs to the **self-custody preparation** side of that diagram; it does not broadcast. A2A stops at quote/price/discovery.

## Base URL

```text
https://api.suwappu.bot
```

All Agent API endpoints live under `/v1/agent`. Authenticated calls use `Authorization: Bearer suwappu_sk_...`.

## Next steps

| Page | Description |
|------|-------------|
| [Your First Swap](first-swap.md) | Managed-wallet quote -> simulation -> explicit execution -> reconciliation |
| [SDK Examples](sdk-examples.md) | Current `@suwappu/sdk` source contract and registry-version caveat |
| [MCP Client Setup](mcp-clients.md) | Hosted MCP configuration and unsigned preparation boundary |
| [Strategy Lifecycle](../guides/strategy-lifecycle.md) | Replay -> paper -> capped-live promotion |
| [Build a Business](../guides/build-a-business.md) | Builder revenue models and unit economics |
