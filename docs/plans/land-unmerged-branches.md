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

<!-- filled from scout triage: orphan-recent.md -->

## Category D — pre-rewrite relics (ahead > 1000)

<!-- filled from scout sampling: prerewrite-sample.md -->

## Landing order

<!-- synthesized after triage -->
