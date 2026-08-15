# Registry & Directory Listings — Suwappu Agent-Payable Liquidity API

Draft copy for every distribution surface named in Sprint 0 / Bet 3
(`docs/parity/chatdev-feature-parity.md` §3-4). These are listing drafts to
paste into each platform's own submission form — nothing here is auto-published.

Live artifact being listed: the MCP server at `https://api.suwappu.bot/mcp`
(Streamable HTTP, JSON-RPC 2.0), backed by the same quote/execute/status code
paths as `POST /v1/agent/*`. Manifest: `api-ts/mcp-server.json` (co-located
with the serving code) mirrors the canonical registry manifest published from
`packages/openclaw/server.json` — see the note at the bottom of this doc on
why there are two files and which one is authoritative for each registry.

---

## 1. Coinbase Agent.market listing draft

**Category:** Trading / DeFi execution

**Name:** Suwappu — Cross-Chain Swap Execution

**One-line pitch:** The FX desk for agents: quote and execute any-asset-to-any-asset
swaps across 14+ chains, metered per call in USDC via x402, no prepay required.

**Description (long):**
Suwappu is a neutral, multi-chain execution layer for wallet-holding agents.
An agent that holds SOL but needs USDC-on-Base (or any other pair, any
supported chain) calls one metered endpoint and gets an unsigned transaction
back — no bridging UI, no manual routing, no standing balance required beyond
what x402 settles per call. Read endpoints (quotes, prices, supported chains/
tokens, balances) are cheap or free; execution is a flat per-call fee. Every
call is x402-native: no API key required to pay, no subscription lock-in —
agents that would rather prepay credits or subscribe for unmetered access can,
but neither is required to transact.

**Pricing (pay-per-call, x402, in USDC on Base):**

| Action | Price | Notes |
|---|---|---|
| Quote (`get_quote` / `POST /v1/agent/quote`) | $0.001 | 1 credit |
| Balance / portfolio read | $0.001 | 1 credit |
| Prices | $0.001 | 1 credit |
| Supported chains / tokens | Free | 0 credits, no auth |
| Dry-run simulation (`simulate_swap`) | $0.001 | 1 credit — balance/allowance/gas/revert checks, no funds moved |
| **Execute swap** | **$0.005** | 5 credits — builds the signed/unsigned tx via the managed-wallet or self-custody path |

Subscriptions (optional, bypass per-call metering entirely for the window):
`agent` $9.99/mo, `pro` $29.99/mo, `enterprise` $99.99/mo — prepaid, 30-day,
no auto-renew (re-pay to extend), or a Base Spend Permission for true
auto-renew. Full weight table: `GET /v1/agent/billing`.

**Example call (execute a quoted swap):**

```bash
curl -X POST https://api.suwappu.bot/v1/agent/swap/execute \
  -H "Authorization: Bearer suwappu_sk_..." \
  -H "Content-Type: application/json" \
  -d '{"quote_id": "lifi_1730000000_ab12cd", "wallet_address": "0xabc...defd"}'
```

Same flow over MCP: `tools/call` → `execute_swap` with `{quote_id, wallet_address}`.

**Payment endpoint (HTTP 402 per the x402 spec):**

When prepaid credit balance is insufficient, any metered endpoint (REST or
MCP `tools/call`) returns:

```
HTTP/1.1 402 Payment Required
X-Payment-Required: <base64 JSON — same body as below>
Accept-Payment: x402 network=base asset=0x833589...(USDC) payTo=0x...
Content-Type: application/json
```

```json
{
  "x402Version": 1,
  "accepts": [
    {
      "scheme": "exact",
      "network": "base",
      "maxAmountRequired": "5000",
      "resource": "/v1/agent/swap/execute",
      "description": "Suwappu agent API call: swap/execute (5 credits)",
      "mimeType": "application/json",
      "payTo": "0x<suwappu-collector-address>",
      "maxTimeoutSeconds": 120,
      "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "extra": { "name": "USD Coin", "version": "2" }
    }
  ],
  "error": "insufficient_credits",
  "error_code": "INSUFFICIENT_CREDITS",
  "cost_credits": 5,
  "credit_usd_value": 0.001,
  "topup": "POST /v1/agent/billing/topup with {txHash, chain, amount}",
  "subscribe": "POST /v1/agent/billing/subscribe with {txHash, chain, amount, tier}"
}
```

Standard x402 clients (`x402-fetch`, `x402-axios`, `@x402/core`) parse
`accepts[0]` and auto-construct the `X-PAYMENT` retry header — no custom
integration needed. Facilitator: USDC on Base, `scheme: exact`
(EIP-3009 `transferWithAuthorization`), settled via a CDP-compatible x402
facilitator (`X402_FACILITATOR_URL`, gated by `X402_FACILITATOR_ENABLED` — see
`api-ts/src/services/FacilitatorService.ts`). Agents may alternatively top up a
prepaid credit balance on-chain (`POST /v1/agent/billing/topup`) instead of
paying per call.

**Auth:** none required for reads/discovery; Bearer API key
(`suwappu_sk_...`, free via `POST /v1/agent/register`) for anything metered
or wallet-scoped, independent of whether the agent pays via x402 or prepaid
credits.

**Docs:** https://suwappu.bot/docs/billing/agentic-payments · https://suwappu.bot/docs/protocols/overview

---

## 2. Anthropic MCP Connector Directory form content

- **Name:** Suwappu
- **Tagline:** Cross-chain swap execution for AI agents — quote and execute across 14+ chains, x402-metered per call.
- **URL:** `https://api.suwappu.bot/mcp` (Streamable HTTP, JSON-RPC 2.0)
- **Auth type:** Bearer token (`Authorization: Bearer suwappu_sk_...`). Free, instant, self-serve via `POST https://api.suwappu.bot/v1/agent/register` — no approval queue, no payment method required to register. Four read/discovery tools (`list_chains`, `list_tokens`, `get_tempo_tokens`, `browse_mpp_directory`) require no auth at all.
- **Docs URL:** https://suwappu.bot/docs/protocols/mcp (see also https://suwappu.bot/docs/quick-start/mcp-clients for per-client config snippets)
- **Domain proof:** `suwappu.bot` — DNS-verified for the MCP registry namespace `bot.suwappu` (see `packages/openclaw/registry-claim/NAMESPACE_CLAIM.md`); `/.well-known/security.txt` and `/.well-known/agent-card.json` are also served from the same domain.
- **Category:** Finance / Crypto / DeFi

**Example prompts (3+):**

1. "Get me a quote for swapping 0.5 ETH to USDC on Base, then show me the price impact and route before I confirm."
2. "What's my portfolio worth across all chains for wallet 0xabc...def?"
3. "Find prediction markets about the 2028 election and show me the current outcome prices."
4. "What chains and tokens does Suwappu support for swaps?" (no API key needed — this hits the public `list_chains`/`list_tokens` tools)
5. "Swap 100 USDC to SOL, execute it, and check the swap status once it's submitted."

---

## 3. Smithery publish steps

Smithery (smithery.ai) indexes MCP servers from a repo-local
`smithery.yaml` (or equivalent config pointing at the same Streamable HTTP
endpoint already live at `https://api.suwappu.bot/mcp` — no separate server
process to containerize since this is a hosted remote server, not a stdio
package).

1. **Create `smithery.yaml`** at the repo root (or `packages/openclaw/`,
   alongside `server.json`) declaring:
   - `runtime: "remote"` (Smithery's term for a hosted HTTP MCP server, as
     opposed to a container it builds and runs itself)
   - `url: "https://api.suwappu.bot/mcp"`
   - `transport: "streamable-http"`
   - Config schema for the one required secret: `apiKey` (mapped to the
     `Authorization: Bearer` header), marked optional-per-tool since the four
     public read tools work without it.
2. **Claim the server on smithery.ai**: sign in with the GitHub account that
   owns `0xSoftBoi/suwappubot`, "Add Server" → point at this repo → Smithery
   auto-detects `smithery.yaml`.
3. **Verify tool discovery**: Smithery calls `initialize` then `tools/list`
   against the live URL (both are in `PUBLIC_MCP_METHODS`, so this succeeds
   with zero auth) — confirm all ~22 tools and their schemas render correctly
   in the Smithery preview.
4. **Set the listing category** to Finance/Crypto/DeFi and add the same
   tagline/description as the Anthropic Connector Directory entry above for
   consistency across surfaces.
5. **Publish** — Smithery lists the server publicly; no additional review
   gate beyond basic connectivity checks (unlike the official
   modelcontextprotocol.io registry, which requires DNS domain proof).
6. **Keep in sync**: any tool added/renamed/removed in
   `api-ts/src/routes/mcp.ts`'s `TOOLS` array is picked up automatically on
   Smithery's next scheduled re-crawl (it calls `tools/list` live) — no
   manual re-publish needed unless the URL, auth scheme, or category changes.

---

## 4. Official MCP registry (modelcontextprotocol.io) — cross-reference

Already covered end-to-end in `packages/openclaw/README.md` ("Publishing to
the MCP Registry") and `packages/openclaw/PUBLISHING.md` — not duplicated
here. Summary: `mcp-publisher publish ./server.json` from `packages/openclaw/`,
gated on a one-time DNS `TXT` record proving ownership of `bot.suwappu`
(human/registrar step, not agent-automatable).

**Why two manifest files exist:** `packages/openclaw/server.json` is the
canonical file actually submitted via `mcp-publisher`. It currently advertises
the hosted remote only: source `@suwappu/mcp-server` is `0.6.0`, while the npm
registry still serves `0.1.1`, so an alternate stdio package entry would be a
dead or stale install path until the bridge is released. `api-ts/mcp-server.json` is a co-located descriptor of the exact
same remote server (`bot.suwappu/mcp`, same URL), kept next to the serving
code (`api-ts/src/routes/mcp.ts`) for directories that expect a manifest
alongside the API implementation rather than inside an SDK package (Coinbase
Agent.market and Smithery tooling both scan for a root- or service-level
`mcp-server.json`/`server.json`). It carries the same core fields plus a
`_meta["bot.suwappu/tools"]` extension array (per-tool auth/cost/read-write
metadata) that the official registry schema doesn't define but downstream
directories can use for search/filtering. If the two ever drift, treat
`packages/openclaw/server.json` as authoritative for what actually gets
published to `registry.modelcontextprotocol.io`, and update
`api-ts/mcp-server.json` to match in the same PR.
