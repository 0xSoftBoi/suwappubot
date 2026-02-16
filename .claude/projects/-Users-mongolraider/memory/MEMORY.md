# Claude Code Auto Memory

This is the main index for cross-project knowledge. It's auto-loaded into every session (200-line limit).

**Memory Bank Structure** (numbered by priority):

**1-core/** - Critical knowledge (auto-loaded)
- [credentials.md](./1-core/credentials.md) - GitHub accounts, AWS profiles, auth patterns
- [git-workflows.md](./1-core/git-workflows.md) - Git conventions, branch naming, worktree workflow
- [shell-tools.md](./1-core/shell-tools.md) - `sw` worktree manager, aliases, custom commands

**2-patterns/** - Learned patterns (referenced on-demand)
- [debugging.md](./2-patterns/debugging.md) - Recurring issues and solutions
- [nodejs-patterns.md](./2-patterns/nodejs-patterns.md) - Node.js/TypeScript conventions
- [aws-patterns.md](./2-patterns/aws-patterns.md) - AWS CLI patterns, ECS deployment
- [blockchain-dev.md](./2-patterns/blockchain-dev.md) - Solana/EVM/OP Stack patterns
- [claude-usage.md](./2-patterns/claude-usage.md) - Session workflow preferences

**3-decisions/** - Architecture Decision Records (ADRs)
- Document "why" behind major decisions with rationale and consequences

---

## Critical Information (Quick Reference)

### Git Commits

**NEVER add "Co-Authored-By" lines to commit messages** - user explicitly requested this.

### GitHub Account Assignment

| Repository | Account | Verification |
|------------|---------|--------------|
| **suwappubot** | `0xSoftBoi` | `gh auth status` before pushing |
| **op-stack-reth** | `tomagsx` | `gh auth status` before pushing |

**Switch accounts:**
```bash
gh auth switch --user 0xSoftBoi   # For Suwappubot
gh auth switch --user tomagsx     # For OP Stack Reth
```

### AWS Configuration

**Suwappubot AWS:**
- Profile: `Swappu`
- Account: `905418423235`
- Region: `us-east-1`

**Usage:**
```bash
AWS_PROFILE=Swappu aws <command>
```

### sw Command (Worktree Manager)

**Quick reference** (see [shell-tools.md](./1-core/shell-tools.md) for details):

```bash
sw new <name>           # Create worktree
sw new <name> claude    # Create worktree + launch Claude Code
sw ls                   # List worktrees
cd $(sw cd <name>)      # Navigate to worktree
sw rm <name>            # Remove worktree
sw clean                # Clean up merged worktrees
sw parallel <n1> <n2>   # Launch multiple worktrees in tmux
```

**Location**: `~/Desktop/suwappumain/worktrees/main/scripts/sw`
**Base**: `~/Desktop/suwappumain/worktrees/`

---

## Project Locations

### Suwappubot

- **Bare repo**: `~/Desktop/suwappumain/suwappubot.git`
- **Main worktree**: `~/Desktop/suwappumain/worktrees/main`
- **CLAUDE.md**: `~/Desktop/suwappumain/worktrees/main/CLAUDE.md` (comprehensive project docs)
- **Remote**: `https://github.com/0xSoftBoi/suwappubot.git`
- **GitHub account**: `0xSoftBoi` (CRITICAL)

### OP Stack Reth

- **Location**: `~/op-stack-reth`
- **CLAUDE.md**: `~/op-stack-reth/CLAUDE.md`
- **Remote**: `https://github.com/GlobalSettlementNetwork/op-stack-reth.git`
- **GitHub account**: `tomagsx` (CRITICAL - NEVER use 0xSoftBoi)

---

## Common Workflows

### Starting Work on Suwappubot

```bash
# Navigate to main worktree
cd ~/Desktop/suwappumain/worktrees/main

# Verify GitHub account
gh auth status
# Should show: ✓ Logged in to github.com as 0xSoftBoi

# Create new worktree for feature
sw new feature-name

# Navigate to it
cd $(sw cd feature-name)
```

### Starting Work on OP Stack Reth

```bash
# Navigate to project
cd ~/op-stack-reth

# CRITICAL: Verify GitHub account
gh auth status
# Should show: ✓ Logged in to github.com as tomagsx

# If wrong account, switch:
gh auth switch --user tomagsx
```

### Pre-Push Verification

**Always run before pushing:**

```bash
gh auth status        # Verify correct GitHub account
git remote -v         # Verify correct remote
git status            # Verify branch and changes
```

---

## Common Aliases

```bash
gs="git status"
py="python3"
dc="docker-compose"
```

See [shell-tools.md](./1-core/shell-tools.md) for full list.

---

## Maintenance Notes

**After each session:**
- If learned something useful, run `/revise-claude-md`
- If cross-project pattern emerged, update relevant topic file

**Weekly:**
- Run `/claude-md-improver` to audit CLAUDE.md files
- Consolidate recurring patterns from debugging

**Monthly:**
- Test documented commands
- Verify file paths
- Archive obsolete information
- Check this file stays under 200 lines
