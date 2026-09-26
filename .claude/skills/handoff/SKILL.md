---
name: handoff
description: "Dump the current task's state to .claude/handoff.md so the session can be /clear'd and resumed cheaply. Use at the end of a task, before switching topics, or any time the session has run long. Usage: /handoff [note]"
---

# /handoff — checkpoint, then clear

Long sessions are the single largest source of token spend: every turn re-sends
the entire conversation. A 1,000-turn session pays for its own history 1,000 times.
This skill makes clearing cheap by writing down the only part worth keeping.

## Do this

1. Write `.claude/handoff.md` (overwrite it) with **only** what a fresh session
   could not re-derive in one command. Keep it under 40 lines.

   ```markdown
   # Handoff — <YYYY-MM-DD> — <task in one line>

   ## State
   <done / in-progress / blocked, one line>

   ## Files touched
   - path:line — what changed and why

   ## Decisions made (and why)
   - <the reasoning a fresh session would otherwise redo>

   ## Next step
   1. <the single next concrete action>

   ## Dead ends — do NOT retry
   - <approach tried, why it failed>
   ```

2. Do **not** include: file contents, command output, the repo layout, anything
   already in `CLAUDE.md`, or narration of what happened. A fresh session gets
   `CLAUDE.md` and `git diff` for free — don't pay to restate them.

3. Reply with the path and a 3-bullet summary, then tell the user to `/clear`.

## Resuming

A new session starts with: `Read .claude/handoff.md`, then `git status && git diff --stat`.
That is the whole warm-up. If the handoff needed more than that, it was written wrong.

## Rules

- `.claude/handoff.md` is a scratch file, one task at a time — overwrite, never append.
- If the task is genuinely finished and merged, write "State: done, nothing pending"
  and say so; don't manufacture next steps.
