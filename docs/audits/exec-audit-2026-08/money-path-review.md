# Money-Path Review (Opus) — Adversarial verification of exec-audit findings

**VERDICT: BLOCK on the original memo's this-week list.** 2 of 5 findings materially mis-stated; verification surfaced two larger revenue bugs the memo missed. Corrected priorities below; original verdicts in full.

## 1. USDT0 phantom fee — PARTIALLY CONFIRMED (mis-scoped both directions)
- Mechanism real: `swap_engine.py:1751-1756` sends no `platform_fee_bps` (`_get_usdt0_quote` signature `:3394-3404` has no such param); `swap.py:1525-1534` records the fee provider-agnostically; sweeper `fee_service.py:656-661` flips `collected=True` with a bare UPDATE, no on-chain check — reconciliation launders the phantom, doesn't catch it.
- **Overstated:** `usdt0_bridge_enabled` defaults False (`settings.py:419-423`, gate at `swap_engine.py:939`) → latent, not live. HIGH → MEDIUM (latent).
- **Understated:** the same defect is LIVE on `layerzero` (`:1743-1748`), `cctp` (`:1795-1799`), `ccip` (`:1802-1806`), `across` (`:1809-1819`), `wormhole` (`:1821-1824`) — all raced with no fee param, all recording phantom fees via `swap.py:1525`. That class is **HIGH**.
- Fix: add `fee_bearing: bool` to `SwapQuote`, set only where `platform_fee_bps` passed AND collector gate passed; `record_fee` skips when false. **Side effect:** `referral_service.record_reward` + `points_service.award_swap_points` (`swap.py:1544/1559`) key off `fee_usd` — decide deliberately if fee-free routes still earn XP/referral.

## 2. /rewards collision — CONFIRMED, worse than claimed
Not PTB dispatch order — **import shadowing**: `main.py:42` imports `rewards_handler` from `handlers/rewards.py`; `main.py:243` re-imports the same name from `handlers/points.py`, rebinding it. `main.py:594` ("MONEY-PATH") registers points' handler twice; `rewards.py:228` is **never registered**. The claim button (`rewards_claim`, emitted only at `rewards.py:119`) is unreachable; its callback handler at `main.py:595` waits for an event nothing can produce. Rewards v1 fee-cashback is dead in prod. HIGH confirmed.
Fix: alias the import (`as fee_cashback_handler`), register at `:594`, dedupe `:459`, distinct command names. **Side effect: `rewards_claim_callback` credits custodial balances and has NEVER run in prod — it needs its own review before the "one-line" fix ships.**

## 3. Points-store ENTERPRISE — CONFIRMED grant chain, redemption code sound
Grant chain real: `points.ts:432-440` → `points_service.py:782-786` → `x402_service.py:280-300` → `TIER_FEE_RATES[ENTERPRISE]=0.001` (`fee_service.py:38`). No tier ceiling. But redemption is well-built: FOR-UPDATE lock (`:751`), single-txn deduct+grant (`:763-786`), idempotency with durable replay (`:819-829`), spends `current_points` only. Pricing internally consistent (~$99.99 equiv). **MEDIUM — memo's "risk accepted" stands.** Cheap lever: set `is_active=false` on the ENTERPRISE reward row (no code change).

## 4. Fee-collection no-op — CONFIRMED, silent by design, no boot validation
Collectors default None (`settings.py:1340/:1388/:1391`); only one `field_validator` exists in settings (battle_treasury, `:1466`). All 8+ aggregator paths fail silent-open (0x `zerox_api.py:171`, Kyber `:104`, OKX `:132`, 1inch `:99`, Li.Fi `swap_engine.py:2154`, PropAMM `:3273`, CoW/Socket `:1830`, Jupiter `:2456`). The gating is correct engineering; the bug is `fee_service` isn't on the same gate — user is shown a fee (`swap.py:1169`), ledger records it, sweeper marks collected. Same phantom-fee defect as #1 at 100% blast radius when unset. *(Prod pull: EVM + Jupiter collectors ARE set; `FEE_COLLECTOR_SOLANA` is NOT — so the sweep path is the live instance of this.)*
Fix: `model_validator` logging CRITICAL at boot when collectors unset + route `record_fee` through the collector gate. **Side effect:** correcting the ledger retroactively zeroes phantom historical revenue — coordinate before backfill.

## 5. Quickswap fee non-disclosure — REFUTED; larger bug found in its place
`quickswap.py:183-190` omits `platform_fee_bps` (default None, `swap_engine.py:1376`); every fee-builder short-circuits on falsy bps → **no fee is charged, so the no-fee confirm screen is accurate, not deceptive.** The real defect: `quickswap_confirm_callback` (`:251-353`) never calls `record_fee` — repo-wide, `record_fee` has exactly two call sites (`swap.py:1525`, `bulk_swap.py:930`); `/s` is in neither. **Net: `/s` collects $0, records $0, awards no referral, grants no XP — and `nl_trade.py:408` routes ALL natural-language trades through it.** Corrected severity: **HIGH revenue leak** (the disclosure framing was the wrong problem).
Fix: pass `platform_fee_bps=fee_service.get_fee_bps(...)` as `swap.py:1092-1095` does; add fee line to confirm text; add record_fee/referral/points to the confirm callback. **Side effect — genuinely risky: this is a live price increase for every `/s` user; it MUST land with the disclosure line in the same commit** or it becomes the exact undisclosed-markup pattern originally (wrongly) alleged. Preserve the no-re-quote consistency (`:228` stores, `:306` executes).

## Cross-cutting conclusion
Findings 1, 4, 5 are three faces of one root cause: **the fee ledger is not gated on whether a fee leg actually reached the chain.** Fix the `SwapQuote.fee_bearing` contract once; make `record_fee` and the sweeper honor it. Three separate tickets = three inconsistent patches.

Also blocking the memo's runbook: `sweep_all_fees` marks collected with no on-chain check (`fee_service.py:656-661`) — until fixed, the reconciliation SQL cannot distinguish real from phantom revenue, so it cannot answer the memo's "single most consequential unknown."
