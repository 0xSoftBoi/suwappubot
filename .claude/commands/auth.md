---
description: "Verify and fix GitHub + AWS authentication for the current project"
---

# Auth Check & Fix

Verify that GitHub and AWS credentials are correct for the current project, and fix them if not.

## Steps

### 1. Detect current project

Determine which project we're in based on `pwd` and `git remote -v`:

| Project | GitHub Account | AWS Account |
|---------|---------------|-------------|
| **suwappubot** (remote contains `0xSoftBoi/suwappubot`) | `0xSoftBoi` | `905418423235` (default profile) |
| **op-stack-reth** (remote contains `GlobalSettlementNetwork/op-stack-reth`) | `tomagsx` | N/A |

### 2. Check GitHub

Run `gh auth status` and verify the **active account** matches the expected account for this project.

If wrong, run:
```bash
gh auth switch --user <correct-account>
```

Then re-verify with `gh auth status`.

### 3. Check AWS

Run `aws sts get-caller-identity --region us-east-1` and verify account ID matches.

If it fails, inform the user their AWS credentials need to be configured.

### 4. Report

Print a summary:

```
GitHub: ✓ 0xSoftBoi (correct for suwappubot)
AWS:    ✓ 905418423235 / suwappbot
```

Or if something was wrong and fixed:

```
GitHub: ✓ Switched to 0xSoftBoi (was tomagsx)
AWS:    ✓ 905418423235 / suwappbot
```
