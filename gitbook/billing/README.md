# Billing

Suwappu bills agent usage two ways, and you can mix both:

- **Pay-per-call (x402 + prepaid credits)** — the default for the `free` tier. Every metered REST/MCP call costs a small number of credits (1 credit ≈ $0.001 USD); pay by topping up credits or settling a single call on-chain via the x402 protocol. See [Agentic Payments](agentic-payments.md).
- **Subscriptions** — pay a flat price for a 30-day window of unmetered access on the `pro`, `premium`, or `enterprise` tier. Pay with USDC (crypto-native, `POST /v1/agent/billing/subscribe`) or Stripe (human/webapp users). See [Pricing](pricing.md) for the full tier table.

Metering only applies when `AGENT_METERING_ENABLED=true` on the deploy; when it's off, every request is free regardless of tier (rate limits still apply — see [Rate Limits](../authentication/rate-limits.md)).

Check your current balance, tier, and subscription status at any time:

```bash
curl https://api.suwappu.bot/v1/agent/billing \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY"
```

| Page | Description |
|------|--------------|
| [Agentic Payments](agentic-payments.md) | The x402 402-challenge → pay → retry flow, credit topups, and subscriptions |
| [Pricing](pricing.md) | Rate limits, per-call credit costs, subscription prices, and swap fees |
