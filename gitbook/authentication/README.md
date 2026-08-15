# Authentication

Suwappu uses API keys as bearer tokens. You receive a key when you register an agent, and you send it on every authenticated request as an `Authorization: Bearer ...` header. There are no other credentials to manage — signing and settlement happen server-side with managed wallets.

## Getting a key

Register an agent (no auth required) and Suwappu returns your key:

```bash
curl -X POST https://api.suwappu.bot/v1/agent/register \
  -H "Content-Type: application/json" \
  -d '{"name": "my-agent"}'
```

The response contains `agent.api_key`, a token of the form `suwappu_sk_...`:

```json
{
  "success": true,
  "agent": {
    "id": "a1b2c3d4-...",
    "name": "my-agent",
    "api_key": "suwappu_sk_xxxxxxxxxxxxxxxxxxxxxxxx"
  },
  "important": "SAVE YOUR API KEY! It cannot be retrieved later."
}
```

**The key is shown only once.** Suwappu stores only a SHA-256 hash of it and cannot recover the plaintext. If you lose it, [rotate the key](rate-limits.md) (which invalidates the old one).

## Sending the key

Pass the key in the `Authorization` header on every authenticated endpoint:

```bash
curl https://api.suwappu.bot/v1/agent/me \
  -H "Authorization: Bearer suwappu_sk_xxxxxxxxxxxxxxxxxxxxxxxx"
```

```ts
fetch('https://api.suwappu.bot/v1/agent/me', {
  headers: { Authorization: `Bearer ${process.env.SUWAPPU_KEY}` },
})
```

Public endpoints — `POST /v1/agent/register` and `GET /v1/agent/chains` — do not require a key.

## Key rotation

Rotate a key at any time. The old key is invalidated immediately, so update your clients before the next request.

```bash
curl -X POST https://api.suwappu.bot/v1/agent/keys/rotate \
  -H "Authorization: Bearer suwappu_sk_OLD_KEY"
```

**Response:**

```json
{
  "success": true,
  "api_key": "suwappu_sk_NEW_KEY",
  "message": "API key rotated. Save this key — the old key is now invalid."
}
```

See [`POST /v1/agent/keys/rotate`](../api-reference/keys.md) for details.

## Managed wallets and signing

Suwappu agents use **managed (Turnkey) wallets**. Private keys live in Turnkey's secure enclaves and never touch your code or Suwappu's application servers. When you call [`POST /v1/agent/swap/execute`](../api-reference/swap-execute.md), Suwappu signs and broadcasts on your behalf using your agent's managed wallet — you only ever send a `quote_id`.

A managed wallet's address is bound to your agent. Swap, portfolio, and execute endpoints reject any `wallet_address` that is not your own managed wallet, which prevents constructing fund-moving transactions from arbitrary addresses or enumerating other agents' balances.

If you prefer self-custody, use [`POST /v1/agent/swap`](../api-reference/swap.md), which returns an unsigned transaction for you to sign and broadcast yourself.

## Security notes

- **Treat your key like a password.** Anyone with it can swap from your managed wallet. Store it in a secret manager, never in source control.
- **Use HTTPS only.** All requests must go to `https://api.suwappu.bot`.
- **Scope wallet permissions.** Attach Turnkey spending-limit and address-whitelist policies to your managed wallet via `POST /v1/agent/wallet/policy` to cap what a compromised key can do.
- **Webhook payloads are signed.** Verify the `X-Suwappu-Signature` HMAC (keyed with the SHA-256 of your API key) on every webhook before trusting it. See [Webhooks](../api-reference/webhooks.md).
- See [Rate Limits](rate-limits.md) for per-tier request quotas.
