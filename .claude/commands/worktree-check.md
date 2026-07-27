---
description: "Audit every git worktree for uncommitted, unpushed, or stashed work at risk before any reset/merge/cleanup. Usage: /worktree-check"
---

# Worktree Safety Check

Multiple Claude sessions run against this repo concurrently and **share one stash stack**. A past session lost agent changes to a worktree reset. Run this before any `reset`, `checkout -f`, worktree removal, or cleanup sweep.

**Read-only. Never `reset --hard`, never `git add -A`, never bare `git stash pop` here.**

## Step 1 — Enumerate
```bash
git worktree list
git stash list --format='%gd %H %gs'
```

## Step 2 — Per worktree, report what's at risk
For each path from `git worktree list`, run with `-C <path>`:
```bash
git -C <path> status --porcelain          # uncommitted / untracked
git -C <path> log --oneline @{u}..HEAD    # committed but UNPUSHED (ignore error if no upstream)
git -C <path> rev-parse --abbrev-ref HEAD
```

## Step 3 — Verdict table
| worktree | branch | uncommitted | unpushed commits | upstream | risk |
|---|---|---|---|---|---|

Risk = **HIGH** if uncommitted files exist or unpushed commits exist with no upstream; **LOW** if clean and pushed.

## Step 4 — Rescue before destroying
If any worktree is HIGH risk and the user asked for a cleanup/reset:
1. **Stop.** Do not run the destructive command yet.
2. Offer rescue: in that worktree, `HUSKY=0 git commit -am "wip: rescue <worktree>"` then push to a `rescue/<worktree>-<branch>` branch.
3. Only proceed after the user confirms, naming exactly which worktrees will be touched.

For stash entries: they may belong to another session. Never `pop`. Identify by message, `git stash apply <sha>`, then drop by re-finding the index by tag.

## Step 5 — Output
A short table plus one line: `SAFE TO PROCEED` or `WORK AT RISK IN: <paths>`.
