---
name: reflect
description: End-of-task reflection - mine THIS session for corrections and friction, then make surgical bounded edits to lessons.md (and only lessons.md). Use at the end of a task, after the user corrected you, or when invoked as /reflect.
---

# /reflect — capture what this session taught us

The capture half of the self-improving harness (docs/harness/self-improving.md).
`/reflect` writes **lessons**; `/evolve` changes **behavior artifacts** (CLAUDE.md,
hooks, skills, agents). Do not edit anything except `.claude/harness/lessons.md` here.

## Procedure

1. **Mine the session you are in.** Look for, in priority order:
   - Explicit user corrections ("no, do X", "I told you", repeated instructions).
   - Tool-call failures you retried more than once (wrong flags, wrong paths,
     wrong service, permission denials).
   - Anything you discovered the hard way about this repo/deploy that isn't
     written down (a URL, a quirk, a command that works).
   If the session contains none of these, say so and stop — do not invent lessons.

2. **Check for an existing lesson first.** Read `.claude/harness/lessons.md`.
   - Same lesson exists → do nothing (or sharpen its wording in place).
   - Related lesson exists → merge into it rather than adding a sibling.
   - New → add under `## Rules` (behavior) or `## Facts` (environment memory),
     using the file's format. Max 3 lines per lesson.

3. **Respect the budget.** Cap is 25 lessons. At cap: merge or evict the
   least-valuable lesson in the same edit. Never push the file over cap.

4. **Recidivism check.** Run
   `git log --oneline -- .claude/harness/lessons.md | head -20`.
   If the lesson you're touching has been edited 3+ times, it is not being
   absorbed as prose — flag it in your reply as a candidate for `/evolve` to
   promote into an enforcing artifact (hook, skill, or CLAUDE.md rule).

5. **Gate, then commit.**
   ```bash
   python3 scripts/harness/harness_lint.py
   ```
   Must PASS. Then commit just that file:
   `HUSKY=0 git add .claude/harness/lessons.md && HUSKY=0 git commit -m "harness(reflect): <lesson title>"`
   Do not push unless the user asked or you are already pushing other work.

## Output

Reply with: lessons added/merged/evicted (titles only), any recidivism flags,
and lint result. Keep it under 6 lines.
