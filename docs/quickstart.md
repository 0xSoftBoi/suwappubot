# Suwappu Quickstart

Choose the shortest path for what you are trying to do. You do **not** need to run the
whole monorepo to use Suwappu or integrate an agent.

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

The response includes a `suwappu_sk_...` credential. Store it as
`SUWAPPU_API_KEY`; never commit it.

### 2. Connect to hosted MCP

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

Then call `tools/list` at runtime. Do not hard-code the catalog from a README: tools,
resources, prompts, chain support, and auth requirements can evolve.

### 3. Start read-only

A safe first integration should discover chains/tokens, request prices or quotes, and
simulate before enabling any money-moving capability.

The current hosted MCP semantics matter:

- `execute_swap` **prepares an unsigned self-custody transaction**.
- Managed server-side execution is a separate REST capability:
  `POST /v1/agent/swap/execute`.
- A2A has **no execution method** today; natural-language `swap ...` requests return a
  quote.

Continue to [Build on Suwappu: MCP, SDK, REST, and A2A](agent-clients.md) for client
configuration, protocol negotiation, current tool semantics, and the security baseline.

## Build an application

### TypeScript SDK

Install the published package:

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

Repository source can be ahead of the npm release. Check
[`packages/sdk/README.md`](../packages/sdk/README.md) and
[agent-clients.md](agent-clients.md#typescript-sdk) before relying on a source-only API.

### Python SDK

The Python SDK is source-only today. For production use, pin a commit instead of tracking
`main` blindly:

```bash
pip install "suwappu @ git+https://github.com/0xSoftBoi/suwappubot.git@main#subdirectory=packages/sdk-python"
```

See [`packages/sdk-python/README.md`](../packages/sdk-python/README.md) and
[agent-clients.md](agent-clients.md#python-sdk) for the current API and custody split.

### REST

The Agent REST API is the lowest-level integration surface. A useful first request after
registration is chain discovery:

```bash
curl https://api.suwappu.bot/v1/agent/chains \
  -H "Authorization: Bearer $SUWAPPU_API_KEY"
```

Do not use a README's chain count as an application registry. Discover supported chains
at runtime with `GET /v1/agent/chains`, MCP `list_chains`, or the SDK.

For execution semantics, use the [Agent REST custody map](agent-clients.md#agent-rest-custody-map).

## Use A2A

Discover the public Agent Card:

```bash
curl https://api.suwappu.bot/.well-known/agent.json
```

A2A is intentionally a natural-language quote/price/discovery surface today. It does not
provide a fund-moving execution method. See [A2A 0.3](agent-clients.md#a2a-03).

## Run the repository locally

You only need this path if you are contributing to Suwappu itself.

### 1. Inspect your environment

```bash
python3 scripts/doctor.py
```

`doctor.py` evaluates the capability/configuration contract rather than assuming every
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
[`CONVENTIONS.md`](../CONVENTIONS.md), and any directory-local agent instructions.

## Money-moving safety checklist

Before enabling managed execution in an application or agent:

1. Keep `SUWAPPU_API_KEY` out of source and logs.
2. Maintain an application-owned allowlist of callable tools/capabilities.
3. Treat discovered annotations as metadata, not authorization.
4. Simulate unfamiliar routes before executing.
5. Keep self-custody transaction preparation/signing separate from managed execution.
6. Require explicit policy/user approval for fund-moving calls.
7. Treat model-generated trade ideas as untrusted input to your policy layer.

Next: [Agent clients](agent-clients.md) · [Architecture](architecture/OVERVIEW.md) ·
[Features](features/README.md) · [Contributing](../CONTRIBUTING.md)
