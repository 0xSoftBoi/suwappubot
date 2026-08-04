# suwappu — Python SDK

Async Python client for the [Suwappu](https://suwappu.bot) cross-chain DEX API.

Swap tokens across 40+ chains, check portfolios and prices, and tap into the
perps (Hyperliquid), prediction-market (Polymarket), and lending (Morpho)
namespaces — all through a single typed client.

## Install

```bash
pip install suwappu
```

For local development against this repo:

```bash
cd packages/sdk-python
python3 -m venv .venv
.venv/bin/pip install -e '.[dev]'
```

## Quickstart

```python
import asyncio
from suwappu import create_client


async def main():
    # api_key falls back to the SUWAPPU_API_KEY env var if omitted.
    async with create_client(api_key="sk_...") as client:
        # List supported chains
        chains = await client.list_chains()

        # List popular tokens on a chain
        tokens = await client.list_tokens("arbitrum")

        # Get a swap quote, then execute it
        quote = await client.get_quote("ETH", "USDC", 1.0, "arbitrum")
        result = await client.execute_swap(quote.id)
        print(result.tx_hash, result.status)

        # Portfolio balances (optionally filtered by chain)
        balances = await client.get_portfolio("0xYourWallet")

        # Token prices (comma-separated symbols)
        prices = await client.get_prices("ETH,USDC")


asyncio.run(main())
```

## Configuration

`create_client` accepts keyword arguments:

| Arg        | Default                     | Notes                                   |
| ---------- | --------------------------- | --------------------------------------- |
| `api_key`  | `$SUWAPPU_API_KEY`          | Bearer token for authenticated routes.  |
| `base_url` | `https://api.suwappu.bot`   | Override for dev/testing.               |

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

### Predictions (Polymarket) — `client.predict`

```python
markets = await client.predict.markets(query="crypto", limit=10)
detail = await client.predict.market("0xMarketId")
```

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
if not sim.success:
    raise RuntimeError(sim.reason)

history = await client.list_swaps(status="completed", limit=20)
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

This package is not yet published to PyPI. When ready, publishing follows the
standard `build` + `twine` flow from `packages/sdk-python/`:

```bash
python3 -m build
twine upload dist/*
```

Bump `version` in `pyproject.toml` and `__version__` in `src/suwappu/__init__.py`
together before tagging a release.
