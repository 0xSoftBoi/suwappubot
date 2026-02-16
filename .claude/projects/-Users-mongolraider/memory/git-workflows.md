# Git Workflows & Conventions

## Commit Message Conventions

**Critical Rule**: Never add "Co-Authored-By" lines to commit messages

**User preference**: User explicitly requested that Claude should NOT add co-author attribution

**Standard format:**

```
<verb> <what changed>

<optional: why this change was needed>
```

**Examples:**

```
Add user authentication middleware

Fix race condition in wallet balance updates

Refactor swap service to use Effect-TS patterns
```

## Branch Naming

**Patterns used:**

- `feature/<name>` - New features
- `fix/<name>` - Bug fixes
- `refactor/<name>` - Code refactoring
- `docs/<name>` - Documentation
- `test/<name>` - Test additions

**Keep names concise and descriptive:**

- ✅ `feature/telegram-alerts`
- ✅ `fix/wallet-encryption-bug`
- ❌ `feature/add-the-new-telegram-alert-system`

## Worktree-Based Development

See [shell-tools.md](./shell-tools.md) for the `sw` command

**Typical workflow:**

1. Create worktree for task: `sw new feature-telegram-alerts`
2. Make changes, commit frequently
3. Push and create PR: `git push -u origin feature-telegram-alerts`
4. After merge, clean up: `sw rm feature-telegram-alerts`

**Benefits:**

- Work on multiple features in parallel
- No branch switching (each worktree is a different branch)
- Isolated dependencies per worktree
- Easy context switching (just `cd` or use tmux)

## Common Git Operations

**Check current state:**

```bash
git status                    # Current branch, changes
git branch -vv                # All branches with tracking info
git remote -v                 # Remote URLs
gh auth status                # Verify GitHub account
```

**Sync with remote:**

```bash
git fetch origin
git pull --rebase origin main
git push origin <branch>
```

**Clean up:**

```bash
git branch --merged main      # Show merged branches
git branch -d <branch>        # Delete local branch
git push origin --delete <branch>  # Delete remote branch
```

## Pre-Push Checklist

Before pushing to remote:

1. ✅ Verify GitHub account: `gh auth status`
2. ✅ Check remote: `git remote -v`
3. ✅ Review changes: `git diff origin/<branch>`
4. ✅ Verify commit messages (no Co-Authored-By lines)
5. ✅ Run tests if applicable
6. ✅ Push: `git push origin <branch>`
