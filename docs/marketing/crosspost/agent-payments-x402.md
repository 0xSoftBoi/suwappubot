---
title: "A swap API that AI agents can pay for one call at a time"
audience: AI agent builders, x402/agentic-commerce ecosystem, stablecoin infra teams, MCP directory audiences
status: draft
topic_status: hosted/live per docs/product-status.md ("Agent REST" and "Hosted MCP" = Hosted)
---

## Sources (every number below is traceable)

- `showcase/src/data/stats.generated.json` — `agentApiChains: 18`, `routerCount: 21`, `mcpToolCount: 22` (generated; per `docs/README.md` this file is the source of truth for these counts, not hand-written copy)
- `docs/distribution/registry-listings.md` — pricing table, x402 payment flow, example calls
- `docs/product-status.md` — execution authority ladder (Discover/Quote/Simulate/Prepare/Managed execute); MCP `execute_swap` = Level 3, not managed execution
- `docs/quickstart.md` — `POST /v1/agent/register`, `GET /v1/agent/chains`, MCP connection config
- `api-ts/src/services/FacilitatorService.ts` — x402 facilitator gating (`X402_FACILITATOR_ENABLED`)

---

## A. Long-form (blog / Mirror)

**Title: We priced a swap API in USDC per call, not per month, because agents don't have a credit card**

Most APIs are built for a human who signs up, enters a card, and gets a monthly invoice. An autonomous agent holding a wallet doesn't have any of that — it has a balance and a task. So we metered the Suwappu agent API in x402: pay-per-call in USDC on Base, no API key required just to pay, no subscription required to transact.

The pricing is boring on purpose, which is the point: a quote (`get_quote` / `POST /v1/agent/quote`) costs $0.001, a balance or price read costs $0.001, a dry-run simulation costs $0.001, and an actual execute-swap call costs $0.005. Supported-chains and supported-tokens discovery is free with no auth at all. When an agent's prepaid credit runs low, any metered endpoint responds with a standard HTTP 402 and an x402 `accepts` array — any standard x402 client (`x402-fetch`, `x402-axios`, `@x402/core`) parses that and retries with a signed payment header automatically. No custom integration.

Underneath the metering is real routing infrastructure: 21 routing integrations (0x, 1inch, Across, CCTP, CoW, Jupiter, KyberSwap, Li.Fi, LayerZero, Wormhole and others — full list in `showcase/src/data/stats.generated.json`) racing quotes across a currently-18-chain agent API surface, exposed as 22 MCP tools over a hosted Streamable-HTTP endpoint (`https://api.suwappu.bot/mcp`) as well as plain REST (`/v1/agent/*`).

One thing we're careful to say correctly because it matters for custody: MCP's `execute_swap` tool prepares an unsigned self-custody transaction — it does not move funds on its own. Managed execution, where Suwappu's infrastructure actually signs and broadcasts, is a separate, explicit REST endpoint (`/v1/agent/swap/execute`) that an agent opts into deliberately. We built the naming this way specifically so a tool name never implies more authority than the call actually has.

If you're building an agent that needs to rebalance across chains without holding a standing subscription, the entry point is `POST /v1/agent/register` (free, instant, no approval queue) and then either REST or MCP from there.

## B. X/Twitter thread

1/ We priced our swap API the way an agent actually pays: per call, in USDC, via x402. No monthly plan required, no card, no API key needed to pay. 🧵

2/ Pricing (from `docs/distribution/registry-listings.md`): quote $0.001, balance/price read $0.001, simulate $0.001, execute swap $0.005. Chain/token discovery: free, no auth.

3/ Under the hood: 21 routing integrations racing quotes across an 18-chain agent API surface (source: `stats.generated.json`, regenerated from live discovery — not a hand-typed number).

4/ Out of credit? Any metered call returns a standard HTTP 402 with an x402 `accepts` payload. Standard clients (x402-fetch, x402-axios) parse it and retry with payment automatically. Zero custom integration code.

5/ Exposed two ways: REST (`/v1/agent/*`) and hosted MCP (`https://api.suwappu.bot/mcp`, 22 tools, Streamable HTTP/JSON-RPC 2.0). Four discovery tools need no auth at all.

6/ Important custody detail: MCP `execute_swap` prepares an unsigned tx — it does not move funds. Actual managed execution is a separate, explicit REST call (`/swap/execute`) an agent opts into. We don't let a tool name imply authority it doesn't have.

7/ Start here: `POST /v1/agent/register` — free, instant, no approval queue. Docs: suwappu.bot/docs/protocols/mcp

## C. LinkedIn

**Agents don't have credit cards. So we priced our swap API per call.**

The standard SaaS model — sign up, enter a card, get billed monthly — assumes a human with a bank relationship. An autonomous agent has a wallet and a task. We built the Suwappu agent API around that reality: x402-metered, pay-per-call in USDC on Base, with no API key required just to pay and no subscription required to transact at all.

Concretely: a price quote costs $0.001, a portfolio read costs $0.001, a dry-run simulation costs $0.001, an executed swap costs $0.005, and discovering supported chains/tokens is free with no authentication. When an agent's balance runs low, the API returns a standard HTTP 402 with a machine-readable payment offer that any x402-compliant client already knows how to satisfy — we didn't invent a custom billing protocol.

Behind the pricing is real infrastructure: 21 routing integrations quoting across an 18-chain agent-facing surface (both numbers generated from live discovery, not hand-maintained copy), exposed over REST and a hosted MCP server with 22 tools.

One custody detail we're precise about: the MCP `execute_swap` tool prepares an unsigned self-custody transaction — it doesn't move funds by itself. Actual managed execution is a separate endpoint an agent has to call explicitly. Tool names should never imply more authority than the call grants.

If your agent stack needs cross-chain liquidity without a standing subscription: `POST /v1/agent/register` is free and instant.

## D. SEO title/description

- **Title:** x402 Pay-Per-Call Swap API for AI Agents — Suwappu Agent API
- **Description:** Suwappu's agent API is metered per call in USDC via x402: quotes at $0.001, swaps at $0.005, free chain/token discovery. 21 routing integrations across 18 chains, exposed via REST and hosted MCP.

## What we deliberately did not claim

- Did not round "18 chains" up to a marketing number — used the generated stats file, which per `docs/README.md` is the sourced-of-record over hand-written counts (note: `docs/distribution/registry-listings.md` itself still says "14+ chains" in one spot — that line is stale versus the generated stats and should not be reused; this package uses the generated 18).
- Did not describe MCP `execute_swap` as fund-moving — verified against `docs/product-status.md`'s execution authority ladder before writing anything about custody.
- Did not claim managed execution is agent-approval-free or risk-free — did not address it at all in this package since it's out of scope for the payments story.
- Did not claim a specific uptime/SLA for the hosted MCP endpoint — not found in the docs reviewed.
