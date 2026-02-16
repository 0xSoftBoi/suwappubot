<!-- Created: 2026-02-16 -->
<!-- Last verified: 2026-02-16 -->
<!-- Next review: 2026-03-16 -->

# ADR 002: Use Git Worktrees via `sw` Command for Parallel Development

**Date:** 2026-02-16
**Status:** Accepted
**Decision Makers:** Established workflow

---

## Context

**Traditional git workflow:**
- Single working directory per repository
- Switch branches with `git checkout`
- Can only work on one branch at a time
- Must commit/stash work before switching
- CI/dev servers must restart when switching branches

**Problem with branch switching:**
- Disruptive context switching
- Node modules reinstall on branch switch
- Risk of accidentally mixing work from different branches
- Can't run tests on one branch while developing another
- Slow feedback loops

---

## Decision

**Use git worktrees managed by custom `sw` command for all Suwappubot development.**

**Architecture:**
- **Bare repository**: `~/Desktop/suwappumain/suwappubot.git` (no working directory)
- **Main worktree**: `~/Desktop/suwappumain/worktrees/main` (permanent)
- **Feature worktrees**: `~/Desktop/suwappumain/worktrees/<feature-name>` (temporary)

**`sw` command:** Custom shell script/function at `~/Desktop/suwappumain/worktrees/main/scripts/sw`

---

## How It Works

### Core Commands

```bash
sw new <name>           # Create worktree (+ branch if needed)
sw new <name> claude    # Create worktree + launch Claude Code
sw ls                   # List all worktrees
cd $(sw cd <name>)      # Navigate to worktree
sw rm <name>            # Remove worktree (+ optional branch deletion)
sw clean                # Remove worktrees with merged branches
sw parallel <n1> <n2>   # Launch multiple worktrees in tmux
```

### Workflow Example

```bash
# Working on feature A
cd ~/Desktop/suwappumain/worktrees/main
sw new feature-auth

# Feature A worktree created at:
# ~/Desktop/suwappumain/worktrees/feature-auth

# Meanwhile, need to fix urgent bug
sw new hotfix-payment-bug

# Now have parallel environments:
# - main/ - stable reference
# - feature-auth/ - feature development
# - hotfix-payment-bug/ - bug fix

# Each has own:
# - node_modules (no reinstall on switch)
# - .env files
# - running dev servers
# - git branch
```

### Automatic Bootstrapping

When creating new worktree, `sw` automatically:
1. Creates branch (or reuses existing)
2. Runs `~/Desktop/suwappumain/worktrees/main/scripts/worktree-setup.sh`
3. Installs dependencies for each component (api-ts, webapp, mobile, etc.)
4. Creates `.ai-context.md` template for task tracking

---

## Consequences

### Benefits

✅ **True parallel development**
- Work on multiple features simultaneously
- No branch switching disruption
- Each worktree isolated

✅ **Faster iteration**
- No node_modules reinstall
- Dev servers stay running
- Tests can run in one worktree while coding in another

✅ **Reduced risk of mistakes**
- Can't accidentally commit wrong-branch code
- Each worktree is a clean slate
- Easy to compare implementations side-by-side

✅ **Better for AI coding assistants**
- Each worktree gets its own `.ai-context.md`
- Claude Code can work in dedicated environment
- No context pollution between tasks

✅ **Team collaboration**
- Multiple devs can work on shared bare repo
- Each has their own worktrees locally
- No branch conflicts

### Drawbacks

❌ **Disk space usage**
- Each worktree has full node_modules
- Multiple copies of large dependencies
- Can use 5-10GB per worktree for full-stack projects

❌ **Learning curve**
- New developers must learn `sw` commands
- Different from traditional git workflow
- Requires understanding of bare repos

❌ **Memory usage**
- Multiple dev servers running simultaneously
- Multiple Node processes
- Can strain system resources

❌ **Potential for confusion**
- Must remember which worktree you're in
- Easy to push from wrong worktree if not careful

### Mitigation Strategies

**For disk space:**
- Remove worktrees when done: `sw rm <name>`
- Use `sw clean` monthly to remove merged branches
- Keep only 2-3 active worktrees at a time

**For learning curve:**
- Document in shell-tools.md (done)
- Document in CLAUDE.md (done)
- Create this ADR to explain "why"

**For memory usage:**
- Monitor with `sw parallel` instead of manual
- Close unused worktrees
- Use Docker Compose for resource limits if needed

**For confusion:**
- Always run `pwd` to verify worktree
- Use shell prompt customization (show git branch)
- Each worktree has `.ai-context.md` reminder

---

## Alternative Approaches Considered

### 1. Traditional Branch Switching
**Rejected because:**
- Too disruptive (node_modules churn)
- Can't work in parallel
- High risk of mixing work

### 2. Multiple Repository Clones
**Rejected because:**
- Divergent git history
- No shared bare repo
- Harder to sync
- More disk space than worktrees

### 3. Docker Containers per Feature
**Rejected because:**
- Overhead of container management
- Slower filesystem performance
- More complex setup
- Worktrees simpler and faster

---

## Implementation

**Completed:**
- ✅ Bare repo setup at `~/Desktop/suwappumain/suwappubot.git`
- ✅ Main worktree at `~/Desktop/suwappumain/worktrees/main`
- ✅ `sw` command implemented and documented
- ✅ Bootstrap script for automatic dependency installation
- ✅ Documentation in shell-tools.md
- ✅ This ADR created

**In use:**
- `sw new <name>` for every new feature/bug fix
- `sw clean` monthly to remove merged worktrees
- `sw parallel` for complex multi-component work

---

## Key Constraints

### Cannot Remove Main Worktree
`sw rm main` will fail - main worktree is permanent reference point.

### Single Branch per Worktree
Each worktree is tied to one branch. To switch branches, create new worktree.

### Worktree Names = Branch Names
By convention, worktree directory name matches branch name for clarity.

---

## References

- **shell-tools.md**: Full `sw` command documentation
- **MEMORY.md**: Quick reference for sw commands
- **sw script**: `~/Desktop/suwappumain/worktrees/main/scripts/sw`
- **Bootstrap script**: `~/Desktop/suwappumain/worktrees/main/scripts/worktree-setup.sh`

**Official Git Worktree Docs:**
- https://git-scm.com/docs/git-worktree

---

## Review Schedule

- **First review:** 2026-03-16 (30 days)
- **Trigger for revision:** If disk space or confusion becomes problematic
- **Success criteria:** Team consistently uses worktrees without issues
