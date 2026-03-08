# Solana

Solana is supported as a first-class chain in Suwappu with its own dedicated swap routing through the Jupiter aggregator.

| Property | Value |
|----------|-------|
| Chain Type | Solana |
| Key | `solana` |
| Alias | `sol` |
| Native Token | SOL |
| Address Format | Base58 (not `0x`) |
| Token Standard | SPL |

## Key Differences from EVM

- **Wallet addresses** are Base58-encoded (e.g., `7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU`), not hexadecimal `0x` addresses.
- **Token addresses** are also Base58-encoded (e.g., `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` for USDC).
- **Managed wallets** for Solana are separate from EVM wallets. When you create a wallet via `POST /wallets`, the response includes a `chain_type` field indicating `"solana"` or `"evm"`.
- **Swap routing** uses the Jupiter aggregator instead of Li.Fi.
- **Quote responses** for Solana return `price_impact` and `route` fields instead of `exchange_rate` and `gas_usd`.

## Common Tokens

| Token | Address | Decimals |
|-------|---------|----------|
| SOL | `So11111111111111111111111111111111111111112` | 9 |
| WSOL | `So11111111111111111111111111111111111111112` | 9 |
| USDC | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | 6 |
| USDT | `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB` | 6 |
| BONK | `DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263` | 5 |
| WIF | `EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm` | 6 |
| JUP | `JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN` | 6 |
| RAY | `4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R` | 6 |
| PYTH | `HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3` | 6 |
| JTO | `jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL` | 9 |
| ORCA | `orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE` | 6 |
| MNDE | `MNDEFzGvMt87ueuHvVU9VcTqsAP5b3fTGPsHuuPA5ey` | 9 |
| MSOL | `mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So` | 9 |
| JITOSOL | `J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn` | 9 |

> **Note:** SOL and WSOL share the same mint address. The API handles wrapping and unwrapping automatically when needed for swaps.

## Example: Swap SOL to USDC on Solana

### Get a Quote

```bash
curl -X POST https://api.suwappu.bot/v1/agent/quote \
  -H "Authorization: Bearer suwappu_sk_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "from_token": "SOL",
    "to_token": "USDC",
    "amount": "1.0",
    "chain": "solana"
  }'
```

#### Example Response

```json
{
  "success": true,
  "quote_id": "qt_sol_a1b2c3d4",
  "from_token": "SOL",
  "to_token": "USDC",
  "amount": "1.0",
  "expected_output": "142.85",
  "price_impact": "0.02",
  "route": ["SOL", "USDC"],
  "chain": "solana",
  "expires_at": "2026-03-07T12:05:00Z"
}
```

Note that Solana quotes include `price_impact` (percentage) and `route` (swap path) instead of the EVM fields `exchange_rate` and `gas_usd`.

### Execute the Swap

```bash
curl -X POST https://api.suwappu.bot/v1/agent/swap/execute \
  -H "Authorization: Bearer suwappu_sk_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"quote_id": "qt_sol_a1b2c3d4"}'
```

## Python Example

```python
import requests

API_KEY = "suwappu_sk_your_api_key"
BASE_URL = "https://api.suwappu.bot/v1/agent"
headers = {"Authorization": f"Bearer {API_KEY}"}

# Get a quote for SOL → USDC
quote = requests.post(
    f"{BASE_URL}/quote",
    headers=headers,
    json={
        "from_token": "SOL",
        "to_token": "USDC",
        "amount": "2.5",
        "chain": "solana",
    },
).json()

print(f"Expected output: {quote['expected_output']} USDC")
print(f"Price impact: {quote['price_impact']}%")

# Execute the swap
swap = requests.post(
    f"{BASE_URL}/swap/execute",
    headers=headers,
    json={"quote_id": quote["quote_id"]},
).json()

print(f"Swap ID: {swap['swap_id']}, Status: {swap['status']}")
```

## TypeScript Example

```typescript
const API_KEY = "suwappu_sk_your_api_key";
const BASE_URL = "https://api.suwappu.bot/v1/agent";
const headers = {
  Authorization: `Bearer ${API_KEY}`,
  "Content-Type": "application/json",
};

// Get a quote for SOL → USDC
const quoteRes = await fetch(`${BASE_URL}/quote`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    from_token: "SOL",
    to_token: "USDC",
    amount: "2.5",
    chain: "solana",
  }),
});

const quote = await quoteRes.json();
console.log(`Expected output: ${quote.expected_output} USDC`);
console.log(`Price impact: ${quote.price_impact}%`);

// Execute the swap
const swapRes = await fetch(`${BASE_URL}/swap/execute`, {
  method: "POST",
  headers,
  body: JSON.stringify({ quote_id: quote.quote_id }),
});

const swap = await swapRes.json();
console.log(`Swap ID: ${swap.swap_id}, Status: ${swap.status}`);
```

## Discovering Solana Tokens

Use the tokens endpoint to find available Solana tokens:

```bash
curl "https://api.suwappu.bot/v1/agent/tokens?chain=solana" \
  -H "Authorization: Bearer suwappu_sk_your_api_key"
```
