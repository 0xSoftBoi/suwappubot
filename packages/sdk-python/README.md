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
