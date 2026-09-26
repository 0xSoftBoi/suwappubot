---
name: evolve
description: One iteration of the harness self-improvement loop - digest the session journal, pick the single highest-friction pattern, make ONE surgical patch to a harness artifact (CLAUDE.md, a hook, skill, agent, or lessons promotion), pass the lint gate, commit. Run via /loop or a Routine for continuous improvement, or invoke once as /evolve.
---

# /evolve — one self-improvement iteration

Design: docs/harness/self-improving.md (Hermes self-evolution + pi-reflect
patterns). Loop shape: **evaluate → reflect → patch → verify → commit**.
One iteration = ONE change. Small surgical diffs beat rewrites; the git log
is the audit trail and the rollback mechanism.

## 1. Evaluate — read the evidence, never guess

```bash
python3 scripts/harness/journal_digest.py --days 30
git log --oneline -15 -- .claude/ CLAUDE.md
git log --oneline -- .claude/harness/lessons.md | head -20
```

Evidence sources, in priority order:
1. **Recurring error buckets** in the digest (same failure across 2+ sessions).
2. **Recidivist lessons** — a lessons.md section edited 3+ times means prose
   isn't working; it needs promotion to an *enforcing* artifact.
3. **Denial-heavy sessions** — repeated permission prompts → allowlist candidates
   for `.claude/settings.json` permissions.
4. **User-stated friction** if this run was invoked with a focus hint
   (`/evolve <hint>` — the hint outranks the digest).

If the digest is empty AND there's no hint and no recidivism: report "no signal,
no change" and STOP. An evolution loop that edits without evidence is noise.

## 2. Reflect — pick ONE target and the right artifact type

Match the friction to the artifact that *enforces* the fix, preferring the
most mechanical option (top = strongest):

| Friction pattern | Patch target |
|---|---|
| Model keeps doing a forbidden/broken thing | New or edited **hook** in `.claude/hooks/` + `settings.json` |
| Multi-step procedure keeps going wrong | **Skill** in `.claude/skills/<name>/SKILL.md` |
| Wrong specialist/model routing | **Agent** def in `.claude/agents/` or routing table in CLAUDE.md |
| Permission prompt friction | `permissions.allow` in `.claude/settings.json` |
| Repo fact the model keeps rediscovering | `.claude/harness/lessons.md` `## Facts` |
| Judgment rule with no mechanical enforcement | CLAUDE.md (mind the 4000-word budget — merge, don't append) |

## 3. Patch — surgical rules

- ONE artifact change per iteration (plus its `settings.json` wiring if a hook).
- Edits over rewrites. Never restructure a file you're not fixing.
- New hooks: must exit 0 on any internal error (never break sessions), parse
  under `python3 -c "import ast; ast.parse(open(f).read())"`, and follow the
  style of `.claude/hooks/session-journal.py`.
- Deleting/evicting: quote what you removed in the commit body.

## 4. Verify — the gate is not optional

```bash
python3 scripts/harness/harness_lint.py
```
Must print PASS. If you added/changed a hook, also smoke-test it:
`echo '{}' | python3 .claude/hooks/<hook>.py; echo "exit=$?"` → must exit 0.
If the gate fails, fix or revert — never commit a failing harness.

## 5. Commit

```bash
HUSKY=0 git add <changed files>
HUSKY=0 git commit -m "harness(evolve): <what changed and which friction it kills>"
```
Push only if the user asked for it or a Routine/loop invocation says to.

## Continuous mode

- Manual cadence: `/loop 1h /evolve` (stops when you stop the loop).
- Scheduled: a Routine/cron firing `/evolve` weekly is the sane default —
  the journal needs sessions to accumulate between iterations.
- Convergence check every ~5 iterations: if recent `harness(evolve)` commits
  keep touching the same artifact, the loop is thrashing — stop and surface
  it to the user instead of patching again.

## Output

Reply ≤8 lines: evidence chosen, artifact patched (path), one-line diff summary,
lint result, commit hash. If no-change: the one line "no signal, no change."
