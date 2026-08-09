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
