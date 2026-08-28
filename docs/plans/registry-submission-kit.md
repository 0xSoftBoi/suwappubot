# Registry submission kit — Suwappu MCP + x402

Copy-paste metadata for each target. Prereq for all: `@suwappu/mcp-server@0.6.0` published to npm
(currently npm shows `0.1.1` — founder action, see `docs/plans/mcp-unification.md`). Submission
*methods* below are marked UNVERIFIED where this session could not confirm the current live process
against the actual site (no browsing tool used; based on training-era knowledge of each project as of
this repo's last research pass). Verify the method before executing.

## Shared metadata block (paste into any form)

```
Name: Suwappu
Package: @suwappu/mcp-server
Namespace (MCP Registry): bot.suwappu/mcp
Install: npx @suwappu/mcp-server
Remote endpoint: https://api.suwappu.bot/mcp  (streamable-http)
Auth: Bearer <SUWAPPU_API_KEY> — optional for 4 zero-cost discovery tools, required for
      scoped/metered tools. Register: POST https://api.suwappu.bot/v1/agent/register
Description: Cross-chain DeFi tools for AI agents — quotes, swap simulation and unsigned
      transaction preparation, portfolio/prices, perps, lending, and prediction markets across
      7+ chains, with x402 pay-per-call metering.
Homepage: https://suwappu.bot
Repo: https://github.com/0xSoftBoi/suwappubot (packages/mcp-server)
Version: 0.6.0
License: MIT
Categories/tags: mcp, defi, dex, swap, crypto, cross-chain, agents, x402, finance
Tool count: 22 (get_quote, get_portfolio, get_prices, list_chains, list_tokens, execute_swap,
      simulate_swap, get_tempo_tokens, browse_mpp_directory, predict_markets, predict_market,
      predict_book, predict_price, predict_trades, perps_markets, perps_quote, perps_positions,
      lend_markets, lend_market, get_swap_status, get_swap_history, list_wallet_policies)
Agent Card (A2A): https://api.suwappu.bot/.well-known/agent-card.json
OpenAPI: https://api.suwappu.bot/v1/agent/openapi
```

## 1. modelcontextprotocol.io official registry (registry.modelcontextprotocol.io)

**Method** (VERIFIED against repo tooling — `packages/openclaw/PUBLISHING.md` +
`registry-claim/NAMESPACE_CLAIM.md` already implement this): PR-free, CLI-driven, DNS-namespace
ownership proof, no account/web form.

```bash
# 1. Confirm DNS TXT propagated (already generated in registry-claim/):
dig +short TXT suwappu.bot | grep MCPv1

# 2. Install the Go binary publisher (NOT the npm package of the same name):
brew install mcp-publisher   # or https://github.com/modelcontextprotocol/registry/releases

# 3. Auth + publish
cd packages/openclaw
mcp-publisher login dns --domain suwappu.bot --private-key "$(cat registry-claim/.private-key)"
mcp-publisher publish ./server.json
```

`server.json` is already correct (name `bot.suwappu/mcp`, version `0.6.0`, remote
`https://api.suwappu.bot/mcp`) and is currently **intentionally remote-only** — do not add an npm
`packages` stanza until `npm view @suwappu/mcp-server version` returns `0.6.0`. Blocked on: npm
publish (founder action, needs npm auth).

## 2. mcpservers.org

UNVERIFIED submission mechanics — this is a community-run directory that has historically accepted
PRs against its own repo's server list (JSON/YAML entry + short description), not a hosted form.
Confirm current process at the site before acting; if a "Submit" link/form exists, prefer it over a
PR. Paste the shared metadata block above into whichever intake exists. Do not fabricate a PR against
an unconfirmed repo path — check `github.com/mcpservers-org` (exact org/repo unverified) first.

## 3. Coinbase Agent.market

UNVERIFIED — no confirmed public self-serve submission flow found in this session; Agent.market has
been positioned as a Coinbase/CDP-adjacent x402 agent-service marketplace. Likely path is a CDP
Portal / Agent.market developer console listing tied to a CDP API key (the same `CDP_API_KEY_ID` /
`CDP_API_KEY_SECRET` used by `FacilitatorService`). Founder should check
https://portal.cdp.coinbase.com and Agent.market's own site for a current "list your service" flow
before assuming a specific mechanism. Have ready: the shared metadata block, plus x402 pricing
per tool (see `api-ts/src/routes/mcpTools.ts` per-tool `price` fields) since Agent.market indexes
paid agent services by price/route, not just name/description.

## 4. x402scan directory (x402scan.com)

UNVERIFIED submission mechanics — x402scan indexes on-chain x402 facilitator activity and appears to
auto-discover services that have settled real payments through a facilitator (CDP's hosted
facilitator or x402.org), rather than accepting manual listings. **This is why item 1 (a live testnet
e2e settle) is a prerequisite**: x402scan visibility for Suwappu's endpoints likely requires at least
one real settled payment on a facilitator x402scan indexes, not a form submission. If x402scan does
also have a manual "add my service" form, it was not confirmed in this session — check the site
directly. No metadata block needed until the e2e settle exists; at that point the discovered resource
should be `https://api.suwappu.bot/v1/agent/quote` (and other metered routes) with `payTo` = the
configured `AGENT_METERING_COLLECTOR_ADDRESS`/`FEE_WALLET_EVM`.

## Founder prerequisites before any of the above go live

1. `npm publish` of `@suwappu/mcp-server@0.6.0` from `packages/mcp-server` (needs npm auth this
   session doesn't have). Verify with `npm view @suwappu/mcp-server version`.
2. A real testnet x402 settle via `api-ts/scripts/x402-e2e.ts` (see this session's item 1 report) —
   needed to (a) confirm the facilitator path actually works before flipping it on for real agents,
   and (b) make Suwappu discoverable on x402scan if it only indexes real settlements.
3. Prod env flags/keys on Railway: `AGENT_METERING_ENABLED=true`, `X402_FACILITATOR_ENABLED=true`,
   `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET` (from CDP Portal, https://portal.cdp.coinbase.com/) once
   ready for mainnet — keep OFF (current default) until the testnet e2e has passed.
