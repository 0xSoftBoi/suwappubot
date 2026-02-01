---
description: "Manage git worktrees for parallel development"
---

# Git Worktree Management

Manage git worktrees so multiple Claude Code sessions can work on different branches in parallel.

Worktrees live at `~/Desktop/suwappumain/worktrees/<name>/` as siblings to the main repo.

## Usage

The user will provide an argument like `new <name>`, `ls`, or `rm <name>`. Parse the argument and execute the matching action below.

If no argument is provided, list existing worktrees.

## Actions

### `new <name>` -- Create a worktree

1. Create a new branch named `<name>` from the current HEAD (or use an existing branch if one matches):
   ```bash
   git worktree add ~/Desktop/suwappumain/worktrees/<name> -b <name>
   ```
   If the branch already exists, use:
   ```bash
   git worktree add ~/Desktop/suwappumain/worktrees/<name> <name>
   ```

2. Run the bootstrap script to install dependencies and copy `.env`:
   ```bash
   bash scripts/worktree-setup.sh ~/Desktop/suwappumain/worktrees/<name>
   ```

3. Report the path to the new worktree so the user can open it.

### `ls` -- List worktrees

```bash
git worktree list
```

Display the output in a readable format.

### `rm <name>` -- Remove a worktree

1. Remove the worktree:
   ```bash
   git worktree remove ~/Desktop/suwappumain/worktrees/<name> --force
   ```

2. Ask the user if they also want to delete the branch:
   ```bash
   git branch -d <name>
   ```

3. Prune stale worktree metadata:
   ```bash
   git worktree prune
   ```

## Notes

- The main repo is at `~/Desktop/suwappumain/suwappubot`
- The bootstrap script (`scripts/worktree-setup.sh`) is idempotent
- Each worktree gets its own `.venv`, `.env`, and `node_modules`
- Never create worktrees inside the main repo directory
