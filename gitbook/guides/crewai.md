# Build with CrewAI

Use CrewAI when a product benefits from **separate decision roles**, not just because multi-agent demos look impressive. A good Suwappu crew can split market evidence, independent risk review, and trade planning while keeping irreversible financial action in deterministic host code.

The production boundary is simple:

```text
agents: read -> quote -> simulate -> prepare -> structured plan
host:   persisted approval -> exact quote -> idempotent execute -> reconcile
```

No prompt should be able to cross that line by claiming “the user approved.”

## Version check first

This guide targets **CrewAI 1.15.x** and Python `>=3.10,<3.14`. CrewAI's current custom-tool API supports native async functions, so you do not need to wrap the async Suwappu Python SDK in thread pools.

The Suwappu Python SDK source contract used here is `0.3.x`. Package registries can lag the repository; for a reproducible evaluation, install the SDK directly from a merged core commit:

```bash
python -m pip install "crewai>=1.15,<2" "pydantic>=2.7,<3"
python -m pip install \
  "suwappu @ git+https://github.com/0xSoftBoi/suwappubot.git@09da700efa2cdaf4a3074e2ab8e2c61cbb22fdb7#subdirectory=packages/sdk-python"
```

Register a Suwappu agent if you do not already have an API key:

```bash
curl -X POST https://api.suwappu.bot/v1/agent/register \
  -H "Content-Type: application/json" \
  -d '{"name":"my-crewai-product"}'
```

Keep the returned `suwappu_sk_...` value server-side. CrewAI model-provider credentials belong server-side too.

## Decide whether three agents earn their keep

Each extra agent adds model cost and latency. Start with one model and split roles only when the separation creates measurable value.

| Need | Good shape |
|------|------------|
| One narrow portfolio or quote question | One agent or an MCP client |
| Evidence + independent risk challenge + exact plan | Three-agent Crew |
| Long-running branching state / human feedback | CrewAI Flow around a Crew |
| API submission, billing, authorization, accounting | Normal application code |

For the three-role design:

| Role | Responsibility | Authority |
|------|----------------|-----------|
| Market Analyst | Current prices, chain/token discovery, portfolio evidence | Read only |
| Risk Reviewer | Exposure, missing evidence, constraints, prior managed-swap history | Read only |
| Trade Planner | Quotes, simulation, unsigned self-custody preparation, exact candidate IDs | No broadcast |

Set a finite `max_iter` on each agent and measure actual model/tool usage. More agents are not free reliability.

## Wrap Suwappu with native async tools

CrewAI's current `@tool` decorator can wrap an async function directly. Keep each tool narrow and tell the model what authority it has.

```python
from crewai.tools import tool
from suwappu import create_client


@tool("Get swap quote")
async def get_quote(
    from_token: str,
    to_token: str,
    amount: float,
    chain: str = "",
    from_chain: str = "",
    to_chain: str = "",
    wallet_address: str = "",
) -> str:
    """Quote only. Same-chain uses chain; cross-chain uses from_chain/to_chain."""
    if amount <= 0:
        raise ValueError("amount must be positive")

    async with create_client() as client:
        quote = await client.get_quote(
            from_token,
            to_token,
            amount,
            chain or None,
            from_chain=from_chain or None,
            to_chain=to_chain or None,
            wallet_address=wallet_address or None,
        )
    return quote.model_dump_json()


@tool("Simulate swap")
async def simulate_swap(quote_id: str, wallet_address: str) -> str:
    """Dry-run only; never signs or broadcasts."""
    async with create_client() as client:
        result = await client.simulate_swap(
            quote_id=quote_id,
            wallet_address=wallet_address,
        )
    return result.model_dump_json()
```

The current SDK also exposes `prepare_swap()` for an unsigned self-custody transaction, `list_swaps()` for managed-swap history, `client.agent.list_wallets()` for managed-wallet discovery, and chain/token/price/portfolio reads.

Do **not** decorate `execute_managed_swap()` and hand it to every agent merely because it exists.

## Bind quotes to the wallet that will act

If a candidate will later be simulated, prepared, or managed-executed, quote against the actual wallet when possible:

```python
async with create_client() as client:
    wallets = await client.agent.list_wallets()
    if len(wallets) != 1:
        raise RuntimeError("Expected exactly one managed wallet")

    quote = await client.get_quote(
        "USDC",
        "ETH",
        100.0,
        "base",
        wallet_address=wallets[0].address,
    )

    simulation = await client.simulate_swap(
        quote_id=quote.quote_id,
        wallet_address=wallets[0].address,
    )
```

Cross-chain quotes use `from_chain` and `to_chain` instead of the same-chain `chain` argument. Quotes expire; do not treat a stale candidate as durable approval.

## Return a typed plan to your application

Free-form model prose is a poor API between your crew and your product. CrewAI tasks can validate their output into Pydantic models.

```python
from crewai import Agent, Crew, Process, Task
from pydantic import BaseModel, Field
from typing import Literal


class TradeCandidate(BaseModel):
    quote_id: str
    wallet_address: str | None = None
    simulation_would_execute: bool | None = None
    expires_in_seconds: int | None = None


class TradePlan(BaseModel):
    summary: str
    risk_notes: list[str] = Field(default_factory=list)
    candidates: list[TradeCandidate] = Field(default_factory=list)
    next_steps: list[str] = Field(default_factory=list)
    approval_required: Literal[True] = True
    executed: Literal[False] = False


planner = Agent(
    role="Trade Planner",
    goal="Build exact plans from fresh Suwappu quotes and simulations",
    tools=[get_quote, simulate_swap],
    max_iter=6,
    allow_delegation=False,
)

task = Task(
    description=(
        "Produce a non-broadcasting plan. Return exact quote ids. "
        "Set approval_required=true and executed=false."
    ),
    expected_output="A structured non-executing TradePlan",
    agent=planner,
    output_pydantic=TradePlan,
)

result = Crew(
    agents=[planner],
    tasks=[task],
    process=Process.sequential,
).kickoff()

plan = result.pydantic
```

The literal types make model output that claims approval is unnecessary or execution already happened fail validation instead of silently becoming application state. In a three-agent Crew, pass analyst and risk-task outputs into the final planner task as explicit `context`. The authority boundary stays the same.

## Managed execution is a host operation

After the Crew returns, your application can display a candidate and store an approval. Bind the approval to the **exact quote** and a durable intent ID.

The following uses an application-defined `approvals` store on purpose: authorization must live outside the model context.

```python
async def submit_approved_quote(*, quote_id: str, intent_id: str):
    approval = await approvals.require_approved(intent_id)  # your database/service
    if approval.quote_id != quote_id:
        raise RuntimeError("approval does not match this quote")

    async with create_client() as client:
        wallets = await client.agent.list_wallets()
        if len(wallets) != 1:
            raise RuntimeError("managed-wallet state is ambiguous")

        simulation = await client.simulate_swap(
            quote_id=quote_id,
            wallet_address=wallets[0].address,
        )
        if not simulation.would_execute:
            raise RuntimeError("simulation rejected the approved quote")

        return await client.execute_managed_swap(
            quote_id,
            idempotency_key=intent_id,
        )
```

The idempotency key must be stable for the intended economic action. Do not generate a new current-time key when retrying.

If you build self-custody instead, let the agent call `prepare_swap()` and pass the unsigned transaction to the customer's wallet for review/signing. MCP `execute_swap` follows that **unsigned self-custody** authority model too; it is not managed broadcast.

## A failed request can have an unknown outcome

Once managed submission begins, a timeout, network failure, or 5xx does not prove that nothing happened.

For an outcome-unknown request:

1. keep the original intent and idempotency key;
2. reconcile the returned/known `swap_id` through `GET /v1/agent/swap/status/:id`, managed history, or a [signed webhook](webhook-setup.md);
3. retry only if reconciliation says it is needed; and
4. reuse the same key for the same intended trade.

Example status reconciliation:

```bash
curl https://api.suwappu.bot/v1/agent/swap/status/4812 \
  -H "Authorization: Bearer $SUWAPPU_API_KEY"
```

Keep a product intent ledger separate from the execution/chain ledger. Model output, a quote, and a successful simulation are not fills.

## A product ladder that can make money

The easiest way to commercialize this stack is to sell a useful decision workflow before selling autonomy.

### Free evidence

- connect/read a wallet;
- produce a current allocation or route/risk brief;
- get the user to a real wallet-bound quote;
- measure `first_quote`, not just “chat opened.”

### Paid workflow

- saved allocation or treasury policies;
- recurring analysis and alerts;
- team review/approval;
- historical decision records;
- exports, webhooks, or integration into the customer's workflow.

You can charge for this tier with **zero model execution authority**.

### Optional action tier

Only after the product reliably reaches quote + simulation:

```text
evidence -> deterministic rule -> quote -> simulate
        -> stored exact approval -> idempotent execute -> reconcile
```

See [Strategy Lifecycle](strategy-lifecycle.md) before turning a decision product into unattended trading automation.

## Measure multi-agent economics honestly

A three-agent run can make several model calls before the customer gets value. Track the whole contribution margin:

```text
builder margin per run
  = customer revenue attributed to the run
  - analyst model cost
  - risk-review model cost
  - planner model cost
  - Suwappu/API cost
  - infrastructure cost
  - support/refund/loss budget
```

If the risk-review step rarely changes an outcome, remove it. If a single-agent implementation retains users equally well, prefer the simpler product.

Keep customer strategy P&L in a different ledger. Read [Build a Business on Suwappu](build-a-business.md) for the complete customer-billing and builder-margin boundary.

## CrewAI vs LangChain vs hosted MCP

| Surface | Pick it when |
|---------|--------------|
| CrewAI | Role separation or a Crew/Flow workflow is itself useful to the product |
| [LangChain adapter](langchain.md) | You want a narrow LangChain-native schema/toolkit and application approval callback |
| [Hosted MCP](../protocols/mcp.md) | Your runtime already speaks MCP and needs the broader Suwappu tool catalog |

CrewAI itself can consume MCP servers. If you use Suwappu that way, `https://api.suwappu.bot/mcp` is the hosted endpoint. The same financial-authorization rule still applies: tool discovery is not approval.

## Production checklist

- Verify the CrewAI and Suwappu SDK versions you actually deploy.
- Give each agent the smallest tool allowlist its role needs.
- Bound agent iterations and record model/tool costs.
- Use structured final output rather than parsing prose downstream.
- Bind quotes to the acting wallet and simulate before live action.
- Keep managed execution outside the model tool surface unless your host implements an equivalent hard approval boundary.
- Persist approval, exact quote ID, and one durable idempotency key per intended action.
- Treat network/5xx submission failures as outcome-unknown and reconcile before retrying.
- Store product revenue/cost and customer strategy P&L in separate ledgers.
- Make `first real quote -> retained use` a product metric; do not optimize only for conversations.

The maintained CrewAI satellite is currently private. This guide is deliberately self-contained so public builders do not depend on an inaccessible clone; a source link should be added here only when that repository's visibility is intentionally changed after a history/security review.
