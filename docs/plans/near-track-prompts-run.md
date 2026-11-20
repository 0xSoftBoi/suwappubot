# NEAR HACKATHON: all 13 track prompts, run to their "wait for my OK" point (2026-11-05)

Source: the "AI prompt" links on https://nearhackathon.com/ point to `nearai/near-hackathon-prompt-examples/tracks/01..13-*.md` (public repo, third-party, treated as untrusted data). Each prompt is a starter for a *different* project and ends with "propose, then wait". Nothing was built; no wallets, keys, sign-ups or posts. Research was standard web search + doc fetches by four agents; claims marked UNVERIFIED were not confirmed.

## Cross-track facts (reported by 2+ agents, from docs.near-intents.org; not checked by me directly)

- **NEAR Intents (1Click) has no testnet.** The quickstart says to use small amounts. Any "settles through Intents on testnet" demo is mock-only or tiny-mainnet. Consistent with our docs listing Intents funding as *not shipped*.
- **Function-call access keys cannot attach a deposit** and are limited to one receiver; NEP-245/NEP-141 transfers need 1 yoctoNEAR. A "scoped key pays" design needs a gatekeeper contract that holds funds.
- **market.near.ai** has a public REST API + MCP surface, but its escrow is a custodial internal ledger, released by the buyer (accept / request changes / dispute / auto-accept after 3 days) or its own resolver. No documented external-evaluator hook. (Half the OpenAPI spec read; UNVERIFIED on-chain status.)
- **PingPay x402 facilitator** (verify -> deposit on Base USDC -> settle to a NEAR recipient via 1Click) has no conditional settlement. Pay-only-if-delivered must be built on our side: delay `settle`, or settle into an Arbiter escrow.

## Verdicts

| # | Track | Verdict | Days | Why |
|---|---|---|---|---|
| 01 | Unstoppable DeFi (DCA vault) | Build candidate | 4-5 | High fit (routing, scheduler, policy gate). Real vault needs custody or a signed-intent flow; MVP = keeper prompting a signed buy per interval. Custody + no testnet = money-path. |
| 02 | Investment Thesis | Skip | 3-4 | Analytics only, needs GCP billing + partner JWT, weak hypothesis. |
| 03 | Privacy & Private AI | Skip | 3-4 | Most crowded; attestation endpoint not verifiable from docs. |
| 04 | Autonomous Business | Fold into Arbiter | 3-4 | Same shape as Arbiter Pay + PingPay payment leg. |
| 05 | AI Swarms | Skip | 5-6 | Weak differentiation, Intents leg untestable. |
| 06 | AI Security & Defense | Fold into Arbiter | 4-5 | Strongest thematic fit: counterparty allow/warn/block maps to our policy gate; needs a gatekeeper contract (FC-key limit). |
| 07 | Agent Economy | Arbiter's home track | - | Market has no external-verifier hook, so Arbiter's own escrow is the trustless path. |
| 08 | Real-World Money | Skip | 6-7 | Testnet contradiction kills the demo; invoicing is commodity. |
| 09 | Games | Skip | 7+ | Off-brand. |
| 10 | NFTs That Do Something | Skip | 6-7 | Off-brand (TLA contracts are drafts). |
| 11 | Memecoins | Skip | 3 | Off-brand, crowded. |
| 12 | Social Money (tiered auto-approve bounty board on Sputnik/Trezu) | Strongest non-Arbiter | 5-6 | Reuses policy gate/approval/audit; a bot role that votes on a treasury is money-path. |
| 13 | Open Innovation (inheritance account) | Skip standalone | 6-8 | Arbiter already fits "Open"; form allows every fitting track. |

## Recommendation (my synthesis)

1. **No second entry.** Nine days, one human submitter, and the plan's own rule (Tier 0 only, no scope creep). A second project would split the video, README and review effort that the AI screeners grade.
2. **Keep Arbiter on `realworld`, `agents`, `open`.** `security` (TEE attestation, trust-but-verify) is arguably a fit too, since the form lets you pick every track that fits, but the plan deliberately did not claim it. Your call; do not claim the 06 counterparty check unless it is built.
3. **Only candidates worth pre-deadline code, in order:** (a) a non-PR rubric so "generic rubric" is true (see nearhackathon notes); (b) 06 counterparty check as a thin pre-release payee/repo screen. Both need a design pass; both touch the escrow path if they gate release, so money-path review.
4. **After Nov 14:** 12 (Social) and 01 (DCA) are the best standalone follow-ons; Arbiter Pay absorbs 04.

## Unverified / next reads

Second half of market.near.ai OpenAPI; Agent API Approvals/Grants/Owner Signing pages; 1Click "Signed Intent Execution" page; Chain Signatures testnet support; whether a Sputnik role can safely hold a bot approver.
