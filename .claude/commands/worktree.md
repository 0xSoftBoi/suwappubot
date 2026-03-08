---
description: "Manage git worktrees for parallel development"
---

# Git Worktree Management

Manage git worktrees so multiple Claude Code sessions can work on different branches in parallel.

The bare clone lives at `~/Desktop/suwappumain/suwappubot.git/` (no working files).
All branches — including main — are worktrees at `~/Desktop/suwappumain/worktrees/<name>/`.

## Usage

The user will provide an argument like `new <name>`, `ls`, or `rm <name>`. Parse the argument and execute the matching action below.

If no argument is provided, list existing worktrees.

## Actions

### `new <name>` -- Create a worktree

1. Do NOT allow `main` as a name — the main worktree is always present at `~/Desktop/suwappumain/worktrees/main`.

2. Create a new branch named `<name>` from the current HEAD (or use an existing branch if one matches):
   ```bash
   git -C ~/Desktop/suwappumain/suwappubot.git worktree add ~/Desktop/suwappumain/worktrees/<name> -b <name>
   ```
   If the branch already exists, use:
   ```bash
   git -C ~/Desktop/suwappumain/suwappubot.git worktree add ~/Desktop/suwappumain/worktrees/<name> <name>
   ```

3. Run the bootstrap script to install dependencies and copy `.env`:
   ```bash
   bash ~/Desktop/suwappumain/worktrees/main/scripts/worktree-setup.sh ~/Desktop/suwappumain/worktrees/<name>
   ```

4. Report the path to the new worktree so the user can open it.

### `ls` -- List worktrees

```bash
git -C ~/Desktop/suwappumain/suwappubot.git worktree list
```

Display the output in a readable format.

### `rm <name>` -- Remove a worktree

1. Do NOT allow removing the `main` worktree.

2. Remove the worktree:
   ```bash
   git -C ~/Desktop/suwappumain/suwappubot.git worktree remove ~/Desktop/suwappumain/worktrees/<name> --force
   ```

3. Ask the user if they also want to delete the branch:
   ```bash
   git -C ~/Desktop/suwappumain/suwappubot.git branch -d <name>
   ```

4. Prune stale worktree metadata:
   ```bash
   git -C ~/Desktop/suwappumain/suwappubot.git worktree prune
   ```

## Notes

- The bare clone is at `~/Desktop/suwappumain/suwappubot.git` (no working files)
- The main worktree is at `~/Desktop/suwappumain/worktrees/main`
- Scripts are referenced from the main worktree (e.g., `worktrees/main/scripts/sw`)
- The bootstrap script (`scripts/worktree-setup.sh`) is idempotent
- Each worktree gets its own `.venv`, `.env`, and `node_modules`
- Never create worktrees inside the bare repo directory
