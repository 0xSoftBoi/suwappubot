# Shell Tools & Custom Commands

## sw - Git Worktree Manager

**Purpose**: Manage parallel development using git worktrees for the Suwappubot project

**Location**: `~/Desktop/suwappumain/worktrees/main/scripts/sw`
**Bare repo**: `~/Desktop/suwappumain/suwappubot.git`
**Worktrees base**: `~/Desktop/suwappumain/worktrees/`

### Core Commands

```bash
# Create new worktree (creates branch if needed)
sw new <name>

# Create worktree and launch Claude Code
sw new <name> claude

# List all active worktrees
sw ls

# Navigate to a worktree (use with cd)
cd $(sw cd <name>)

# Remove a worktree
sw rm <name>

# Clean up merged worktrees
sw clean

# Launch multiple worktrees in tmux with Claude Code
sw parallel <name1> <name2> <name3>
```

### How It Works

1. **New worktree creation**: `sw new feature-x`
   - Creates branch `feature-x` from current HEAD (or reuses existing)
   - Creates worktree at `~/Desktop/suwappumain/worktrees/feature-x`
   - Runs bootstrap script to install dependencies
   - Creates `.ai-context.md` template for task context

2. **Worktree bootstrapping**:
   - Automatically runs `~/Desktop/suwappumain/worktrees/main/scripts/worktree-setup.sh`
   - Installs dependencies for each component (api-ts, webapp, mobile, etc.)

3. **Shell function override**:
   - `.zshrc` defines `sw cd` as a shell function for direct navigation
   - Other commands delegate to the script

### Common Workflows

**Single worktree development:**

```bash
sw new fix-auth-bug
cd $(sw cd fix-auth-bug)
# ... make changes, commit ...
git push -u origin fix-auth-bug
# Create PR, merge
sw rm fix-auth-bug
```

**Parallel development (multiple features):**

```bash
# Launch 3 worktrees in tmux, each with Claude Code
sw parallel feature-a feature-b bugfix-c

# Each tmux window runs Claude Code in its worktree
# Switch windows: Ctrl+b n (next) or Ctrl+b p (previous)
```

**Cleanup merged work:**

```bash
# After PRs merged to main
sw clean
# Interactively removes worktrees whose branches are merged
```

### Key Constraints

- **Cannot remove "main" worktree** - it's the permanent base worktree
- **Single instance for main** - only one "main" worktree exists
- **Automatic branch creation** - creates branch if it doesn't exist
- **Dependency bootstrap** - automatically installs dependencies in new worktrees

### .ai-context.md Template

Each new worktree gets `.ai-context.md`:

```markdown
# Task: <worktree-name>

## Goal
<!-- What should this worktree accomplish? -->

## Key Files
<!-- Which files will be modified? -->

## Constraints
<!-- Any rules or boundaries? -->

## Success Criteria
<!-- How do you know it's done? -->
```

**Purpose**: Provides task-specific context to Claude Code when working in that worktree

## Common Shell Aliases

```bash
# Git shortcuts
alias gs="git status"
alias gd="git diff"
alias gl="git log"
alias gp="git push"
alias gpu="git pull"

# Docker
alias dc="docker-compose"
alias dcu="docker-compose up"
alias dcd="docker-compose down"

# Python
alias py="python3"
alias pip="python3 -m pip"

# Navigation (if configured)
alias swm="cd ~/Desktop/suwappumain/worktrees/main"
