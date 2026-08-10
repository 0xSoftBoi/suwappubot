# Self-Improving Harness

The Claude Code harness in this repo improves itself from evidence: every
session leaves a telemetry trace, the traces get digested into friction
signals, and a bounded loop patches the harness's own artifacts (rules, hooks,
skills, agents) behind a verification gate.

Design borrows from three sources:

- **Hermes self-evolution** (Nous Research, `hermes-agent-self-evolution`):
  offline optimization over execution traces; skills as the unit of
  improvement; every evolved artifact must pass a hard gate before shipping.
- **pi / pi-reflect** (Mario Zechner's `pi-mono` harness + `pi-reflect`):
  session-end reflection into typed behavioral files, surgical edits with
  git as the audit/rollback layer, and *recidivism tracking* — a rule edited
  3+ times is a rule that isn't being absorbed.
- **Claude Code natively**: CLAUDE.md auto-load, `.claude/skills`,
  `.claude/agents`, `.claude/hooks` + `settings.json` lifecycle events,
  `/loop` and Routines for cadence.

## The loop

```
 session runs ──► Stop hook writes 1 journal line ──► journal/*.jsonl
                                                          │
        ┌─────────────────────────────────────────────────┘
        ▼
 /evolve: digest ──► pick ONE friction ──► patch ONE artifact ──► lint gate ──► commit
        ▲                                                              │
        └──────────────── next session inherits the fix ◄──────────────┘
```

## Components

| Piece | Path | Role |
|---|---|---|
| Telemetry | `.claude/hooks/session-journal.py` (Stop hook) | 1 compact JSONL record per session: turns, tool errors, denials, error buckets, first prompt |
| Journal | `.claude/harness/journal/YYYY-MM.jsonl` | Evidence corpus (transcripts distilled, not stored raw) |
| Digest | `scripts/harness/journal_digest.py` | Deterministic friction report the model reads instead of raw logs |
| Lessons | `.claude/harness/lessons.md` | Typed (`Rules` / `Facts`), hard-capped at 25, merge-or-evict |
| Capture | `/reflect` skill | End-of-task: mine *this* session → surgical lessons.md edit only |
| Improve | `/evolve` skill | One iteration: evidence → one artifact patch → gate → commit |
| Gate | `scripts/harness/harness_lint.py` | settings/hooks/skills validity, CLAUDE.md word budget, lesson cap, journal integrity |

## Principles (the pitfalls this design exists to avoid)

1. **Evidence or nothing.** `/evolve` with an empty digest makes no change.
   An evolution loop without signal just generates noise commits.
2. **Bounded memory.** CLAUDE.md ≤ 4000 words; lessons ≤ 25, merge-or-evict.
   Ungoverned rule accretion is how self-improving prompts die (community
   consensus across claude-reflect / claude-meta / pi-reflect).
3. **Escalate recidivists.** A lesson re-edited 3+ times gets *promoted* from
   prose to an enforcing artifact — a hook that blocks, a skill that
   proceduralizes, a permission that removes the prompt. Prose is the weakest
   enforcement tier.
4. **Gate before commit.** `harness_lint.py` must PASS; hooks must exit 0 on
   garbage input. A broken hook silently kills the whole loop.
5. **Git is the safety rail.** One surgical change per commit, prefixed
   `harness(evolve):` / `harness(reflect):` — diffable, revertable, and the
   thrash detector (same artifact patched repeatedly = loop is failing,
   stop and tell the human).

## Running it

```bash
python3 scripts/harness/journal_digest.py --days 30   # see current friction
python3 scripts/harness/harness_lint.py               # gate (also run in CI-of-the-mind before any harness commit)
```

- One-shot: `/evolve` (optionally `/evolve <focus hint>`)
- Continuous: `/loop 1h /evolve`, or a weekly Routine — weekly is the sane
  default, the journal needs sessions to accumulate between iterations.
- End-of-task: `/reflect` whenever a session taught something.
