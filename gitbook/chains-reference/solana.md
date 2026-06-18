# Solana

Suwappu supports Solana swaps through the Jupiter aggregator, with SPL-token routing and Base58 addresses. Solana wallets are separate from EVM wallets — a Solana swap signs with a Solana keypair, not an EVM `0x` address. Pass `chain: "solana"` (or `"sol"`) in your requests.

## Overview

| Property | Value |
|----------|-------|
| Chain key | `solana` (alias `sol`) |
| Address format | Base58 (e.g. `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`) |
| Token standard | SPL |
| Native token | SOL (9 decimals) |
| Routing | Jupiter aggregator |
| Default slippage | 3% (300 bps) for agent/A2A quotes |

## Built-in Tokens

The API resolves these well-known SPL tokens by symbol. For any other mint, pass the SPL mint address directly.

| Symbol | Mint Address | Decimals | Name |
|--------|-------------|----------|------|
| SOL | `So11111111111111111111111111111111111111112` | 9 | Solana |
| WSOL | `So11111111111111111111111111111111111111112` | 9 | Wrapped SOL |
| USDC | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | 6 | USD Coin |
| USDT | `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB` | 6 | Tether USD |
| BONK | `DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263` | 5 | Bonk |
| WIF | `EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm` | 6 | dogwifhat |
| JUP | `JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN` | 6 | Jupiter |
| RAY | `4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R` | 6 | Raydium |
| PYTH | `HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3` | 6 | Pyth Network |
| JTO | `jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL` | 9 | Jito |
| ORCA | `orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE` | 6 | Orca |
| MNDE | `MNDEFzGvMt87ueuHvVU9VcTqsAP5b3fTGPsHuuPA5ey` | 9 | Marinade |
| MSOL | `mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So` | 9 | Marinade Staked SOL |
| JITOSOL | `J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn` | 9 | Jito Staked SOL |

## Jupiter Routing

Solana swaps are priced by the Jupiter aggregator, which routes across Solana DEXs (Raydium, Orca, and others) for the best execution. The quote response includes:

- `priceImpactPct` — estimated price impact of the swap
- `routePlan` — the venues the swap is routed through (e.g. `Orca -> Raydium`)
- `inAmount` / `outAmount` — amounts in base units (lamports / token decimals)

## Quote Example

```bash
curl -X POST https://api.suwappu.bot/v1/agent/quote \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"from_token": "SOL", "to_token": "USDC", "amount": "1.5", "chain": "solana"}'
```

## Natural Language (A2A / execute)

The A2A endpoint and the `/v1/agent/execute` endpoint both understand Solana commands:

```bash
curl -X POST https://api.suwappu.bot/a2a \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "message/send",
    "params": {
      "message": { "role": "user", "parts": [{ "type": "text", "text": "swap 100 USDC to SOL on solana" }] }
    }
  }'
```

## Notes

- Solana managed wallets are distinct from EVM managed wallets. Fund the Solana wallet with SOL for transaction fees.
- Quotes expire quickly (about 60 seconds) — execute promptly after quoting.
- For tokens not in the built-in list, pass the SPL mint address as the token field.
