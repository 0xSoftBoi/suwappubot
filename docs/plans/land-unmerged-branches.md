# Landing Plan: Unmerged Branches (2026-08-09)

## The headline numbers

- **304** remote branches besides `main`.
- **41 open PRs** (40 distinct head branches).
- **6 branches fully merged** — zero commits ahead; safe to delete now.
- **~60 branches are pre-rewrite relics**: `main`'s history was restarted on
  2026-08-03 (main has only 116 commits total). Every branch showing
  "~1,500 ahead / 116 behind" forks from the *old* history — their "unmerged
  commits" are mostly history main already contains as a snapshot.
- **~41 recent orphan branches** (no PR, real divergence, Aug 4–8) — mostly
  agent/codex docs branches plus a handful of real fixes.

## Category A — delete now (fully merged, ahead=0)

```
agent/mobile-wallet-terminal
agent/redesign-showcase-homepage
fix-perps-async-callsites
fix-webmanifest-mime
fix/deployment-guardrails
terminal-bridge-mode-tpsl
```

## Category B — open PRs (41)

Split cleanly by whether the PR's branch was cut before or after the
Aug 3 history restart:

### B1. Fresh-base PRs (ahead ≤ 12) — mergeable as-is (~17)

- **Dependabot (10):** #693, #698, #699, #700, #701, #702, #703, #704,
  #778, #796. Merge policy per CLAUDE.md: check CI on every one, merge
  green, *fix* the red ones. Note #698 (turnkey 6→7 major) supersedes
  stale #531 (5→6) — close #531 when #698 lands.
- **Docs (4):** #766, #775, #794, plus #742 (docs-page CSS fix). Merge on
  green.
- **Code (3):** #760 `agent/robinhood-crosschain-hardening` — **MONEY-PATH**
  (touches `bot/services/swap_engine.py`), needs `money-path-reviewer`
  before merge. #774 responsiveness phase 2 (draft), #797 gecko mobile v0
  (draft), #802 showcase enterprise web system — review, mark ready, merge.

### B2. Stale-base PRs (ahead > 1000, pre-rewrite) — cannot merge as-is (~24)

Their diffs drag in ~1,400 commits of dead history. For each: run a
superseded check against main; if the work is missing, **port it** —
recreate the branch from current main carrying only the feature delta,
open a fresh PR, close the old one with a pointer. (No rebase — fresh
branch + applied diff.)

- **Port candidates (money/feature work):** #642–#648 (the Phase 0a–0f
  MONEY-PATH series: stablecoin gates, Polymarket CLOB/neg-risk,
  HyperLiquid TP/SL brackets, compliance spine), #641
  (worktree-tg-bot-improvements), #616 (MCP policy gate), #639/#640
  (terminal intel tiers), #753 (chain coverage drift guards).
- **Likely close as superseded/stale:** #531 (superseded by #698), #612
  (WIP salvage), #654, #676, #682, #683, #692, #705 (dependabot will
  re-file against new base), #706, #719, #725.

## Landing order

**Phase 1 — quick wins (no review needed)**
1. Delete the 6 fully-merged branches (Category A).
2. Dependabot sweep: CI-check + merge #693, #698–#704, #778, #796;
   close #531/#692/#705 as superseded (dependabot re-files).
3. Merge docs PRs #742, #766, #775, #794 on green.

**Phase 2 — fresh code PRs**
4. #760 through `money-path-reviewer`, then merge.
5. Review + land #802, then drafts #774, #797 (or explicitly close if
   not wanted).

**Phase 3 — valuable orphans (Category C, 13 branches)**
6. For each, superseded check first, then PR + `/ship`, money-path first:
   `fix/points-double-spend`, `fix/credit-float-precision`,
   `fix/log-token-leak-aegis-path`, then bugs, features, infra.

**Phase 4 — port the stale-base MONEY-PATH series**
7. #642→#648 in phase order (0a→0f), one fresh branch each from main,
   `money-path-reviewer` on every one, then #641, #616, #639/#640, #753.
8. Close the rest of B2 as superseded with a one-line pointer comment.

**Phase 5 — cleanup + guardrails**
9. Tag every branch before deletion (`archive/<branch>`) for zero-risk
   recovery, then bulk-delete: ~60 pre-rewrite relics (Category D),
   28 junk orphans (Category C), and all branches of merged/closed PRs.
10. Guardrail: stop the agent pipeline that keeps pushing one-commit
    `agent/docs-*` / `codex/docs-*` branches without PRs — that's 18 of
    the 41 orphans.

## Execution log (2026-08-09)

- **Merged (7):** #693, #700, #704, #775, #778, #796 (deps/docs), #766 (un-drafted, PQ docs).
- **Closed superseded (3):** #531, #692, #705.
- **RED deps needing fixes (5):** #698, #699 (TS quality), #701, #702 (SDK contract), #703 (showcase build) — TS 7.0.2 / turnkey 7 breakage.
- **Conflicted, re-landing via fresh branches:** #742, #794.
- **Phase 3 PRs opened (8):** #808 points double-spend [MONEY-PATH], #809 credit float-precision [MONEY-PATH], #810 bun test isolation, #811 perps agent auth, #812 native MPC, #813 CI trust, #814 builder contract, #815 webapp public-entry tests. 6 of the original 13 orphans were confirmed already in main and dropped.
- **#760: money-path review BLOCK** — 9 findings posted to the PR (critical: cross-provider bridges falsely marked COMPLETED; high: recipient substitution, 100% fee clamp, fee-bypass race). Fix queued.
- **Constraint:** remote branch deletion 403's in this environment (branch *creation* pushes work) — Phase 5 deletion needs an unrestricted machine or GitHub auto-delete on merge.

### Round 2 (same day)

- **Merged:** #810, #811, #815 (orphan land), #812 (native MPC — approved as inert scaffolding, pre-wiring gates posted), #774 (responsiveness — money-path APPROVE, 4 follow-ups posted), #802 (showcase enterprise, reviewer MERGE).
- **Closed:** #808/#809 (review proved both byte-identical to main — earlier "divergent" triage was wrong), #814 (zero-diff after conflict resolution — fully in main), #647 (ported as #817), #699/#701/#702 (superseded by #816).
- **Opened:** #816 TS 7.0.2 (api-ts/sdk/openclaw; showcase blocked by Next.js/TS7 upstream — #703 commented+left open; turnkey #698 held for its own money-path PR), #817 Polymarket CLOB V2 port [MONEY-PATH, review in flight].
- **Fixed on their branches:** #813 (env-schema drift regenerated, CI rerunning), #797 (utcnow→timezone-aware, verified byte-exact push).
- **#760:** BLOCK verdict posted (critical: cross-provider bridge status falsely COMPLETED; recipient substitution; fee clamp/bypass). Fix queued.
- **New bugs found in main during review (queued):** PointsService concurrency — double daily check-in credit, double first-swap bonus, double level-up bonus.
- **Ports in flight:** 648 compliance-spine (pushing), 642 stablecoin-phase0, 616 MCP policy gate. Remaining: 643 (after #817 merges), 641, 639/640, 753, audit 644/646.

### Round 3 (same day)

- **Re-lands:** #742→#818, #794→#819 (originals closed). #814 closed — zero-diff vs main after resolution. #616 closed — main runs a superset of the policy gate (unconditional, approval queue).
- **Ports opened:** #820 compliance-spine (from #648), #821 MPP gate (from #642).
- **Money-path verdicts:** #817 Polymarket port **BLOCK** (critical: bare-hex signature → every order rejected; no tick rounding; TS neg-risk gap) — fixer dispatched to the branch. #820 compliance port **BLOCK** (critical: OFAC file loader still drops TRON lines; Solana unscreened; ENFORCE fail-open) — fixer dispatched. Both re-review after fixes.
- **Stray branches for Phase 5 cleanup:** reland/tmp-bin-probe, reland/docs-dark-theme (deletion blocked in this env).

### Round 4 (same day)

- **Merged:** #816 TS7 (b71a03b), #819 research re-land (4052cb6). Total: 15.
- **Ports opened:** #822 chain coverage (aurora/blast/ink were orphan keys in 4 aggregator maps), #823 rug auto-sell + redemption idempotency (from #641's landable half — main's rug service was a demo stub; redemption idempotency helpers were dead code).
- **#641 remainder** (KMS-off-event-loop, TP/SL notify wiring) deferred to follow-up — real MONEY-PATH gap, tracked.
- **Review gate results:** #817 fix round 1 verified but tick-fix introduced a new CRITICAL (sub-tick price → 0.00 giveaway order; size-from-raw-price overpay) — round-2 fixer dispatched. #823 BLOCK (rug sell no-ops on Postgres String(20) mint truncation; flash-loan-defeatable floor; inert idempotency lock) — fixer dispatched. #820 fixes pushed (1835 tests pass) — re-review in flight.
- **Stragglers:** #813 conflicts resolved + pushed; #797 CI retriggered (app-authored pushes don't fire Actions — root cause); #818 fixed (bun.lock never synced with new dep). Closer agent polling to merge all three.

### Round 5 (same day)

- **Merged:** #813 (custody-boundary SDK work), #818 (docs dark-theme re-land), #797 (Gecko mobile v0, un-drafted after utcnow fix + workflow-file CI quirk: Actions refuses app-authored heads on workflow-modifying PRs). Total: **18 merged**. Phase 3 fully dispositioned.
- **Opened:** #824 PointsService concurrency fixes [MONEY-PATH].
- **Review-fix loop continues:** #817 round-2 fixes verified, final APPROVE with 2 medium follow-ups; CodeQL high (clear-text exception logging in key-handling scope) fixed on the branch. #820 round-2 pre-enforce fixes pushed (Starknet/BTC screenable, degraded-list fail-closed) — final review in flight. #823 fixes pushed (String(64) migration, startup capability gate, pool-age arming, durable redemption idempotency) — re-review in flight. #760 round-2 fixes pushed (provider-scoped CONFIRMING, 2h wall-clock give-up, read-only manual refresh) — final review in flight. #824 BLOCKED on a would-be prod-deploy-killer (unguarded duplicate constraint in migration 0018) — fixer dispatched.
- **#821/#822 RED** on quality gates — log-driven fixer dispatched.

### Round 6 (same day)

- **Merged:** #817 Polymarket CLOB V2 port (3 review rounds: bare-hex signature prod-killer → tick-bound giveaway orders → CodeQL false positive on HMAC request signing, documented and merged past the non-required gate), #820 compliance spine (3 rounds: OFAC loader dropping TRON → Starknet brick + degraded fail-open → APPROVE with pre-enforce follow-ups posted). #648 closed as ported. Total: **20 merged**.
- **#824** PointsService concurrency: final APPROVE (follow-ups posted: season-accrual idempotency gap before any caller ships, level-bonus snapshot skip, midnight double first-swap bonus) — merging on green.
- **#760** round-3 fix in flight (timeout-FAILED notification told users to retry while funds were mid-bridge).
- **#823** round-2 fixes nearly done (migration boot-safety, pool-id keying, replay payload).
- **#821/#822** root causes fixed (env-schema drift; locale stats drift) — watcher merging on green.

### Round 7 (same day)

- **Merged:** #824 PointsService concurrency (final APPROVE; follow-ups posted), #821 MPP gate (0abc0005, #642 closed), #822 chain coverage (4e647019, #753 closed). Total: **23 merged**.
- **#760**: round-4 APPROVE; both follow-ups applied directly (bound-agnostic timeout copy + definite-receipt guard before the terminal verdict) — merging on green.
- **#823**: round-3 APPROVE; two mechanical follow-ups being applied pre-merge (withdraw-discriminant pool-id preference + drizzle migration for the varchar widening) — then merge, closing #641 with the KMS-gap pointer.
- **Phase 4 tail**: assessing #643 (likely superseded by #817+#820), #644/#646 (TP/SL audit), #639/#640 (optional terminal intel).

## Final summary (2026-08-09, end of session)

**27+ PRs merged** into main in one day: 7 deps/docs (#693 #700 #704 #775 #778 #796 #766), 6 fresh code (#802 #774 #812 #797 #813 #818), 5 orphan landings (#810 #811 #815 #816 #819), 7 ports across the Aug-3 history restart (#817 Polymarket CLOB V2, #820 compliance spine, #821 MPP gate, #822 chain coverage, #823 rug auto-sell + redemption idempotency, #825 TP/SL close-cancel, plus re-lands), 2 recreated micro-fixes (#826 #827), and #824 (PointsService races found *during* this session's reviews). **#760** (0x Robinhood cross-chain) passed 4 money-path review rounds; merging on green after a final main-sync.

**~30 PRs closed with evidence** (byte-identical to main, superseded by redesigns, stale WIP), each with a pointer comment. **#725 kept open** (verified-missing service hardening; needs re-port). **#698/#703 kept open** blocked upstream (turnkey 7 needs its own review; Next.js vs TS7).

**Every money-path merge went through adversarial Opus review** — the gate blocked first-pass merges on ALL FIVE money-path PRs and caught, among others: a signature format that would have rejected every Polymarket order in prod, a tick-rounding path that could sign away positions for zero, an OFAC loader silently dropping the TRON addresses it claimed to screen, a rug auto-sell that was a no-op on Postgres, a migration pattern that would have hung boot on the hottest table, and a prod-only migration crash that dev could never see.

**Follow-ups tracked:** KMS-off-event-loop port (#641 remainder), terminal intel tiers (#639/#640, kept open), #725 re-port, pre-wiring gates on the MPC crate (#812 comments), season-accrual idempotency before wiring awardSwapPoints (#824 comments).

**Phase 5:** `scripts/cleanup-dead-branches.sh` (committed) archive-tags + deletes 209 dead branches (7 merged, 167 pre-rewrite relics, 35 junk). Run it from an unrestricted clone — this CI sandbox 403s ref deletion.

**Verification per CLAUDE.md:** every merge goes through CI green; after
any deploy-affecting merge run `python3 scripts/status.py` and the
import-error log scan (CI green ≠ bot boots). MONEY-PATH diffs never
merge without the Opus reviewer.

## Category C — recent orphans (no PR, small real diff)

41 branches triaged: **13 valuable, 28 junk/superseded.** All 13 valuable
ones merge cleanly against current main.

**Land (in this order):**

| Priority | Branch | What it is |
|---|---|---|
| MONEY-PATH | `fix/points-double-spend` | Points redemption race/double-spend fix |
| MONEY-PATH | `fix/credit-float-precision` | Agent credit balance float-precision fix |
| Security | `fix/log-token-leak-aegis-path` | Stop logging bot token (with test) |
| Bug | `fix/session-sentinel-bearer` | Dashboard sentinel-as-bearer 401 fix |
| Bug | `fix/wire-jelly-social-discover` | Jelly social discovery wiring |
| Feature | `feat/jelly-native-social-claim` | Jelly-native creator claims UI |
| Feature | `feat/funnel-attribution` | Activation funnel instrumentation |
| Infra | `agent/fix-webapp-public-entry` | Public social access + routing refactor |
| Infra | `agent/fix-bun-test-isolation` | api-ts route test isolation |
| Infra | `agent/perps-agent-auth-contract` | Perps agent-key auth parsing |
| Infra | `agent/mcp-2026-core`, `agent/native-mpc`, `agent/ci-trust-hardening`, `agent/core-builder-contract` | Protocol/MPC/CI/builder-contract work — review before landing |

> ⚠️ Before opening each PR, run a superseded check
> (`git log --oneline origin/main | grep -i <keyword>` + `git cherry`):
> main already contains a session-sentinel bearer fix (#730), so some of
> these may be residual duplicates of already-landed work. Land only the
> delta that is genuinely missing.

**Delete (28):** all `agent/docs-*`, `codex/docs-*`, `codex/*-product-docs`
(18 docs-only branches), plus experiments: `agent/pq-settlement-profile`,
`agent/responsiveness-phase2`, `agent/research-bank-grade-pass`,
`claude/openrouter-subscription-credits-niok9w`, `design/dashboard-taste`,
`worktree-data-capture-intents`, `simplify/dashboard`,
`chore/complete-jelly-social-goal`, and the remaining stale worktree-*
holdouts. Full table in scratchpad `orphan-recent.md`.

## Category D — pre-rewrite relics (ahead > 1000)

**Verdict from a 10-branch sample: all STALE.** Main's 2026-08-03 snapshot
ingested the live code from these lines of work (their PRs — #740, #743,
#745, etc. — are visible in main's log as cherry-picked/squashed
integrations); the branches only preserve pre-rewrite development history.
The huge diff deletions (48K–272K lines) are main's rewrite stripping old
build history, not lost work.

**Action: bulk-delete every branch with ahead > 1000** (~60 branches).
Any genuinely unlanded fix would show up with ahead < 200, which puts it
in Category B or C, not here. Zero salvage expected; sample notes in
scratchpad `prerewrite-sample.md`.

## Landing order

<!-- synthesized after triage -->
