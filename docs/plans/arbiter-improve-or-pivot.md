# Arbiter: improve or pivot (research synthesis, 2026-11-05)

Method: two standard-mode web-research passes (competitive landscape; pivot options). Secondary sources only, no primary-source fetches. Items marked UNVERIFIED need a primary check before any public claim.

## Verdict

The tech is real; demand is unproven. Nobody found does "TEE fetches the evidence, contract releases on pass", so the combination is unclaimed. But agent-commerce volume is thin and partly artificial (x402: about half of reported transactions reportedly artificial, about $28k/day real; Virtuals ACP concentrated in <0.3% of agents and slowing). Every GitHub-PR-escrow competitor is hackathon-stage. Algora covers "pay when merged" with a free maintainer click.

**Do not pivot away. Stop positioning PR-merged as the product.** It is a proof-of-concept rubric. The product is a *deterministic, attested verifier* that other payment and job systems call.

## What to change

1. **Widen rubrics beyond PRs** (cheap, reuses the in-enclave HTTPS fetch): URL/hash match, JSON-schema check, HTTP status/latency, on-chain state reached. These are the deliverables agents actually transact on.
2. **Make it callable from where agents already pay**:
   - Primary: **"Arbiter Pay" = pay-on-delivery for x402 calls** (refund if the response fails an objective predicate). Reuses Suwappu's x402 metering, policy gate and audit chain. Many x402 escrow/refund projects exist (x402r, x402escrow, Kustodia) but none found use a TEE-attested verdict. Est. 8-10 days.
   - Also: **evaluator adapter for ERC-8183 jobs**. The spec allows the evaluator to be a contract; no attested deterministic evaluator service was found. ERC-8183 is still Draft, so treat as an option, not a dependency.
3. **Defer** Tier 2 reputation and Tier 3 outcome pricing until one external counterparty pays for one verification. Reputation fed by attested outcomes (vs client-submitted ERC-8004 ratings) stays the long-term moat.

## Options ranked (pivot report)

| # | Option | Verdict |
|---|---|---|
| 1 | Pay-on-delivery for x402 | Primary. Reuses most existing assets. Demand unproven; kill risk: Coinbase/facilitators ship refunds natively. |
| 2 | TEE resolver for prediction markets | Fallback. Real pain (UMA/Polymarket disputes) but the problem is wording ambiguity and distribution, not data fetch. Only long-tail/NEAR-native markets. |
| 3 | Bounty/grant conditional payments | Crowded commodity, needs two-sided marketplace. |
| 4 | Verified-fetch API | A feature (the engine inside #1), not a business; Opacity/Reclaim/TLSNotary well funded. |
| 5 | Copy-trading PnL attestation | Mostly vapor on Hyperliquid (PnL already public on-chain). |
| 6 | Enterprise SLA/insurance proofs | Vapor for a solo $0 founder. |

## Known weaknesses of the current design

- "Merged by someone other than author" is sybil-gameable; a merge is not quality.
- Buyer-chosen repo can be made private/renamed (GitHub 404) then refunded after deadline.
- GitHub unauthenticated rate limit on shared OutLayer IPs can force perpetual non-pass.
- Not mainnet; external audit and OutLayer confirmations still open (see docs/arbiter-production.md).

## 2-week slice (Arbiter Pay)

- D1-2 spec: x402 payment held with an objective predicate (200, schema match, non-empty, latency under N).
- D3-6 new WASM predicate module reusing the fetch code; refund on fail and on timeout; pin the hash.
- D7-9 `pay_if_delivered(url, predicate, max_usd)` as api-ts route + MCP tool, audit-chain entry per verdict, policy-gate hooked.
- D10-12 demo against 2-3 real x402 endpoints (one pass, one fail+refund), public refund log.
- D13-14 outreach to x402 API providers. **Kill criterion:** no integration or paid verification by week 4, then try the prediction-market fallback.

Cautions: MONEY-PATH (needs money-path-reviewer); keep api_credits (USD) and agent_credits (0.001-unit) separate; check both Python and TS x402 paths first; the x402 volume figure and ERC-8183 mainnet status are UNVERIFIED.

## Coverage gaps

Not researched: Bountysource, Gitcoin, Polar, AgentKit specifics, Algora/take-rate data, whether Coinbase has announced native x402 refunds.
