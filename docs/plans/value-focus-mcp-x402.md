# Value Focus: Agent Economy Last Mile (MCP + x402), zk surface, quantum = content

*2026-08-28. Decision doc from on-chain traction research + repo capability audit. Supersedes vague "which narrative" debates — the evidence is in.*

## Ranking (real growth × capture-within-weeks)

| Thesis | Evidence (dated) | Suwappu status | Verdict |
|---|---|---|---|
| **x402** | 157.4M cumul. tx / $41M vol (x402scan, Jul 2026); Linux Foundation + Visa/Mastercard/Google (Jul 2026); 0x sells Swap API to agents @ $0.01/req via x402. x402 *tokens* are dust — it's a rail, not a trade. | Middleware + Coinbase CDP facilitator **code-complete** (`api-ts/src/middleware/x402Payment.ts`, `FacilitatorService.ts`) but "not yet exercised against a live facilitator"; e2e script exists (`api-ts/scripts/x402-e2e.ts`). Prod flag state unverified. | **Ship first** |
| **MCP** | ~97M monthly SDK downloads (Mar 2026, single-source); BitGo/Coinbase/CoinGecko/deBridge ship servers; Chrome 146 native MCP. MCP tokens = dust; pure plumbing. | **Live server, 22 tools** (`api-ts/src/routes/mcp.ts`, `mcpTools.ts`) w/ per-tool x402 pricing; WebMCP on showcase (15/15 evals). Gap: npm pkg stale at 0.1.1 (repo at 0.6.0), **no public registry listing anywhere**. | **Ship first** (pairs with x402) |
| **zk** | ZEC ~$888 8-yr high Aug 25 on Grayscale NYSE ETF (~$260M AUM); zk-rollup TVL ~$9.6B (zkSync 4.1 / Linea 3.4 / Scroll 2.1 / Starknet 1.5). Genuine new institutional money. | 4 zk chains already swappable (`bot/config/chains.py:156,192,228,367`). No privacy features. | **Surface, don't build**: privacy-sector trending module now; scope Railgun/Aztec shielded swaps only if momentum holds past Sept |
| **quantum** | Narrative-driven; experts: ≥2029 earliest realistic threat; token data unreliable (flagged bad liquidity artifacts). No PQC standard to integrate. | Nothing (correctly). | **Content only** — a blog/badge, never a bot-dev task |

## The insight

Suwappu already built the leading agent-trading stack (MCP + A2A + x402 + SDKs + managed execution — breadth 0x doesn't have). The bottleneck is **distribution and activation**, not code:

1. `@suwappu/mcp-server` npm = v0.1.1; repo = v0.6.0 → agents installing via npx get a stale server.
2. No listing on modelcontextprotocol.io registry / mcpservers.org / Coinbase Agent.market / x402scan directory → agents can't discover it.
3. x402 facilitator settlement never e2e-tested; prod flags (`AGENT_METERING_ENABLED`, `X402_FACILITATOR_ENABLED`) state unknown → the meter may not even be running.

0x charging agents $0.01/request is the proof the business model works; Suwappu's catalog is broader (swaps + perps + predictions + lending).

## Tie-back to the viral mention (why this is one story, not two)

The $Suwappu moment is the distribution event; the agent rails are the substance behind it. Connected explicitly:

1. **The announcement thread carries the rails** — post 7 of the X thread (announcement doc) tells the coin-driven audience that the bot is also agent infrastructure (MCP + x402). Attention arrives for the meme, stays for the product.
2. **Holder perks extend to the agent side (scoped, not built)**: $Suwappu holders who register an agent get an x402 credit bonus / discounted per-call pricing — mirrors the Telegram fee tiers, closes the Phase 1.5 parity gap *and* gives the token utility in the growing surface instead of only the legacy one. MONEY-PATH; build in api-ts after the testnet e2e passes, reusing the holder-balance check semantics from `bot/services/wallet.py` (60s cache, fail-safe no-perk).
3. **Timing discipline**: agent-rails announcements and token-perk announcements ship together, once, with the disclosure block — not as a drip that looks like serial price-pumping.

## Execution order

### Now (this branch)
1. **x402 e2e on testnet**: run `api-ts/scripts/x402-e2e.ts` against the default testnet facilitator; document result. If it needs CDP keys/signer secrets → report exactly which env vars, so the founder can supply them. MONEY-PATH: any change to billing flags goes through money-path-reviewer.
2. **MCP publish-readiness**: verify `packages/mcp-server` 0.6.0 builds/packs clean (`npm pack` dry-run), restore the MCP registry entry (`packages/openclaw/server.json` per `docs/plans/mcp-unification.md`), run `bun run check:mcp` (schema drift gate), verify `.well-known/agent-card.json` accuracy.
3. **Registry submission kit**: one doc with everything needed to submit to modelcontextprotocol.io registry, mcpservers.org, Agent.market, x402scan — so submissions are copy-paste once the founder has the accounts.

### Founder actions (can't be done from this session)
- npm publish of `@suwappu/mcp-server@0.6.0` (needs npm auth).
- Registry account submissions (kit prepared above).
- Prod env: confirm/set `AGENT_METERING_ENABLED`, `X402_FACILITATOR_ENABLED`, `CDP_API_KEY_ID/SECRET` on Railway (Railway MCP tools can do this from a session once authorized — say the word).

### Next (scoped, not started)
- Privacy-sector trending module (webapp/showcase): ZEC/RAIL + zk-sector tokens in trending — cheap, chains already supported.
- Mainnet x402 flip after testnet e2e passes + money-path review.
- Railgun/Aztec shielded-swap adapter: `chain-support` scoping doc ONLY if zk momentum persists.

### Explicitly not doing
- Quantum anything beyond marketing content.
- Trading/promoting "x402"/"MCP" ticker tokens — the research shows they're dust; the value is the rails.

## Sources
x402: Chainalysis x402 adoption report; x402scan (Jul 19 2026 snapshot); crypto.news on x402 Foundation; The Defiant on 0x agent API. MCP: bitcoin.com MCP-in-2026 roundup (single-source, flagged). zk: L2Beat-derived TVL via coingabbar (Apr 2026); tradingkey/cryptotimes on ZEC ETF (Aug 2026). Quantum: cointelegraph expert survey. Full citations in session research logs.
