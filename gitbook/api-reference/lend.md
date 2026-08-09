# Lending Markets

Read current Morpho Blue lending-market data through Suwappu. These REST routes are public and read-only: they do not deposit, withdraw, borrow, repay, sign, or broadcast transactions.

The Suwappu surface intentionally stays smaller than Morpho's direct API. Use it when you want a normalized REST/SDK/MCP contract that composes with other Suwappu agent tools; use Morpho directly when you need its full historical, rewards, position, or transaction-building surface.

## `GET /v1/agent/lend/markets`

Return up to 50 markets for one chain, ordered by Morpho's USD supplied value.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `chainId` | positive integer | No | EVM chain ID; defaults to `8453` (Base) |

```bash
curl "https://api.suwappu.bot/v1/agent/lend/markets?chainId=8453"
```

```json
{
  "markets": [
    {
      "id": "0xabc123...",
      "loanToken": "USDC",
      "collateralToken": "WETH",
      "lltv": 0.86,
      "supplyApy": 4.2,
      "borrowApy": 5.8,
      "totalSupply": 12500000,
      "totalBorrow": 8900000,
      "totalSupplyUsd": 12500000,
      "totalBorrowUsd": 8900000,
      "availableLiquidityUsd": 3600000,
      "utilization": 71.2,
      "chainId": 8453,
      "listed": true,
      "warnings": []
    }
  ]
}
```

### Market field semantics

| Field | Meaning |
|-------|---------|
| `supplyApy`, `borrowApy` | Current Morpho APY fields, converted to percentage units (`4.2` means 4.2%) |
| `utilization` | Current utilization in percentage units (`71.2` means 71.2%) |
| `lltv` | Liquidation loan-to-value ratio as a decimal (`0.86` means 86%) |
| `totalSupplyUsd` | Current supplied value in USD; nullable when Morpho has no USD valuation |
| `totalBorrowUsd` | Current borrowed value in USD; nullable when Morpho has no USD valuation |
| `availableLiquidityUsd` | Current amount available to borrow, valued in USD; nullable |
| `totalSupply`, `totalBorrow` | Deprecated aliases of the corresponding `*Usd` fields, retained for compatibility |
| `listed` | Morpho interface listing status; not a safety guarantee or endorsement |
| `warnings` | Active warning objects from Morpho, each with `type` and `level` |

An empty `warnings` array does not mean a market is risk-free. Smart-contract, oracle, asset, liquidity, collateral, and market risks still exist.

## `GET /v1/agent/lend/market/:id`

Read one market by Morpho market ID. Market identity is chain-scoped, so pass the chain when it is not Base—or explicitly pass it in stored workflows so a market ID is never detached from its chain.

| Parameter | Location | Type | Required | Description |
|-----------|----------|------|----------|-------------|
| `id` | path | string | Yes | Morpho market ID from `lend_markets` / the list route |
| `chainId` | query | positive integer | No | EVM chain ID; defaults to `8453` (Base) |

```bash
curl "https://api.suwappu.bot/v1/agent/lend/market/0xabc123?chainId=8453"
```

The response is the market object itself, not a `{ "market": ... }` wrapper:

```json
{
  "id": "0xabc123...",
  "loanToken": "USDC",
  "collateralToken": "WETH",
  "lltv": 0.86,
  "supplyApy": 4.2,
  "borrowApy": 5.8,
  "totalSupply": 12500000,
  "totalBorrow": 8900000,
  "totalSupplyUsd": 12500000,
  "totalBorrowUsd": 8900000,
  "availableLiquidityUsd": 3600000,
  "utilization": 71.2,
  "chainId": 8453,
  "listed": true,
  "warnings": [
    { "type": "oracle_price_derivation", "level": "RED" }
  ],
  "oracle": "0x...",
  "irm": "0x...",
  "createdAt": "2026-01-01T00:00:00.000Z"
}
```

`oracle`, `irm`, and `createdAt` are extra detail fields. Suwappu reads them from the current Morpho API; it does not turn them into a proprietary risk score.

## MCP and SDK equivalents

- MCP: `lend_markets({ chain_id })`, `lend_market({ market_id, chain_id })`
- TypeScript: `client.lend.markets(chainId)`, `client.lend.market(id, chainId)`
- Python: `client.lend.markets(chain_id=...)`, `client.lend.market(id, chain_id=...)`

Hosted MCP lending tools require agent authentication and currently cost one credit per tool call. The REST routes documented on this page are public.

The TypeScript signatures above describe the repository's `0.6.x` SDK source contract. Package registries can lag the repository: run `npm view @suwappu/sdk version` before relying on the chain-scoped detail overload or new typed fields. If npm still reports a version below `0.6.0`, use the REST contract on this page as the stable fallback.

For a concrete monitoring product built from these reads, continue to [Build a Lending Monitor](../guides/lending-monitor.md).
