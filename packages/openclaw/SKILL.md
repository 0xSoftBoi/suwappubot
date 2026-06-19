---
name: suwappu-dex
description: "Cross-chain token swaps, quotes, portfolio and prices across 14 chains, plus Hyperliquid perps, Polymarket predictions and Morpho lending, via the Suwappu DEX MCP server. Read-only by default; swap execution is opt-in and gated."
homepage: https://suwappu.bot
metadata:
  {
    "openclaw":
      {
        "emoji": "🌸",
        "os": ["darwin", "linux", "win32"],
        "requires": { "env": ["SUWAPPU_API_KEY"] },
        "tags": ["dex", "defi", "swap", "cross-chain", "trading", "finance"],
      },
  }
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

# Suwappu — Cross-chain DEX 🌸

Swap, quote, and track tokens across **14 chains** (12 EVM + Solana + TRON) through Suwappu's
hosted **MCP server** — plus Hyperliquid perps, Polymarket prediction markets, and Morpho
lending. Routing is automatic across 10+ providers (Li.Fi, CoW Protocol, OKX, 1inch, KyberSwap,
Jupiter, Wormhole, Across, CCTP, …). This skill wraps the live server — no SDK or wrapper code required.

## Setup (one command)

1. Get a free API key:
   ```bash
   curl -X POST https://api.suwappu.bot/v1/agent/register \
     -H "Content-Type: application/json" -d '{"name":"my-openclaw"}'
   # -> save the suwappu_sk_... value
   export SUWAPPU_API_KEY=suwappu_sk_...
   ```
2. Register the MCP server with OpenClaw. **Read-only by default** (swap execution excluded):
   ```bash
   openclaw mcp add suwappu \
     --url https://api.suwappu.bot/mcp \
     --transport streamable-http \
     --header "Authorization=Bearer $SUWAPPU_API_KEY" \
     --exclude execute_swap
   openclaw mcp probe suwappu      # should list the tools
   ```
3. To **enable swap execution**, re-add without `--exclude execute_swap` on a dedicated trading
   agent only (see Safety). Verify with `openclaw mcp doctor`.

`SUWAPPU_API_KEY` is sent as `Authorization: Bearer <key>`. `execute_swap`, `get_portfolio`,
and `perps_quote` require authentication.

## Swap tools

### get_quote
Get the best swap route for a token pair.
```
get_quote <from_token> <to_token> <amount> <chain>
```
Returns: price, route, gas estimate, fee breakdown, price impact, expiry, and a `quote_id`.

### execute_swap
Build an **unsigned** transaction for a previously quoted swap. Suwappu is non-custodial and
never broadcasts — it returns a transaction (EVM unsigned tx, or Solana base64 serialized tx)
for you to sign and submit with your own wallet. **Excluded unless explicitly enabled** (see Setup).
```
execute_swap <quote_id> <wallet_address>
```
`wallet_address` is required and must be your managed wallet (EVM ownership is enforced
server-side). Returns: `status: "ready"`, swap summary, the transaction to sign, and
step-by-step instructions. Preserve the `quote_id` end to end for audit.

### get_portfolio
Check wallet balances across all chains.
```
get_portfolio <wallet_address> [chain]
```
`wallet_address` is required — there is no implicit "current wallet." Returns: token balances
and USD values.

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

1. `list_chains` → see what's available
2. `get_quote ETH USDC 0.1 base` → best route (returns a `quote_id`)
3. (trading agent only) confirm with the user → `execute_swap <quote_id> <wallet_address>` → unsigned tx
4. Sign + broadcast the returned transaction with your wallet
5. `get_portfolio <wallet_address>` → verify the swap landed

## Examples

- "Quote 0.5 ETH to USDC on Base" → `get_quote`
- "What's my portfolio worth across chains?" → `get_portfolio`
- "Best price to bridge 500 USDC to Arbitrum" → `get_quote`

## Safety

- **Read-only by default.** `execute_swap` is excluded via `--exclude` and should only be enabled
  on an isolated trading agent with explicit tool-allowlisting (`agents.json`).
- **Agent proposes, user approves.** Always `get_quote` first, show the route/price impact, and
  require user confirmation before any `execute_swap`. Preserve the `quote_id` end to end for audit.
- **Non-custodial.** The API only ever returns unsigned transactions — signing happens in your
  wallet. Keys live in Turnkey TEE enclaves and never leave; users can export anytime. Suwappu
  enforces 2FA + per-swap/hourly/daily spending limits + tx simulation server-side — these
  guardrails hold even if the agent errs.
- **Never** put `SUWAPPU_API_KEY` in committed files — pass it as an env var / SecretRef.

## Fees & docs

0.3% per swap, gas from wallet balance, no subscription. Full API: https://api.suwappu.bot/docs
