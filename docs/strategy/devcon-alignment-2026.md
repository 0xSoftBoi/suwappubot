# Suwappu × Devcon: Alignment Strategy (v2, transcript-based, 2026-11-06)

**Evidence base**
- **Devcon 7:** 410 transcripts from api.devcon.org, plus 5 broken ones re-transcribed locally.
- **Devcon 8 and Devconnect Buenos Aires:** YouTube captions are IP-blocked, so 90 talks were downloaded as audio and transcribed with Whisper (ranked by relevance).
- Read in depth by 4 researchers. Per-talk notes and quotes are in [`devcon-research/devcon7-transcripts.md`](devcon-research/devcon7-transcripts.md) and [`devcon-research/devcon8-devconnect-transcripts.md`](devcon-research/devcon8-devconnect-transcripts.md).
- v1 of this doc was built from talk descriptions only. Several v1 calls were **wrong** and are reversed below (§5).

---

## 1. The thesis, in their words

Across three events the message to app builders has converged.

1. **Trustlessness is hygiene, not a feature.**
   - Vitalik: *"Trustlessness is not something you should think about as a feature. Trustlessness is hygiene."*
   - Trust leaks through server-hosted UIs, RPCs, relayers and custodians.
   - EF co-ED Tomasz Stańczak called out *"very dishonest practices on the marketing side… not disclosing all the risks."*
2. **Limits go on the wallet, not the prompt.**
   - MetaMask: *"If the model is fooled, the wallet still says no."*
   - Audrey Tang: hard caps, on-chain receipts, and a human above the caps; LLM-enforced rules are soft.
   - Base shipped spend-only permissions because *"users are not informed enough"* to approve arbitrary-call session keys.
3. **Validate execution; don't just protect keys.**
   - The $7.5M JaredfromSubway hack: *"His keys were never really stolen. His bot signed exactly what the attacker wanted"*. That was 66 unlimited approvals to fake tokens.
   - Blockaid: an allowlisted router can still send output to an attacker through its `to` parameter.
   - Sourcify on Bybit: *"The signers trusted, but they didn't verify."*
4. **Chain abstraction must not hide risk.**
   - L2BEAT: a user lost 87% to slippage because the UI silently used an external bridge.
   - Peanut: *"either you expose the risk… or you curate it for them and then don't get surprised if people… hunt you down."*
   - L2BEAT will now publicly list every interop protocol, without being asked.
5. **Agents: identity plus thresholded autonomy, not "give the AI your wallet".**
   - ERC-8004 plus x402 plus MCP/A2A is the agreed stack, but the 8004 registry is noise: only 2.24% of 386k agents are healthy.
   - The intents panel: *"If you tell me your entire wallet is now the property of an AI… oh my God, no."*
   - LLM-only traders lost money; rule-bounded agents won.
6. **Privacy by default is coming.** Kohaku SDK (Railgun, Privacy Pools, Helios, Tor) gets a broader release in about 2 months. Lefteris: *"A free product always hides a data tax."*
7. **The clock is set.**
   - PQ "Mission 2028": Glamsterdam around Jan 2027, Hegota around Aug 2027, full PQ by Dec 2028. 72% of ETH sits behind exposed pubkeys.
   - "One Ethereum" same-block composability targets its first chain around Q1 2027.

## 2. Where Suwappu actually stands (verified in code today)

| Devcon expectation | Suwappu today | Verdict |
|---|---|---|
| Hard limits outside the agent | `PolicyService.ts`: chain/token/destination/contract allowlists, fail-closed; approvals service; hash-chained audit | ✅ **Real asset.** The "limits on the wallet" thesis, already built |
| Outcome-based policy (simulate, check who gains) | Policy checks *targets* only, with no simulated-delta check | ❌ The exact gap Blockaid named |
| No unlimited approvals | `approval_mode` **defaults to `"unlimited"`** (`bot/config/settings.py:1232`); CCIP/SunSwap/CoW paths hard-code max uint | ❌ **The same pattern as the $7.5M hack.** Fix first |
| Route risk disclosure | LI.FI routes shown without the settlement trust model | ❌ |
| ERC-8004 identity + published execution quality | Not present. We *do* have post-trade scoring and markouts | ❌ Cheapest high-signal win |
| x402 / MCP / A2A | Built, metering on | ✅ Ahead of most teams |
| Self-custody / walkaway | Custodial KMS by default, omnibus deposits; the non-custodial path is terminal-only | ❌ Fails "not your silicon, not your keys". Also a regulatory exposure (MiCA front-end test, money-transmitter framing) |
| Clear signing (ERC-7730) | Absent | ❌ |
| Snipe / memecoin | Headline features | ⚠️ Misaligned as the *headline*; FOCIL doesn't cover the ~47% private flow these depend on |
| PQ readiness | Hot and omnibus keys have exposed pubkeys | ⚠️ "Bunker mode" applies to custodians, so it applies to us |

## 3. Positioning

**"The execution venue that says no for you."**

The verifiable execution layer for traders and AI agents:
- hard limits enforced outside the agent;
- every route's trust model disclosed;
- every fill receipted and scored;
- your keys, or a custody model you can walk away from.

Why this works:
- The Devcon consensus is that *agents should never hold the keys or set the limits*. That is the gap nobody owns and the thing Suwappu already half-built (policy gate + approvals + audit chain + execution scoring).
- Generic "cross-chain swap aggregator" is commoditising. Wallets will embed intent APIs (Goldfeder, ZeroDev, OIF), and CoW is building a cross-chain auction across Ethereum, Solana and Tron.
- The defensible layer is **policy + verification + receipts**, sold to agents and institutions.

Disclosure won't convert retail: L2BEAT says LI.FI told them showing risk *"did not change the user's behavior"*. It *does* sell to institutions on liability grounds. So route disclosure is an **Enterprise/agent feature first**, and retail second.

## 4. Build plan (ranked; ⚠️ = MONEY-PATH, needs `money-path-reviewer`)

### P0: close the holes Devcon speakers used as cautionary tales (this sprint)
1. ⚠️ **Flip `approval_mode` default to `exact`.** Remove the hard-coded max approvals in `ccip_api.py:479`, `sunswap_api.py:300` and `cow_api.py:496`. Add an approval-revoke sweep for existing user allowances.
   - Source: the $7.5M hack.
   - Accept the extra approve tx; batch it with 7702 later.
2. ⚠️ **Outcome-based policy check.** Simulate each agent tx and block if any address other than the user or allowlisted destination gains value, even when the router is allowlisted. Deny EIP-712 permits to unknown spenders by default.
   - Sources: Blockaid, 1Claw.
   - Acceptance: an allowlisted-router swap whose `to` is an attacker gets rejected.
3. **Verify the "Railway env-var key breach" claim** (1Claw, unverified) and audit which secrets sit in Railway env vars. *Not your silicon* applies.

### P1: become the credible agent venue (next 4–6 weeks)
4. **ERC-8004 registration**: A2A agent card plus MCP endpoints, using the Agent0 SDK.
   - **Publish our execution receipts** (post-trade scoring, markouts) to the validation and feedback registries, in 8004scan's 5-field metric format (property / numerator / denominator / time / limits).
   - Registry noise is our opening: be the venue with *real* receipts.
5. **Thresholded autonomy ladder** in the policy layer, following Base's spend-permission shape:
   - spend-only scopes, amount per period, expiry, one-click revoke;
   - human approval above a threshold, with the threshold rising as the agent's track record grows (Across/intents panel);
   - arbitrary-call permissions off by default.
6. ⚠️ **Route trust disclosure plus size bands.** Per quote, show:
   - settlement path (canonical / CCTP / LZ DVN config / escrow+oracle / transfer-to-solver-EOA / HTLC);
   - who can steal; who can freeze;
   - refund path;
   - destination chain's L2BEAT stage.

   Above a size threshold, route only to CCTP/canonical/atomic rails. First step: **audit which settlement paths our LI.FI routes actually land on**. No single score (L2BEAT rejects scores).
7. **MCP read provenance**: add block number, source and freshness fields on every quote and read tool (Envio).
8. **Venue compatibility matrix**: smart-account wallets break on Polymarket (no 1271) and Hyperliquid (K1 only). Agent wallet type is chosen per venue (Clave).

### P2: walkaway + privacy (quarter)
9. ⚠️ **Custodial exit and transparency.** Key export, withdraw-all, a public "walkaway" page, published front-end hashes. Make the non-custodial path first-class beyond the terminal.
   - Regulatory angle: non-custodial avoids money-transmitter framing (Williamson), and MiCA's front-end test reaches custodial bots (EUCI). Get counsel review before EU push.
10. **ERC-7730 clear-signing descriptors** for our router and approval calls on non-custodial flows.
11. **Privacy as a paid Pro feature (non-custodial only):** Privacy Pools / Railgun deposit toggle via Kohaku SDK when it releases (~2 months), Helios light client, Tor. Do **not** promise privacy for custodial wallets. Revenue model per Lefteris: explicit premium, no data monetisation.
12. ⚠️ **PQ "bunker mode" for custodial keys.** Minimise pubkey exposure of omnibus and hot wallets (fresh receive addresses, rotation), and plan migration aligned with Hegota (Aug 2027) and the Dec 2028 target.

### P3: watch / adapters
13. **Quote-source interface** that can slot in **EIL** (testnet; wallets self-execute) and OIF sources later. Do **not** make ERC-7683 our interface (see §5).
14. **Track CoW's cross-chain auction** (a direct competitor including Solana and Tron) and "One Ethereum" (first chain ~Q1 2027).
15. **India**: the Devcon 8 rails talk warns to avoid outbound flows, and Tether freezes are a real risk; x402 at scale needs cumulative vouchers.

## 5. What v1 got wrong (corrected by transcripts)
- **"Adopt ERC-7683" → don't.** Chellani (Socket) says it is broken as an interface: only 15–20 fillers, and it standardises the order but gives users no execution guarantee. Yoav Weiss says solver intents have structural griefing and oracle problems, and that EIL removes the solver. Correct posture: an adapter, not a foundation.
- **"Disclosure builds trust with users" → only with institutions.** LI.FI/Socket data says retail ignores it.
- **"MEV protection on by default" → still right, but the bigger hole is approvals and outcome checks.** Speakers agree MEV is unsolved at the protocol level, and that agent losses come from unvalidated execution.
- **v1 treated agents as a marketing angle → it's the core.** Devcon's agent consensus is a near-perfect description of our control plane, minus simulation and receipts.

## 6. Go-to-market
- **Flagship post (original data):** "What our policy gate blocked." Publish blocked-tx stats, the approvals-exact migration and outcome-check catches, with execution receipts. That meets the research-post bar.
- **Talk submissions** (Devconnect 2027 / Devcon 9): *"Limits on the wallet: receipts from an agent execution venue"*, using real fill and markout data plus 8004 validation results.
- **Copy rules:**
  - never call omnibus custody "self-custody";
  - lead with agents, policy and receipts; keep snipe as a power-user feature, not the hero;
  - always disclose route trust in docs.
- **Grants/partners:** EF ESP for clear signing and Kohaku integration. 8004 ecosystem (MetaMask AI, EF dAI) for agent-card listing. **Lefteris's caution:** grants are not a revenue plan.

## 7. Decisions needed (founder)
1. Flip `approval_mode` to `exact` globally? It costs one extra approve tx per new token pair. **Recommend yes.**
2. How far to de-emphasise snipe and launch features in public positioning. Recommend: keep in product, drop from hero copy.
3. Is custody posture changing (exit path now; non-custodial-default in the Mini App later)?

## 8. Follow-ups
- Re-run ASR on the remaining ~90 Devcon 8 videos if a topic needs depth (pipeline: `$CLAUDE_JOB_DIR/tmp/scripts/pipeline.py`; the job dir is temporary).
- The "End-to-End Privacy" keynote video was removed; check for a re-upload.
