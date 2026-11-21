---
name: suwappu-swaps
description: Use this skill when an agent needs to quote, simulate or prepare a token swap across chains through the Suwappu Agent API or its MCP server, or needs to know Suwappu's call order, units, limits and how to get an API key.
---

# Suwappu swaps

Suwappu is cross-chain swap execution for agents and humans. The Agent API quotes a swap across routing providers, dry-runs it, and then either returns an unsigned transaction for you to sign or signs from a managed wallet. It is reachable over REST, an MCP server and SDKs.

Docs: https://suwappu.bot/docs. Problem-by-problem answers: https://suwappu.bot/solve. Full index for agents: https://suwappu.bot/llms.txt.

## Scope

This skill does not grant wallet access or move funds on its own. It describes how to call Suwappu. Whatever your agent can do is bounded by the API key you supply and by any spend policy set on it. Never paste a private key or API key into a prompt, a log or a public repo.

## When to use it

- Quote or price a swap, same-chain or cross-chain.
- Dry-run a quote before anything is signed.
- Prepare an unsigned swap transaction for self-custody signing.
- Check swap status or history.

Do not use it for: A2A execution (the A2A endpoint covers quotes, prices and discovery only), or perps and lending execution (those surfaces are research and quote data; execution is not exposed on the Agent API).

## Safe call order

Always: get_quote, then simulate_swap, then execute_swap.

1. get_quote: pass the `wallet_address` that will sign. Returns a `quote_id`, `amount_out_min` and the route. A quote is valid for 60 seconds and is BOUND to that wallet: a quote requested without `wallet_address` is built for a placeholder address and cannot be turned into a transaction.
2. simulate_swap: dry-run the `quote_id` with the SAME `wallet_address`. No signing, no broadcast, no funds move. Proceed only if `would_execute` is true.
3. execute_swap (MCP): returns an UNSIGNED transaction. It never signs or broadcasts. Org spend policy (per-transaction, daily and session caps, approvals, kill switch) gates it. Org-wide policies are set with the Suwappu team. An agent can add its own per-transaction limit or address allowlist on its managed wallet with `POST /v1/agent/wallet/policy`.

Over REST, step 3 is a choice: `POST /v1/agent/swap` returns an unsigned transaction you sign, and `POST /v1/agent/swap/execute` signs from the agent's managed wallet.

## Units

- Amounts are human-readable decimal strings ("0.1" ETH, "100" USDC), not wei or base units.
- Slippage is a fraction: `0.03` means 3%. The default is 3%.
- Do not hardcode chains or tokens. Call `GET /v1/agent/chains` (no key needed) and `GET /v1/agent/tokens?chain=base`.

## Get a key

One unauthenticated call. The key (`suwappu_sk_...`) is shown once; store it as `SUWAPPU_API_KEY`. New registrations receive starter credits.

```bash
curl -X POST https://api.suwappu.bot/v1/agent/register \
  -H "Content-Type: application/json" \
  -d '{"name": "my-agent", "description": "Quote bot"}'
```

Or open https://suwappu.bot/start.

## REST: quote then simulate

```bash
# 1. quote
curl -s -X POST https://api.suwappu.bot/v1/agent/quote \
  -H "Authorization: Bearer $SUWAPPU_API_KEY" -H "Content-Type: application/json" \
  -d '{"from_token":"ETH","to_token":"USDC","amount":"0.1","chain":"base","wallet_address":"0xYourWallet"}'

# 2. dry run the returned quote_id with the same wallet
curl -s -X POST https://api.suwappu.bot/v1/agent/swap/simulate \
  -H "Authorization: Bearer $SUWAPPU_API_KEY" -H "Content-Type: application/json" \
  -d '{"quote_id":"QUOTE_ID_FROM_STEP_1","wallet_address":"0xYourWallet"}'
```

Use one wallet address for the quote, the dry run and the swap. For a price check only, `wallet_address` can be omitted from the quote, but that quote cannot be executed.

Track a swap with `GET /v1/agent/swap/status/:id`, or set a `callback_url` on the agent for signed webhooks.

## MCP

Endpoint: `https://api.suwappu.bot/mcp` (Bearer key). Tool names include get_quote, simulate_swap, execute_swap, get_prices, get_portfolio, get_swap_status, list_chains, list_tokens and list_wallet_policies. Call `tools/list` at runtime for the current set (23 advertised by default).

```bash
curl -s -X POST https://api.suwappu.bot/mcp \
  -H "Authorization: Bearer $SUWAPPU_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Limits

- Rate limits per key per minute: free 30, agent 100, pro 500, premium 2,000, enterprise 10,000. A new key starts on free. Over the limit you get HTTP 429 with `Retry-After`.
- Base Agent API swap fee: 0.8% on EVM routes, 0.3% on Solana routes, regardless of subscription tier. World ID verified agents get 20% off by default, and a deployment can configure the Solana rate. The fee on the live quote is the one that applies.
- Metered calls need an API key and draw prepaid credits (quote or dry run 1, swap 5; 1 credit is about $0.001). When credits run out the API answers HTTP 402. Paying on-chain per request with an x402 header exists in the code but is off by default.
- Routing on the Agent API: EVM and cross-chain quotes execute through Li.Fi; same-chain Solana quotes through Jupiter. Other providers may be fetched for comparison only.

## Machine-readable contracts

OpenAPI 3.1: https://api.suwappu.bot/v1/agent/openapi. A2A agent card: https://api.suwappu.bot/.well-known/agent-card.json.
