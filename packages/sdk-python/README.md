# suwappu — Python SDK

Async Python client for the [Suwappu](https://suwappu.bot) agent API: quotes,
custody-aware swaps, portfolios, prices, perps, prediction markets, lending, and
agent controls. Call `list_chains()` to discover the current chain set.

> **Version check:** this repository describes Python SDK source `0.3.0`.
> Check `python -m pip index versions suwappu` before relying on PyPI; if the
> package/version is unavailable, install the source as shown below.

## Install

Install the current source directly from the core repository:

```bash
pip install "suwappu @ git+https://github.com/0xSoftBoi/suwappubot.git@main#subdirectory=packages/sdk-python"
```

For reproducible deployments, replace `@main` with a tested commit SHA. For
local development:

```bash
cd packages/sdk-python
python3 -m venv .venv
.venv/bin/pip install -e '.[dev]'
```

## Quickstart

Start with discovery and a quote:

```python
import asyncio
from suwappu import create_client


async def main():
    async with create_client(api_key="suwappu_sk_...") as client:
        chains = await client.list_chains()
        prices = await client.get_prices("ETH,USDC")
        quote = await client.get_quote("USDC", "ETH", 100.0, "base")

        print(chains)
        print(prices)
        print(quote.amount_out)


asyncio.run(main())
```

`api_key` falls back to `SUWAPPU_API_KEY` when omitted.

## Swap custody paths

The Python SDK now exposes the same two paths as the TypeScript SDK.

### Self-custody: prepare, then sign yourself

```python
quote = await client.get_quote(
    "USDC",
    "ETH",
    100.0,
    "base",
    wallet_address="0xYourWallet",
)

sim = await client.simulate_swap(
    quote_id=quote.quote_id,
    wallet_address="0xYourWallet",
)
if not sim.would_execute:
    raise RuntimeError("; ".join(sim.warnings))

prepared = await client.prepare_swap(
    quote_id=quote.quote_id,
    wallet_address="0xYourWallet",
)
# Review the unsigned transaction, sign it in your wallet, and submit it to RPC.
```

`prepare_swap()` calls `POST /v1/agent/swap`. It never signs or broadcasts
and does not create a managed swap record.

Cross-chain wallet-bound quotes use explicit source/destination chains:

```python
quote = await client.get_quote(
    "USDC",
    "ETH",
    100.0,
    from_chain="base",
    to_chain="arbitrum",
    wallet_address="0xYourWallet",
)
```

### Managed wallet: explicit server-side execution

```python
wallets = await client.agent.list_wallets()
if not wallets:
    raise RuntimeError("Create a managed wallet first")
wallet = wallets[0]

quote = await client.get_quote(
    "USDC",
    "ETH",
    100.0,
    "base",
    wallet_address=wallet.address,
)
sim = await client.simulate_swap(
    quote_id=quote.quote_id,
    wallet_address=wallet.address,
)
if not sim.would_execute:
    raise RuntimeError("; ".join(sim.warnings))

result = await client.execute_managed_swap(
    quote.quote_id,
    idempotency_key="rebalance-2026-08-06-001",
)
print(result.swap_id, result.status, result.tx_hash)
```

`execute_managed_swap()` calls `POST /v1/agent/swap/execute`.
`execute_swap()` remains a backwards-compatible alias for that managed path.
For durable automation, give every intended trade a stable `idempotency_key`.
After an unknown timeout/network/5xx outcome, reconcile before retrying and
reuse the same key.

## Configuration

`create_client` accepts keyword arguments:

| Arg | Default | Notes |
| --- | --- | --- |
| `api_key` | `$SUWAPPU_API_KEY` | Bearer token for authenticated routes. |
| `base_url` | `https://api.suwappu.bot` | Override for dev/testing. |

The client is an async context manager; use `async with` (or call
`await client.close()`) to release the underlying HTTP connection.

## Namespaces

Beyond core swaps the client exposes three product namespaces:

### Perps (Hyperliquid) — `client.perps`

```python
markets = await client.perps.markets()
quote = await client.perps.quote("ETH-USD", "long", 1.0, 5.0)
positions = await client.perps.positions("0xYourWallet")
```

`markets[0].max_leverage` is the current Suwappu quote cap for that market;
`venue_max_leverage` preserves Hyperliquid's raw venue maximum. `funding_rate`
is the current raw market rate, not accrued position funding P&L. Perps remain
read/quote-only on the Agent API.

### Predictions (Polymarket) — `client.predict`

```python
markets = await client.predict.markets(query="crypto", limit=10)
market_id = markets[0].id
detail = await client.predict.market(market_id)
book = await client.predict.book(market_id)
prices = await client.predict.price(market_id)
trades = await client.predict.trades(market_id, limit=20)
```

`detail.condition_id` is the venue/on-chain condition identity; it is not the
market `id` used by the read routes. `detail.tokens` exposes the outcome token
IDs. Trading is a separate authority boundary: `client.predict.order(...)`
takes one of those `token_id` values plus string `price`/`size` and a required
`side` (`"BUY"` or `"SELL"`), and currently maps to the API's GTC limit-order
route.

### Lending (Morpho) — `client.lend`

```python
markets = await client.lend.markets(chain_id=8453)
detail = await client.lend.market("0xMarketId")
```

### Wallets & swap safety

```python
await client.agent.create_wallet()   # idempotent — returns the existing one if any
await client.agent.list_wallets()

# Dry-run before you commit. Surfaces reverts and gas while nothing is at stake.
sim = await client.simulate_swap(quote_id=quote.quote_id, wallet_address="0x…")
if not sim.would_execute:
    raise RuntimeError("; ".join(sim.warnings))

history = await client.list_swaps(status="completed", limit=20)  # managed swap records
```

### Agent control plane — `client.approvals` / `client.audit` / `client.killswitch`

Guardrails for agents that move real money: a human approves risky actions, every
action lands in a tamper-evident log, and one call halts everything.

```python
# Approvals. Listing/deciding is an OWNER action — authenticate as the linked
# human (Mini App / owner JWT), not the agent API key. Only get() takes an agent key.
pending = await owner.approvals.list(status="pending")
await owner.approvals.approve(pending[0].id)
await owner.approvals.deny(pending[0].id)

# If the deployment sets APPROVAL_STEP_UP_REQUIRED=true, challenge first:
challenge = await owner.approvals.step_up_challenge(approval_id)
await owner.approvals.approve(approval_id, step_up_challenge=challenge.challenge)

# Audit chain. list() works with an agent or org key; verify() needs an ORG key
# (the chain is verified whole, so per-agent verification would leak other tenants).
await client.audit.list(event_type="swap.executed", since="2026-01-01", limit=100)
await org_client.audit.verify()   # -> valid / count / first_break_id

# Kill switch — org API key required. Halts execution for the scope.
await org_client.killswitch.set(scope="org", active=True, reason="incident")
await org_client.killswitch.list()
```

To link an agent to a human owner, mint a code the owner redeems:

```python
link = await client.agent.link_code()   # 409 if already linked
print(link.code, link.expires_at)
```

## Error handling

Non-2xx responses raise `SuwappuError`, which carries `status` and `body`:

```python
from suwappu import SuwappuError

try:
    await client.list_chains()
except SuwappuError as err:
    print(err.status, err.body)
```

## Development

```bash
.venv/bin/python -m pytest tests/ -q
```

## Publishing

Publishing follows the standard `build` + `twine` flow from `packages/sdk-python/`:

```bash
python3 -m build
twine upload dist/*
```

Bump `version` in `pyproject.toml` and `__version__` in `src/suwappu/__init__.py`
together before tagging a release.
