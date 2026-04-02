---
name: suwappu
description: Cross-chain token swaps across 14 chains via Suwappu DEX infrastructure
tools:
  - get_quote
  - execute_swap
  - get_portfolio
  - get_prices
  - list_chains
  - list_tokens
---

# Suwappu — Cross-chain Swap Skill

You can swap any token on any of 15 supported chains. Routing is handled automatically via Li.Fi, Jupiter, CoW Protocol, and Wormhole.

## Authentication

Set `SUWAPPU_API_KEY` in your environment. Get one via `POST /v1/agent/register`.

## Tools

### get_quote
Get the best swap route for a token pair.
```
get_quote <from_token> <to_token> <amount> <chain>
```
Returns: price, route, gas estimate, fee breakdown.

### execute_swap
Execute a previously quoted swap.
```
execute_swap <quote_id>
```
Returns: transaction hash, confirmation status.

### get_portfolio
Check wallet balances across all chains.
```
get_portfolio [chain]
```
Returns: token balances, USD values.

### get_prices
Get current token prices.
```
get_prices <token> [chain]
```
Returns: price in USD, 24h change.

### list_chains
List all supported chains.
```
list_chains
```
Returns: chain names, IDs, and status.

### list_tokens
List popular tokens on a chain.
```
list_tokens <chain>
```
Returns: token symbols, addresses, decimals.

## Typical flow

1. `list_chains` — see what's available
2. `get_quote ETH USDC 1.0 arbitrum` — find the best route
3. `execute_swap <quote_id>` — confirm and execute
4. `get_portfolio` — verify the swap landed

## Fees

0.3% per swap. No subscription. Gas paid from wallet balance.

## Security

Non-custodial. Turnkey TEE hardware — keys never leave the enclave. Users can export anytime.
