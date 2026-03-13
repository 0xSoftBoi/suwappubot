<!-- Created: 2026-02-16 -->
<!-- Last verified: 2026-02-16 -->
<!-- Next review: 2026-03-16 -->

# Credentials & Authentication Patterns

## GitHub Accounts

### Account Assignment by Repository

| Repository | GitHub Account | Remote URL | Notes |
|------------|----------------|------------|-------|
| **suwappubot** | `0xSoftBoi` | `https://github.com/0xSoftBoi/suwappubot.git` | Primary project - NEVER use tomagsx |
| **op-stack-reth** | `tomagsx` | `https://github.com/GlobalSettlementNetwork/op-stack-reth.git` | NEVER use 0xSoftBoi |

### Pre-Push Verification Commands

**Always run before pushing to verify correct account:**

```bash
gh auth status
```

**Switch account if needed:**

```bash
# For Suwappubot projects
gh auth switch --user 0xSoftBoi

# For OP Stack Reth projects
gh auth switch --user tomagsx
```

### Common Issues

**Issue**: Wrong GitHub account pushes to wrong repo
**Solution**: Add verification step to workflow - run `gh auth status` before any push operation
**Prevention**: Check account immediately when changing projects

## AWS Profiles

### Suwappubot AWS Configuration

- **Profile name**: `Swappu`
- **Account ID**: `905418423235`
- **Default region**: `us-east-1`

**Usage pattern:**

```bash
# Inline profile specification
AWS_PROFILE=Swappu aws <command>

# Set for session
export AWS_PROFILE=Swappu
aws <command>
```

**Common commands:**

```bash
# Verify active profile
aws sts get-caller-identity

# ECS operations
AWS_PROFILE=Swappu aws ecs list-clusters
AWS_PROFILE=Swappu aws ecs list-services --cluster suwappu-prod
```

## Verification Checklist

**Before starting work on a project:**

1. ✅ Verify working directory: `pwd`
2. ✅ Check git remote: `git remote -v`
3. ✅ Verify GitHub account: `gh auth status`
4. ✅ (If AWS needed) Verify AWS profile: `aws sts get-caller-identity`

**Before pushing code:**

1. ✅ Run `gh auth status` to confirm correct account
2. ✅ Check remote: `git remote -v`
3. ✅ Verify branch: `git status`
