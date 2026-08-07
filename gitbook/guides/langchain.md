# Build with LangChain

Use [`@suwappu/langchain-suwappu`](https://github.com/0xSoftBoi/suwappu-langchain) when you want Suwappu inside a LangChain/LangGraph application with a deliberately small, schema-defined tool allowlist.

The adapter is designed around one boundary: **a model may research, quote, simulate, and prepare by default; managed-wallet broadcast is a separate host capability.**

## Version check first

This guide targets the **0.2.x** adapter on the repository's `main` branch. The npm registry can lag source, so verify before copying the examples:

```bash
npm view @suwappu/langchain-suwappu version
```

Use the examples below when that prints `0.2.x` or newer. If the registry is still on `0.1.x`, do not pretend it has the 0.2 execution/schemas contract. For pre-release evaluation, build and pack the repository explicitly:

```bash
git clone https://github.com/0xSoftBoi/suwappu-langchain.git
cd suwappu-langchain
npm ci
npm run verify
npm pack
```

Then install the resulting `.tgz` into your test application. `npm run verify` also installs that packed artifact into a clean Node consumer, so the package boundary is tested rather than assumed.

## Install

The 0.2 adapter targets Node 20+ and LangChain 1.x:

```bash
npm install @suwappu/langchain-suwappu langchain @langchain/core
```

Add the model integration your application uses separately, such as `@langchain/openai`.

Register a Suwappu agent if you do not already have a key:

```bash
curl -X POST https://api.suwappu.bot/v1/agent/register \
  -H "Content-Type: application/json" \
  -d '{"name":"my-langchain-product"}'
```

Keep the returned `suwappu_sk_...` value server-side.

## Start with the nine safe tools

```ts
import { SuwappuToolkit } from "@suwappu/langchain-suwappu";

const toolkit = new SuwappuToolkit({
  apiKey: process.env.SUWAPPU_API_KEY!,
});

const tools = toolkit.getTools();
console.log(tools.map((tool) => tool.name));
```

Every 0.2 tool has a Zod-backed structured input schema; the model does not need to format JSON inside a string.

| Tool | Authority |
|------|-----------|
| `suwappu_get_quote` | Quote only; same-chain or cross-chain |
| `suwappu_simulate_swap` | Dry-run only |
| `suwappu_prepare_swap` | Returns an unsigned self-custody transaction |
| `suwappu_get_portfolio` | Read only |
| `suwappu_get_prices` | Read only |
| `suwappu_list_chains` | Read only |
| `suwappu_list_tokens` | Read only |
| `suwappu_get_swap_status` | Read a managed-swap record |
| `suwappu_get_swap_history` | Read managed-swap records |

`suwappu_execute_swap` is not in the default set.

## Use the current LangChain agent harness

The adapter follows LangChain 1.x's `createAgent` model. You can use its helper:

```ts
import { ChatOpenAI } from "@langchain/openai";
import { createSuwappuAgent } from "@suwappu/langchain-suwappu";

const agent = await createSuwappuAgent({
  apiKey: process.env.SUWAPPU_API_KEY!,
  model: new ChatOpenAI({ model: process.env.OPENAI_MODEL! }),
});

const result = await agent.invoke({
  messages: [{
    role: "user",
    content: "Quote 100 USDC from Arbitrum to ETH on Base for wallet 0x..., then simulate it.",
  }],
});
```

Or pass `toolkit.getTools()` to your own `createAgent`, LangGraph graph, middleware stack, or evaluator.

## Cross-chain quotes are structured

The quote schema exposes same-chain `chain` as well as `from_chain` / `to_chain`, plus optional wallet binding and slippage. A direct tool invocation looks like:

```ts
const quoteTool = toolkit.getTools().find(
  (tool) => tool.name === "suwappu_get_quote",
)!;

const quote = await quoteTool.invoke({
  from_token: "USDC",
  to_token: "ETH",
  amount: 100,
  from_chain: "arbitrum",
  to_chain: "base",
  wallet_address: "0x...",
  slippage: 0.02,
});
```

Use the returned quote and live cost fields as the economic source of truth. Quotes expire; get a fresh one before acting.

## Make the transport observable and bounded

The 0.2 adapter is also an operational boundary, not just a collection of tools. Every request has a 30-second deadline by default. Set a tighter deadline when your own SLO requires it and forward the metadata-only event hook into your metrics/tracing layer:

```ts
const toolkit = new SuwappuToolkit({
  apiKey: process.env.SUWAPPU_API_KEY!,
  requestTimeoutMs: 15_000,
  onApiEvent: (event) => {
    metrics.observe("suwappu_api_request", {
      method: event.method,
      path: event.path,
      outcome: event.outcome,
      status: event.status,
    }, event.durationMs);
  },
});
```

The hook receives method, normalized path, outcome, duration, optional status, and optional request/correlation ID. It never receives authorization headers or request/response bodies. Do not add wallet addresses, quote IDs, swap IDs, or prompt contents as metric labels in your own wrapper.

Failures are typed so your product can make an explicit decision:

| Error | Meaning | Normal product behavior |
|------|---------|-------------------------|
| `SuwappuApiError` | Suwappu returned a non-2xx HTTP response | Respect status/code; use `retryAfterMs` for rate-limit scheduling where appropriate |
| `SuwappuTransportError` | Deadline or network failure | Retry safe reads if your policy allows; managed execution becomes outcome-unknown |
| `SuwappuProtocolError` | A critical 2xx response was malformed | Alert/investigate; managed execution becomes outcome-unknown |

There is deliberately no blanket automatic retry around the API. Reads, quotes, and money movement have different retry semantics.

## Managed execution requires application approval

If you need Suwappu's managed wallet to sign/broadcast, the host must turn on the capability **and** supply a callback. That callback is application code outside the prompt; use it to check persisted human approval, simulation, wallet/policy state, and a durable trade intent.

```ts
const liveToolkit = new SuwappuToolkit({
  apiKey: process.env.SUWAPPU_API_KEY!,
  enableManagedExecution: true,
  approveManagedExecution: async ({ quoteId }) => {
    const intent = await intents.findByQuoteId(quoteId);

    if (!intent?.simulationPassed) throw new Error("simulation missing");
    if (!intent.approvedAt) throw new Error("approval missing");
    if (intent.policyDecision !== "allow") throw new Error("policy denied");

    // This ID was persisted before submission and is stable across retries.
    return { idempotencyKey: intent.id };
  },
});
```

Prompt text such as "the user approved" is not approval state. The callback must be able to reject the call even when the model requests execution.

The adapter sends the returned intent id as `Idempotency-Key`. The API accepts 1–64 characters from `A-Z a-z 0-9 _ . : -`.

## Treat execution timeouts as outcome-unknown

Do not convert a timeout into a second trade.

For a timeout/network failure, HTTP 408, 5xx response, or malformed success response on managed execution:

1. keep the original durable intent;
2. mark the outcome unknown;
3. reconcile `suwappu_get_swap_status`, `suwappu_get_swap_history`, or your [signed webhook](webhook-setup.md) ledger;
4. only retry if reconciliation says it is necessary;
5. reuse the same intent/idempotency key.

That is why status/history belong in the default read-only tool surface even though live execution does not.

## A product you can charge for: portfolio copilot

Do not start by giving the model a wallet. Start by proving customer value.

### Free acquisition loop

- read a wallet portfolio;
- compute allocation/concentration deterministically;
- let the model explain the result;
- offer saved targets and monitoring as the upgrade.

### Paid monitoring loop

- store customer target bands;
- periodically read portfolio/prices;
- calculate drift in application code;
- request a fresh quote only when drift crosses the rule;
- show route, expected/minimum output, and estimated costs;
- alert and retain the decision/audit history.

This can be a paid product with **zero execution authority**.

### Optional automation tier

Only after the paper/monitoring path is reliable:

```text
read -> deterministic decision -> quote -> simulate
     -> stored approval/policy -> idempotent execute -> reconcile -> ledger
```

Follow [Strategy Lifecycle](strategy-lifecycle.md) for replay -> paper -> capped-live promotion rather than jumping directly from a prompt demo to unattended capital.

## Keep the two money ledgers separate

Your customer paying for the copilot is not trading P&L.

```text
builder margin
  = customer revenue
  - Suwappu/API + model + infrastructure + subsidized chain/support costs

strategy net P&L
  = realized/mark-to-market result
  - venue fees - gas - bridge fees - realized slippage
```

Suwappu x402/API payments are a cost to your product, not automatic builder revenue. The public Agent API does not currently promise a generic third-party `builder_fee`. Read [Build a Business on Suwappu](build-a-business.md) and [Pricing](../billing/pricing.md) before deciding what to charge.

## LangChain toolkit vs hosted MCP

Choose the dedicated adapter when you want a narrow LangChain-native schema surface and application-controlled execution gate. Choose the [hosted MCP](../protocols/mcp.md) when your stack already speaks MCP and needs the broader 22-tool catalog, including prediction, perps research, lending, or wallet-policy reads.

MCP `execute_swap` has a different authority boundary: despite its historical name it prepares an **unsigned self-custody transaction**; it does not broadcast a managed swap. Do not equate it with LangChain's optional `suwappu_execute_swap`, which maps to managed REST execution.

## Production checklist

- Pin/observe the adapter and API version you deploy.
- Set an application deadline and collect the adapter's metadata-only request events.
- Rate-limit and queue per tenant; reserve capacity for execution reconciliation.
- Alert on sustained API error/timeout/protocol-error rates and reconciliation backlog.
- Keep the model's tool allowlist as small as the product needs.
- Keep managed execution disabled for research/advisor products.
- Get fresh, wallet-bound quotes where relevant and simulate before live action.
- Persist approvals/policies outside prompt text.
- Persist one durable idempotency key per intended trade.
- Reconcile every submitted/unknown managed action.
- Gate model/prompt/tool changes on regression evals before promotion to live money.
- Separate builder margin from customer strategy results.
- Run the adapter's `npm run verify` before publishing/forking changes.

For tenant isolation, SLO/alert suggestions, retry policy, deployment/rollback, and the live-money incident runbook, read the adapter's [Operations guide](https://github.com/0xSoftBoi/suwappu-langchain/blob/main/docs/OPERATIONS.md).

Source, product blueprint, and deeper adapter examples: [`0xSoftBoi/suwappu-langchain`](https://github.com/0xSoftBoi/suwappu-langchain).
