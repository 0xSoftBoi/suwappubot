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
- [ ] 1.1 **Implement LP-lock detection** (EVM). `lp_locked` is declared at
      `api/routes/internal.py:507` and assigned nowhere — one grep hit in the whole
      Python codebase. Detect: LP tokens burned to `0x0`/`0xdead`, or held by a known
      locker (Unicrypt, Team Finance, PinkLock). Populate truthfully; leave `null`
      where genuinely unknowable. Consumed at `api-ts/.../market.ts:466`.
- [ ] 1.2 **Split "not locked" from "cannot tell."** `gates.ts:302` (`requireLpLocked`)
      and `gates.ts:292` (`holder_concentration`) both collapse absent data into
      refusal. Add a rule flag so an operator chooses whether unknown blocks. A real
      negative must stay a refusal.
- [ ] 1.3 **Boot-time gate-satisfiability check.** For a known-good token per allowed
      chain, assert the security payload carries every field the gates require. A gate
      that can never pass must fail loudly at startup, not silently forever at runtime.
      This is the item that would have caught 1.1 on day one.
- [ ] 1.4 **Verify live**: `suwappu-omni` opens a position on dev, and the decision's
      gate verdict shows real values (not `unknown`) for lp and holders.

### Phase 2 — Make holder data reliable `[medium]`
- [ ] 2.1 **Validate shape, not status.** `base.blockscout.com/api/v2/tokens/{a}/holders`
      returns **HTTP 200** with body `"Internal server error"` — valid JSON, but a
      string. `res.ok` passes, `.json()` succeeds, the caller treats a string as a dict
      and the field silently stays unset. Fix generically: anywhere we trust `res.ok`
      we are one bad gateway from silently wrong data.
- [ ] 2.2 **Fallback source order per chain** in `bot/services/token_intel/evm_source.py`
      (`BLOCKSCOUT_BASE_URLS`): Blockscout → native explorer API → aggregator. First
      usable shape wins.
- [ ] 2.3 **Retry + backoff** on the holder call, mirroring `market.ts`'s
      `throttleGecko`. Necessary but not sufficient — 2.1 is the real fix.
- [ ] 2.4 **Cache negative results briefly** so a broken upstream isn't re-queried
      every cycle for every token.
- [ ] 2.5 **Verify by measurement**: holder coverage on Base over 50+ decisions,
      reported as a number. Target >80%. Baseline today: 8/40, and all 8 are one
      cached token.

### Phase 3 — Close the discovery and safety gaps `[medium]`
From `docs/research/autopilot-literature.md` items 5–7.
- [ ] 3.1 **Unique-buyer / wash-trade signals** into `Candidate`. MELT's ablation puts
      market-activity features as the most predictive group. GeckoTerminal already
      returns per-window buyer/seller counts — a parsing change in `market.ts`. The
      system prompt already tells the model to distrust turnover far above depth and
      never gives it the data to apply that.
- [ ] 3.2 **Decide HyperEVM.** No Blockscout exists (`hyperevm.blockscout.com` 404,
      `hyperscan.com` redirects off-chain), so the holder gate can never pass. Drop it
      from `allowedChains` until a source exists, or accept a permanent refusal
      stream. Recommendation: drop. Recorded as `CHAINS_WITHOUT_HOLDER_DATA`.
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
