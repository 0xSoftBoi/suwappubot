---
name: autopilot-goal
description: "Standing goal: work every phase of docs/plans/autopilot-unblock.md until the autopilot trades, earns a statistically meaningful track record, and is ready for mainnet. Shows the phase backlog with file:line anchors. Usage: /autopilot-goal [phase|item]"
---

# /autopilot-goal — Make the autopilot trade, then make it trustworthy

Standing goal: **every phase of `docs/plans/autopilot-unblock.md` shipped and verified.**

The agent (`suwappu-omni`, paper, 5 chains) discovers correctly, gates correctly,
seals correctly, and accounts correctly — and has never opened a position,
because `lp_locked` is declared and never assigned. Read the plan before working
an item; it carries the measurements each fix is justified by.

## How to use
- `/autopilot-goal` — take the next unchecked item in phase order, **re-verify its
  file:line anchor against current code** (anchors drift), implement it, run the
  phase's verification, check it off here, and commit the checkbox edit alongside
  the work.
- `/autopilot-goal <phase|item>` — jump to one (e.g. `/autopilot-goal 2` or `2.3`).
- One phase ≈ one PR. Don't batch phases. Items may split if independently shippable.
- New gaps found while implementing get ADDED here under the right phase.
- Goal is DONE when every box is checked; archive this skill in a final commit.

## The standing acceptance test

Six bugs this session shared one shape: none threw, none logged, each rendered as
a plausible number or a sensible refusal. Before checking any box, answer:

> **If this dependency broke right now, would anything say so?**

If the answer is no, the item is not done.

## The backlog

### Phase 1 — Make the agent capable of trading at all `[small]`
Goal is one honest fill, not good fills.
- [x] 1.1 **DONE** — `bot/services/token_intel/lp_lock.py`, wired through
      `intel_service.analyze` and `/internal/token-security`. Tri-state, 10 tests.
      Verified live on Base: KEYCAT 99.98% burned -> True, RUSSELL 100% -> True,
      TIBBIR 0% -> False, MIGGLES -> None (RC2 bug). **Coverage caveat that
      reorders this phase**: only ~28% of trending pairs are V2-style with a
      fungible LP token. ~42% are V3/V4/CLMM (positions are NFTs — undetectable
      this way) and ~27% are Solana (different model). So 1.1 gives real verdicts
      for roughly a quarter of the universe, and **1.2 is the load-bearing fix**,
      not this. Original text: **Implement LP-lock detection** (EVM). `lp_locked` is declared at
      `api/routes/internal.py:507` and assigned nowhere — one grep hit in the whole
      Python codebase. Detect: LP tokens burned to `0x0`/`0xdead`, or held by a known
      locker (Unicrypt, Team Finance, PinkLock). Populate truthfully; leave `null`
      where genuinely unknowable. Consumed at `api-ts/.../market.ts:466`.
- [x] 1.2 **DONE** — `allowUnknownLpLock` / `allowUnknownHolders` in `AutopilotRules`,
      both default **false** (fail closed is right for a money system). A measured
      negative always refuses whatever the flag says; only absent data is governed
      by it. Refusal text now names the flag that would permit it. 12 tests.
      Original: **Split "not locked" from "cannot tell."** `gates.ts:302` (`requireLpLocked`)
      and `gates.ts:292` (`holder_concentration`) both collapse absent data into
      refusal. Add a rule flag so an operator chooses whether unknown blocks. A real
      negative must stay a refusal.
- [x] 1.3 **DONE, differently than planned** — `diagnoseChronicRefusal` in `gates.ts`,
      called at the end of every cycle. A fixture-per-chain boot check would rot and
      only catches known fields; this catches the general class from live data: if one
      rule has refused every decision in the last 20, it logs an error and journals it.
      Would have caught `lp_locked` on day one, and catches the next one too. 5 tests.
      Original: **Boot-time gate-satisfiability check.** For a known-good token per allowed
      chain, assert the security payload carries every field the gates require. A gate
      that can never pass must fail loudly at startup, not silently forever at runtime.
      This is the item that would have caught 1.1 on day one.
- [ ] 1.4 **Verify live**: `suwappu-omni` opens a position on dev, and the decision's
      gate verdict shows real values (not `unknown`) for lp and holders.

### Phase 2 — Make holder data reliable `[medium]`
- [x] 2.1 + 2.2 + 2.3 **DONE, and it went further than planned.** The proper fix
      was not retry/backoff on Blockscout — it was replacing it. New
      `bot/services/token_intel/goplus_source.py` calls GoPlus Security
      (`api.gopluslabs.io`), which covers base/bsc/robinhood/solana in one call and
      resolves V2/V3/V4/Solana AMMs correctly by reading the actual position/vault
      contracts, instead of assuming (as the retired Blockscout heuristic did) that
      a pair's DexScreener address is always a fungible ERC-20 LP token.
      **That assumption was proven false on the exact tokens 1.1 used as proof of
      correctness**: KEYCAT and RUSSELL (both UniswapV4) were reported
      `locked=True, burned≈100%` by the old code. GoPlus shows both `is_locked: 0`
      — the liquidity sits, unlocked, in the standard V4 position manager. The old
      code was reading the wrong address's data and never knew it; the 99.98%
      "burn" it saw was the base token's own supply burn, not the LP's.
      Also found and fixed while validating this: GoPlus's `holders` array tags a
      burn address `is_contract: 0`, same as an ordinary wallet, so a heavily-burned
      fair-launch token would otherwise fail `holder_concentration` at ~100% for
      being safe. Burn addresses are now excluded from `top_holder_pct`, same
      treatment as pool/contract addresses.
      `evm_source.py` gained a `skip_holders` param so the redundant, now-optional
      Blockscout `/holders` call is skipped when GoPlus already answered — it no
      longer runs on the hot risk-gate path at all when GoPlus covers the chain.
      GoPlus's own batch parameter (comma-separated addresses) silently returns
      only the first address with no error — verified live, not used.
      HyperEVM: GoPlus does not cover it either (confirmed via
      `/api/v1/supported_chains`). `lp_locked` stays `None` there with an explicit
      reason string, feeding into 1.2's `allowUnknownLpLock` flag rather than a bug.
      30 tests, including one that reproduces the KEYCAT/RUSSELL regression exactly.
      `lp_lock.py` (the retired Blockscout heuristic) is kept, unwired, with a
      docstring explaining the bug it had — its test suite still documents a real
      trap for whoever next assumes a DEX pair is always an ERC-20.
- [x] 2.4 **Verified unnecessary.** GoPlus's failure mode is "does not cover this
      chain" (a static, known set) rather than an intermittent flaky endpoint —
      there is nothing to cache negatively. The throttle (`_MIN_INTERVAL_S`) plus
      shape validation (`code == 1`, dict result) cover what remains.
- [x] 2.5 **Verified live**, not yet at 50-decision scale. KEYCAT, RUSSELL, MIGGLES,
      TIBBIR on Base all now return real `lp_locked` (correctly `False` on all four
      — none of these particular tokens turn out to be actually locked) and
      `top_holder_pct` under 1% once burn addresses are excluded. Formal 50+
      decision measurement is now unblocked and can run against `suwappu-omni`'s
      live cycles.

### Phase 3 — Close the discovery and safety gaps `[medium]`
From `docs/research/autopilot-literature.md` items 5–7.
- [ ] 3.1 **Unique-buyer / wash-trade signals** into `Candidate`. MELT's ablation puts
      market-activity features as the most predictive group. GeckoTerminal already
      returns per-window buyer/seller counts — a parsing change in `market.ts`. The
      system prompt already tells the model to distrust turnover far above depth and
      never gives it the data to apply that.
- [ ] 3.2 **Decide HyperEVM.** Confirmed absent from GoPlus too (not just Blockscout)
      — `/api/v1/supported_chains` does not list it. With 1.2 shipped, this is no
      longer "refuses everything forever": it degrades to the `allowUnknownLpLock`/
      `allowUnknownHolders` posture like any other unmeasurable case. Still worth an
      explicit operator decision on whether that posture is acceptable for a chain
      with zero security tooling, or whether to drop it from `allowedChains` until
      one exists.
- [ ] 3.3 **Clustered-holder concentration** in `token_intel`. `topHolderPct` is
      defeated by splitting across 20 fresh wallets; MELT's bundle features cluster
      coordinated accounts first.

### Phase 4 — Earn the track record `[long, unshortenable]`
- [ ] 4.1 Paper agent runs unattended until `track_record.significant` is true, or the
      record is long enough to say the edge is not there. No code. The panel already
      reports both honestly.
- [ ] 4.2 **Sizing map recalibration** (research item 6). BLOCKED until 4.1 yields a
      reliability curve. `llmThesis.ts` sizes as `budget x confidence`; the calibration
      literature says that scalar is systematically inflated. Changing the map before
      measuring our own calibration repeats the mistake the research identified.

### Phase 5 — Mainnet `[gated on human judgement]`
From `docs/agents/autopilot-mainnet-readiness.md`. B1–B4 and B6 are closed.
- [ ] 5.1 **Human money-path review** of the B1–B4/B6 diff. Claude wrote it and is the
      wrong reader of it.
- [ ] 5.2 **One real testnet swap** through `ManagedExecutor`. Eight tests against a
      stubbed API prove the branches, not the live API's response shape.
- [ ] 5.3 B5 — the track record. This is Phase 4.
- [ ] 5.4 **First live agent**: smallest viable size, one chain, `maxOpenPositions: 1`,
      a daily loss halt that would not hurt to hit. Human decision, not the agent's.

## Operational notes
- Old agent `suwappu-alpha` still needs retiring — needs `X-Admin-Key`, which this
  session cannot read (Railway returns names, not values). One curl from the operator:
  `POST /admin/autopilot/suwappu-alpha/status {"status":"stopped"}`.
- Dev deploy ordering: a new column must ship BEFORE the code that reads it. The
  additive ALTER runs on python-api boot; api-ts deploys minutes sooner. See
  `docs/DECISIONS.md`.
