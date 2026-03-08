# Merge Upstream Changes

Safely merge diverged remote changes into the current branch. Handles the common case where local worktree has untracked files that conflict with remote.

## Instructions

### 1. Pre-flight (mandatory)
```bash
git rev-parse --git-common-dir   # Worktree check — NEVER rebase if in worktree
gh auth status                    # Verify correct GitHub account
git remote -v                     # Verify correct remote
ls .git/*.lock 2>/dev/null        # Check for stale locks
git status                        # Check uncommitted work
```

### 2. Fetch and check divergence
```bash
git fetch origin main
git rev-parse HEAD
git rev-parse origin/main
git log --oneline HEAD..origin/main | wc -l   # How many remote commits
git log --oneline origin/main..HEAD | wc -l   # How many local commits
```

### 3. Attempt merge
```bash
HUSKY=0 git merge --no-autostash origin/main --no-edit
```

### 4. If untracked file conflicts
When merge fails with "untracked working tree files would be overwritten":

1. Extract the conflicting file list from the error
2. Move them to `/tmp/suwappu-untracked-backup/` preserving directory structure
3. Retry the merge

### 5. Resolve conflicts
- **Non-showcase files** (bot/, api-ts/, webapp/, etc.): Accept remote version
  ```bash
  git diff --name-only --diff-filter=U | grep -v "^showcase/" | xargs -I{} git checkout origin/main -- {}
  ```
- **Showcase files**: Keep HEAD (our local changes)
  ```bash
  git checkout HEAD -- showcase/src/app/page.tsx
  ```
- **Other conflicts**: Review case by case, prefer remote for non-showcase

### 6. Complete merge
```bash
HUSKY=0 git commit --no-edit
```

### 7. Push
```bash
HUSKY=0 git push origin main
```

## Important Rules
- NEVER rebase in worktrees — always merge
- HUSKY=0 prefix on all git commits/pushes in worktrees
- If any git operation fails twice, STOP and ask the user
- Verify GitHub account matches repository before pushing
