# Your First Swap

This guide walks you through the complete swap flow in four steps using `curl`. By the end, you will have registered an agent, requested a quote, executed a token swap, and confirmed the transaction.

## Step 1: Register

Create an agent and receive your API key. This endpoint is public — no authentication required.

```bash
curl -X POST https://api.suwappu.bot/v1/agent/register \
  -H "Content-Type: application/json" \
  -d '{"name":"my-trading-bot","description":"Automated trading agent"}'
```

**Response:**

```json
{
  "success": true,
  "agent": {
    "id": "a1b2c3d4-5678-90ab-cdef-1234567890ab",
    "name": "my-trading-bot",
    "api_key": "suwappu_sk_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
    "created_at": "2025-01-15T10:30:00Z"
  }
}
```

Save your `api_key` — you will need it for all authenticated requests. The key format is `suwappu_sk_` followed by at least 32 alphanumeric characters.

## Step 2: Get a Quote

Request a swap quote by specifying the tokens, amount, and chain. Quotes are time-limited.

```bash
curl -X POST https://api.suwappu.bot/v1/agent/quote \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer suwappu_sk_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6" \
  -d '{
    "from_token": "USDC",
    "to_token": "ETH",
    "amount": "500.00",
    "chain": "ethereum"
  }'
```

**Response:**

```json
{
  "success": true,
  "quote": {
    "quote_id": "q_8f3a1b2c-4d5e-6f7a-8b9c-0d1e2f3a4b5c",
    "from_token": "USDC",
    "to_token": "ETH",
    "amount_in": "500.00",
    "amount_out": "0.2134",
    "exchange_rate": "0.0004268",
    "price_impact": "0.02%",
    "fee": "0.50",
    "expires_in_seconds": 30
  }
}
```

The `quote_id` is valid for the number of seconds shown in `expires_in_seconds`. Execute the swap before it expires.

## Step 3: Execute the Swap

Submit the quote for on-chain execution.

```bash
curl -X POST https://api.suwappu.bot/v1/agent/swap/execute \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer suwappu_sk_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6" \
  -d '{
    "quote_id": "q_8f3a1b2c-4d5e-6f7a-8b9c-0d1e2f3a4b5c"
  }'
```

**Response:**

```json
{
  "success": true,
  "swap": {
    "swap_id": "sw_1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
    "status": "pending",
    "tx_hash": "0x7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b",
    "from_token": "USDC",
    "to_token": "ETH",
    "amount_in": "500.00",
    "amount_out": "0.2134",
    "created_at": "2025-01-15T10:30:05Z"
  }
}
```

The swap is now submitted. Use the `swap_id` to track its progress.

## Step 4: Check Status

Poll the swap status until it completes.

```bash
curl -X GET https://api.suwappu.bot/v1/agent/swap/status/sw_1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d \
  -H "Authorization: Bearer suwappu_sk_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"
```

**Response:**

```json
{
  "success": true,
  "swap": {
    "swap_id": "sw_1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
    "status": "completed",
    "tx_hash": "0x7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b",
    "from_token": "USDC",
    "to_token": "ETH",
    "amount_in": "500.00",
    "amount_out": "0.2134",
    "chain": "ethereum",
    "created_at": "2025-01-15T10:30:05Z",
    "completed_at": "2025-01-15T10:30:18Z"
  }
}
```

Possible `status` values:

| Status | Meaning |
|--------|---------|
| `pending` | Swap submitted, waiting for on-chain execution |
| `processing` | Transaction is being processed on-chain |
| `completed` | Swap finished successfully |
| `failed` | Swap failed — check error details in the response |
| `expired` | Quote expired before execution |

## Next Steps

- See [SDK Examples](sdk-examples.md) for complete runnable scripts in Python, TypeScript, and Bash.
- Read [Authentication](../authentication/README.md) for details on key management and rotation.
- Review [Rate Limits](../authentication/rate-limits.md) to understand request quotas for your tier.
