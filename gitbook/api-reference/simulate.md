# Simulate Swap (Dry Run)

Preview a swap with **zero funds moved** — a Tenderly-style dry run that fetches (or reuses) a quote and runs a battery of pre-flight checks, without creating a swap record, signing, or broadcasting anything. Use it to let an agent validate a trade before committing real value.

Also available as the `simulate_swap` MCP tool (same logic, same cost).

## POST /v1/agent/swap/simulate

Requires authentication. Costs 1 credit when metering is enabled (read-tier pricing).

### Request body

Same shape as [Quote](quote.md), plus an optional `quote_id`. Provide **either** `quote_id`, **or** `from_token` + `to_token` + `amount`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `quote_id` | string | No | Simulate a previously fetched quote instead of pulling a fresh one |
| `from_token` | string | With no quote_id | Source token symbol or address |
| `to_token` | string | With no quote_id | Destination token symbol or address |
| `amount` | string | With no quote_id | Human-readable input amount |
| `chain` | string | No | Chain key for a same-chain swap (e.g. `base`) |
| `from_chain` | string | No | Source chain for a cross-chain swap |
| `to_chain` | string | No | Destination chain for a cross-chain swap |
| `wallet_address` | string | No | Wallet to simulate as. Strongly recommended — enables the balance, allowance, gas, and revert checks |
| `slippage` | number | No | Slippage tolerance as a decimal, 0–0.5 |

### Response

```json
{
  "success": true,
  "would_execute": true,
  "quote_id": "q_abc123",
  "chain_type": "evm",
  "expected_output": { "token": "USDC", "amount": "1841.22", "amount_usd": "1841.22" },
  "min_output_after_slippage": "1786.55",
  "price_impact_pct": 0.12,
  "fees": { "protocol": "0.3%", "gas_estimate": "0.00042 ETH" },
  "checks": [
    { "name": "route_available", "status": "pass", "detail": "Quote found via Li.Fi" },
    { "name": "balance_sufficient", "status": "pass", "detail": "1.02 ETH available, 1.0 required" },
    { "name": "allowance_sufficient", "status": "warn", "detail": "Allowance 0 for spender 0x…; approval transaction required first" },
    { "name": "gas_affordable", "status": "pass", "detail": "Native balance covers estimated gas" },
    { "name": "eth_call_revert_check", "status": "pass", "detail": "eth_call succeeded" },
    { "name": "slippage_sane", "status": "pass", "detail": "Price impact 0.12% within bounds" }
  ],
  "warnings": []
}
```

`would_execute` is `true` only when every check that could run passed (inapplicable or unavailable checks degrade to `warn` and do not block).

### Checks

| Check | Scope | What it verifies |
|-------|-------|------------------|
| `route_available` | all | A route/quote exists for the pair and amount |
| `balance_sufficient` | needs `wallet_address` | Source-token balance covers the input amount |
| `allowance_sufficient` | EVM, ERC-20 only | Router allowance covers the input (skipped for native tokens; spender address in `detail`) |
| `gas_affordable` | needs `wallet_address` | Native balance covers the gas estimate |
| `eth_call_revert_check` | EVM, needs executable tx data | Dry-runs the transaction via `eth_call` and reports the revert reason if it would fail |
| `slippage_sane` | all | Warns when price impact exceeds 5% or min-output deviates far from the expected output |

Checks are independent and degrade gracefully: a check that cannot run returns `warn` with an explanatory `detail` — the endpoint never fails because one check was unavailable.

### Guarantees

- **No state changes**: no swap rows created, no signing, no broadcast, no balance mutations.
- Simulating does **not** reserve or extend the underlying quote — quotes still expire ~60s after creation.

### Example

```bash
curl -X POST https://api.suwappu.bot/v1/agent/swap/simulate \
  -H "Authorization: Bearer $SUWAPPU_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"from_token":"ETH","to_token":"USDC","amount":"1.0","chain":"base","wallet_address":"0xYourWallet"}'
```

Typical agent flow: `POST /quote` → `POST /swap/simulate` → if `would_execute` → `POST /swap/execute` → `GET /swap/status/:swapId`.
