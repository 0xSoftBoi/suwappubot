# Suwappu Quickstart

Choose the shortest path for what you are trying to do. You do **not** need to run the
whole monorepo to use Suwappu or integrate an agent.

Before enabling execution, understand the platform's authority ladder:

| Level | Capability | Moves funds? |
|---|---|---:|
| **0 — Discover** | Chains, tokens, prices, markets, portfolio metadata | No |
| **1 — Quote** | Price an intent / compare routes | No |
| **2 — Simulate** | Evaluate a transaction | No |
| **3 — Prepare** | Return unsigned self-custody transaction data | No |
| **4 — Managed execute** | Server-side managed execution | **Yes** |

Start at the lowest level your product needs. See [Product Status](product-status.md) for
maturity semantics and [Agent Clients](agent-clients.md) for method-level custody behavior.

## Use Suwappu

No code required:

- **Terminal:** https://terminal.suwappu.bot
- **Telegram:** https://t.me/SuwappuBot
- **Product / research directory:** https://www.suwappu.bot

For feature-specific workflows, continue to [Features](features/README.md).

## Build an agent

### 1. Register an agent credential

```bash
curl -X POST https://api.suwappu.bot/v1/agent/register \
  -H 'Content-Type: application/json' \
  -d '{"name":"my-agent"}'
```

The response includes a `suwappu_sk_...` credential. Store it as `SUWAPPU_API_KEY`; never
commit or log it.

### 2. Prove read-only access first

```bash
curl https://api.suwappu.bot/v1/agent/chains \
  -H "Authorization: Bearer $SUWAPPU_API_KEY"
```

Do not use a README's chain count as an application registry. Discover chains at runtime
with Agent REST, MCP `list_chains`, or the SDK.

### 3. Connect to hosted MCP

Use the hosted endpoint whenever your client supports Streamable HTTP:

```text
https://api.suwappu.bot/mcp
```

Example MCP configuration:

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

Call `tools/list` at runtime. Do not hard-code the catalog from documentation: tools,
resources, prompts, chain support, and auth requirements can evolve.

### 4. Stay least-privilege until execution is required

The naming boundary matters:

- MCP `execute_swap` is **Level 3**: it prepares an unsigned self-custody transaction.
- Managed server-side execution is **Level 4** and uses an explicit REST/managed SDK path.
- A2A currently stops at discovery/quote semantics and has no Level 3/4 method.

For an AI system, begin with an application-owned allowlist of Level 0–2 capabilities.
Only add transaction preparation or managed execution with explicit policy appropriate to
the value at risk.

Continue to [Build on Suwappu: MCP, SDK, REST, and A2A](agent-clients.md).

## Build an application

### TypeScript SDK

```bash
npm install @suwappu/sdk
```

Read-only start:

```ts
import { Suwappu } from "@suwappu/sdk";

const client = new Suwappu({
  apiKey: process.env.SUWAPPU_API_KEY,
});

const chains = await client.listChains();
console.log(chains);
```

Then request a quote:

```ts
const quote = await client.getQuote({
  from: "USDC",
  to: "ETH",
  chain: "base",
  amount: "100",
});

console.log(quote.toAmount);
```

Repository source can be ahead of the npm release. Check
[`packages/sdk/README.md`](../packages/sdk/README.md), [Product Status](product-status.md),
and [agent-clients.md](agent-clients.md) when version boundaries matter.

### Python SDK

The Python SDK is source-only today. Pin a commit for production instead of tracking
`main` blindly:

```bash
pip install "suwappu @ git+https://github.com/0xSoftBoi/suwappubot.git@main#subdirectory=packages/sdk-python"
```

See [`packages/sdk-python/README.md`](../packages/sdk-python/README.md) and
[agent-clients.md](agent-clients.md) for the current API and custody split.

### REST

Agent REST is the lowest-level integration surface. It keeps preparation and managed
execution separate:

- `POST /v1/agent/swap` — prepare unsigned self-custody transaction data.
- `POST /v1/agent/swap/execute` — explicit managed execution.

Use [Agent Clients](agent-clients.md) as the authoritative method/custody map.

## Use A2A

Discover the public Agent Card:

```bash
curl https://api.suwappu.bot/.well-known/agent.json
```

A2A is intentionally a natural-language quote/price/discovery surface today. It does not
provide fund-moving execution. See [Agent Clients](agent-clients.md).

## Run the repository locally

You only need this path if you are contributing to Suwappu itself.

### 1. Inspect your environment

```bash
python3 scripts/doctor.py
```

`doctor.py` evaluates the capability/configuration contract instead of assuming every
optional integration is configured locally.

### 2. Start the component you need

TypeScript API:

```bash
cd api-ts
bun install
bun run dev
```

Python API / bot:

```bash
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn api.main:app --host 0.0.0.0 --port 8000 --reload
```

Webapp:

```bash
cd webapp
npm install
npm run dev
```

Configuration belongs in local environment files. Use [`.env.schema`](../.env.schema)
and [`capabilities.yaml`](../capabilities.yaml) as the contract; do not copy secrets or
stale environment blocks from a deployment note.

### 3. Verify before opening a PR

For documentation-only changes:

```bash
./scripts/verify.sh docs
```

For component-specific code changes, follow [ONBOARDING.md](ONBOARDING.md), the root
[`CONVENTIONS.md`](../CONVENTIONS.md), and directory-local agent instructions.

## Money-moving safety checklist

Before enabling Level 3 or 4 capabilities:

1. Keep `SUWAPPU_API_KEY` out of source and logs.
2. Maintain an application-owned allowlist of callable tools/capabilities.
3. Treat discovered annotations as metadata, not authorization.
4. Simulate unfamiliar routes before execution.
5. Keep self-custody signing separate from managed execution.
6. Enforce explicit spend/value/destination policy and user/application approval.
7. Treat model-generated trade ideas and third-party text as untrusted policy input.

Next: [Product Status](product-status.md) · [Agent Clients](agent-clients.md) ·
[Architecture](architecture/OVERVIEW.md) · [Features](features/README.md) ·
[Contributing](../CONTRIBUTING.md)
