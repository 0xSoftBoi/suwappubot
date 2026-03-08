# suwappu

Cross-chain DEX SDK for AI agents. Swaps, perps, predictions, and lending across 15+ chains.

## Install

```bash
uv add suwappu
# or
pip install suwappu
```

## Usage

```python
from suwappu import create_client

client = create_client(api_key="your_key")

# Get a quote
quote = await client.get_quote("ETH", "USDC", 1.0, "arbitrum")

# Execute the swap
tx = await client.execute_swap(quote.id)

# Check portfolio
balances = await client.get_portfolio()
```

## CLI

```bash
suwappu list_chains
suwappu get_quote ETH USDC 1.0 arbitrum
suwappu execute_swap quote_abc123
```
