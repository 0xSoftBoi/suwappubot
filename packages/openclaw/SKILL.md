---
name: suwappu
description: Cross-chain swaps, Hyperliquid perps, Polymarket predictions, and Morpho lending via Suwappu agent API
tools:
  - get_quote
  - execute_swap
  - get_portfolio
  - get_prices
  - list_chains
  - list_tokens
  - perps_markets
  - perps_quote
  - perps_positions
  - predict_markets
  - predict_market
  - lend_markets
  - lend_market
---

# Suwappu — Cross-chain DeFi Skill

You can swap any token across 40+ supported chains, trade Hyperliquid perps, browse
Polymarket prediction markets, and inspect Morpho lending markets. Swap routing is
handled automatically — best-price quotes are raced across Li.Fi, CoW Protocol, OKX,
1inch, KyberSwap, Jupiter (Solana), Across, and CCTP.

## Authentication

Set `SUWAPPU_API_KEY` in your environment. Get one via `POST /v1/agent/register`.
Sent as `Authorization: Bearer <key>`. `execute_swap`, `get_portfolio`, and
`perps_quote` require authentication.

## Swap tools

### get_quote
Get the best swap route for a token pair.
```
get_quote <from_token> <to_token> <amount> <chain>
```
Returns: price, route, gas estimate, fee breakdown, and a `quote_id`.

### execute_swap
Build an **unsigned** transaction for a previously quoted swap. Suwappu is
non-custodial and never broadcasts — it returns a transaction (EVM unsigned tx,
or Solana base64 serialized tx) for you to sign and submit with your own wallet.
```
execute_swap <quote_id> <wallet_address>
```
`wallet_address` is required and must be your managed wallet (EVM ownership is
enforced server-side). Returns: `status: "ready"`, swap summary, transaction to
sign, and step-by-step instructions.

### get_portfolio
Check wallet balances across all chains.
```
get_portfolio <wallet_address> [chain]
```
`wallet_address` is required — there is no implicit "current wallet." Returns:
token balances and USD values.

### get_prices
Get current token prices.
```
get_prices <token[,token...]> [chain]
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

## Perps tools (Hyperliquid)

### perps_markets
List available perpetual markets.
```
perps_markets
```
Returns: market name, asset, max leverage, mark price, funding rate.

### perps_quote
Quote a perp position. **Requires authentication.**
```
perps_quote <market> <long|short> <size> <leverage>
```
Returns: entry price, margin, liquidation price, funding rate, fee.

### perps_positions
List open positions for an address.
```
perps_positions <address>
```
Returns: open positions with size, leverage, entry/mark price, unrealized PnL.

## Prediction tools (Polymarket)

### predict_markets
Browse or search active prediction markets.
```
predict_markets [query] [limit]
```
Returns: question, outcomes, outcome prices, volume, liquidity, end date.

### predict_market
Get full detail for a single prediction market.
```
predict_market <market_id>
```
Returns: market detail incl. description and resolution status.

## Lending tools (Morpho)

### lend_markets
List Morpho lending markets, optionally filtered by chain.
```
lend_markets [chain_id]
```
Returns: loan/collateral token, LLTV, supply/borrow APY, utilization.

### lend_market
Get full detail for a single lending market.
```
lend_market <market_id>
```
Returns: market detail incl. oracle and IRM addresses.

## Typical swap flow

1. `list_chains` — see what's available
2. `get_quote ETH USDC 1.0 arbitrum` — find the best route
3. `execute_swap <quote_id> <wallet_address>` — build the unsigned tx
4. Sign + broadcast the returned transaction with your wallet
5. `get_portfolio <wallet_address>` — verify the swap landed

## Fees

0.3% per swap. No subscription. Gas paid from wallet balance.

## Security

Non-custodial. Turnkey TEE hardware — keys never leave the enclave. Users can
export anytime. The API only ever returns unsigned transactions; signing happens
in your wallet.
