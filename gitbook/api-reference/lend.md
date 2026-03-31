# Lending Markets

Access DeFi lending markets through the Morpho protocol integration. Browse markets on Base and check rates.

## GET /v1/agent/lend/markets

List available lending markets.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `chainId` | number | No | Chain ID (default: `8453` for Base) |

```bash
curl "https://api.suwappu.bot/v1/agent/lend/markets?chainId=8453" \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY"
```

**Response:**

```json
{
  "success": true,
  "markets": [
    {
      "id": "0xabc123...",
      "loanAsset": "USDC",
      "collateralAsset": "ETH",
      "lltv": "0.86",
      "supplyApy": "4.2",
      "borrowApy": "5.8",
      "totalSupply": "12500000",
      "totalBorrow": "8900000",
      "utilization": "0.712"
    },
    {
      "id": "0xdef456...",
      "loanAsset": "USDC",
      "collateralAsset": "cbBTC",
      "lltv": "0.86",
      "supplyApy": "3.8",
      "borrowApy": "5.2",
      "totalSupply": "8200000",
      "totalBorrow": "5100000",
      "utilization": "0.622"
    }
  ]
}
```

## GET /v1/agent/lend/market/:id

Get detailed information about a specific lending market.

```bash
curl https://api.suwappu.bot/v1/agent/lend/market/0xabc123 \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY"
```

**Response:**

```json
{
  "success": true,
  "market": {
    "id": "0xabc123...",
    "loanAsset": "USDC",
    "collateralAsset": "ETH",
    "lltv": "0.86",
    "supplyApy": "4.2",
    "borrowApy": "5.8",
    "totalSupply": "12500000",
    "totalBorrow": "8900000",
    "utilization": "0.712",
    "oracle": "0x...",
    "irm": "0x..."
  }
}
```
