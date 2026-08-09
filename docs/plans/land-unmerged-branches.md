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

## Category B — open PRs (the real landing surface)

<!-- filled from scout triage: pr-branches.md -->

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
