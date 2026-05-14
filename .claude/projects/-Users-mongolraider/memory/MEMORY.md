# Claude Code Auto Memory

Cross-project knowledge index. Auto-loaded every session (200-line limit).

## Memory Bank

| Dir | Files | Purpose |
|-----|-------|---------|
| `1-core/` | credentials, git-workflows, shell-tools, build-on-aws | Critical — always relevant |
| `2-patterns/` | debugging, nodejs, aws, blockchain, claude-usage, llm-confidence-calibration, taxonomy-alignment-iterations, deploy-ssm-fallback, deploy-sync-gotcha, gsx-dag-pause-perf-campaigns, gsx-cross-repo-wire-parity | Learned patterns — on-demand |
| `3-decisions/` | phase6-prompt-engineering, phase7-few-shot-examples, jetson-edge-ai, tempo-mainnet-integration, ecosystem-landscape-2026q1, polymarket-integration, etp-private-until-audit | AI-Security phases + Jetson + Tempo + Ecosystem + Polymarket + ETP |

---

## Critical Rules

- **NEVER add "Co-Authored-By" lines to commit messages**
- **NEVER use `git rebase`** — always `git merge` or `git pull --no-rebase`
- Use `HUSKY=0` prefix for git operations in worktrees
- **gsx-dag: never `cargo test`/`cargo build --workspace` locally** — Mac too weak; use CodeBuild + GHA test job. See [2-patterns/gsx-dag-no-local-cargo-test.md](./2-patterns/gsx-dag-no-local-cargo-test.md)

## GitHub Accounts

| Repository | Account |
|------------|---------|
| **suwappubot** | `0xSoftBoi` |
| **op-stack-reth** | `tomagsx` |
| **gsx-dag** | `tomagsx` |
| **ETP** | `tomagsx` + `0xSoftBoi` |

Switch: `gh auth switch --user <account>`
Verify: `gh auth status` (ALWAYS before pushing)

## AWS

- Profile: `default` (no flag needed)
- Account: `905418423235` / Region: `us-east-1`
- See [credentials.md](./1-core/credentials.md) for Gandi DNS, verification checklists

## Project Locations

| Project | Location | Remote | Account |
|---------|----------|--------|---------|
| Suwappubot | `~/Desktop/suwappumain/worktrees/main` | `0xSoftBoi/suwappubot` | `0xSoftBoi` |
| OP Stack Reth | `~/op-stack-reth` | `GlobalSettlementNetwork/op-stack-reth` | `tomagsx` |
| gsx-dag | `~/gsx-build/gsx-dag` | `GlobalSettlementNetwork/gsx-dag` | `tomagsx` (AWS profile: `gsn`) |
| gsx-db | `~/gsx-build/gsx-db` | `GlobalSettlementNetwork/gsx-db` | `tomagsx` |
| gsx-lattice-protocol | `~/gsx-build/gsx-lattice-protocol` | `GlobalSettlementNetwork/gsx-lattice-protocol` | `tomagsx` |
| Sensorforge | `~/Desktop/sensorforge` (local) / `~/sensorforge` (Jetson) | — | — |
| Voice Assistant | `~/jetson-voice-assistant` (local) / `~/scripts` (Jetson) | — | — |
| ETP | `~/etp-merge` | `GlobalSettlementNetwork/ETP` + `0xSoftBoi/ETP` | `tomagsx` / `0xSoftBoi` |

Bare repo: `~/Desktop/suwappumain/suwappubot.git`

## sw Command

See [shell-tools.md](./1-core/shell-tools.md) for full docs.

```bash
sw new <name>           # Create worktree
sw new <name> claude    # Create + launch Claude Code
sw ls                   # List worktrees
cd $(sw cd <name>)      # Navigate
sw rm <name>            # Remove
sw clean                # Clean merged
sw parallel <n1> <n2>   # Parallel tmux
```

---

## Common Aliases

`gs`=git status, `gd`=git diff, `py`=python3, `dc`=docker-compose, `swm`=cd to main worktree

See [shell-tools.md](./1-core/shell-tools.md) for full list.

---

## Session Workflow

- Use `/revise-memory` after learning something new
- Keep this file under 200 lines
- See [claude-usage.md](./2-patterns/claude-usage.md) for preferences
