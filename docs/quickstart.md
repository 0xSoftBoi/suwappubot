# Suwappu Quickstart

Use this page for a first successful Suwappu interaction. It intentionally skips deep
architecture and exhaustive client options; those live in the linked reference docs.

## Execution authority at a glance

Start with the lowest level your product needs.

| Level | Capability | Moves funds? |
|---|---|---:|
| **0 — Discover** | Chains, tokens, prices, markets, portfolio metadata | No |
| **1 — Quote** | Price an intent / compare routes | No |
| **2 — Simulate** | Evaluate a transaction | No |
| **3 — Prepare** | Return unsigned self-custody transaction data | No |
| **4 — Managed execute** | Server-side managed execution | **Yes** |

See [Product Status](product-status.md) for maturity and
[Agent Clients](agent-clients.md) for method-level custody semantics.

## Use Suwappu without code

- **Terminal:** https://terminal.suwappu.bot
- **Telegram:** https://t.me/SuwappuBot
- **Product / research:** https://www.suwappu.bot

For specific workflows, continue to [Feature Guides](features/README.md).

## Build an agent

### 1. Register a credential

```bash
curl -X POST https://api.suwappu.bot/v1/agent/register \
  -H 'Content-Type: application/json' \
  -d '{"name":"my-agent"}'
```

Store the returned `suwappu_sk_...` as `SUWAPPU_API_KEY`. Never commit or log it.

### 2. Prove read-only access

```bash
curl https://api.suwappu.bot/v1/agent/chains \
  -H "Authorization: Bearer $SUWAPPU_API_KEY"
```

Success means you receive the currently supported Agent API chain set. Discover this at
runtime rather than embedding a count in your application.

### 3. Connect hosted MCP

```json
{
  "mcpServers": {
    "suwappu": {
      "url": "https://api.suwappu.bot/mcp",
      "headers": {
        "Authorization": "Bearer suwappu_sk_..."
      }
    }
  }
}
```

Discover tools/resources/prompts at runtime. For an AI system, begin with an
application-owned allowlist of Levels 0–2.

**Authority note:** MCP `execute_swap` is Level 3: it prepares an unsigned self-custody
transaction. Managed execution is a separate Level 4 REST/managed-SDK capability. A2A
currently stops at discovery/quote semantics.

Continue to [Agent Clients](agent-clients.md) for client configuration and the security
baseline.

## Build an application

Install the TypeScript SDK:

```bash
npm install @suwappu/sdk
```

Request a quote:

```ts
import { Suwappu } from "@suwappu/sdk";

const client = new Suwappu({
  apiKey: process.env.SUWAPPU_API_KEY,
});

const quote = await client.getQuote({
  from: "USDC",
  to: "ETH",
  chain: "base",
  amount: "100",
});

console.log(quote.toAmount);
```

Success means you receive a quote; no managed execution has occurred.

Repository source can be ahead of npm. Check the
[SDK README](../packages/sdk/README.md) and [Product Status](product-status.md) before
using source-only APIs.

The Python SDK is source-only today. For production, pin a reviewed commit rather than
tracking `main`; see the [Python SDK README](../packages/sdk-python/README.md).

## Work on the monorepo

Only contributors need the local stack. Start with:

```bash
python3 scripts/doctor.py
```

Then follow [ONBOARDING.md](ONBOARDING.md) for component-specific setup and test lanes.
Configuration contracts live in [`.env.schema`](../.env.schema) and
[`capabilities.yaml`](../capabilities.yaml).

For documentation-only changes:

```bash
./scripts/verify.sh docs
```

## Before enabling money movement

- Keep credentials out of source and logs.
- Use an application-owned capability allowlist; tool discovery is not authorization.
- Simulate unfamiliar routes before execution.
- Keep self-custody signing separate from managed execution.
- Add explicit spend/value/destination policy and approval before Level 3 or 4 access.
- Treat model-generated trade ideas and third-party text as untrusted policy input.

Next: [Agent Clients](agent-clients.md) · [Product Status](product-status.md) ·
[Architecture](architecture/OVERVIEW.md)
