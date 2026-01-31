# Suwappu Release Process

## Version Scheme

We use [Semantic Versioning](https://semver.org/):

```
MAJOR.MINOR.PATCH

MAJOR - Breaking changes
MINOR - New features (backward compatible)
PATCH - Bug fixes
```

## Current Versions

| Component | Version | Path |
|-----------|---------|------|
| API | 0.4.0 | `api-ts/package.json` |
| Webapp | 1.3.0 | `webapp/package.json` |
| Bot | 1.0.0 | `pyproject.toml` |

## Release Checklist

### 1. Pre-Release

```bash
# Run all tests
cd webapp && bun run test && bun run test:integration

# Build check
cd api-ts && bun build src/app.ts --outdir=dist --target=bun
cd webapp && bunx --bun vite build

# Docker builds
cd api-ts && docker build -t suwappu-api-ts:test .
cd webapp && docker build -t suwappu-webapp:test .
```

### 2. Bump Versions

```bash
# API
cd api-ts
cat package.json | jq '.version = "X.Y.Z"' > package.json.tmp
mv package.json.tmp package.json

# Webapp
cd webapp
cat package.json | jq '.version = "X.Y.Z"' > package.json.tmp
mv package.json.tmp package.json

# Bot (if changed)
# Edit pyproject.toml manually
```

### 3. Update Changelog

Add entry to `CHANGELOG.md`:

```markdown
## [X.Y.Z] - YYYY-MM-DD

### Added
- Feature 1
- Feature 2

### Changed
- Change 1

### Fixed
- Bug fix 1
```

### 4. Commit & Tag

```bash
git add -A
git commit -m "chore: release v0.4.0

- API v0.4.0
- Webapp v1.3.0
- [List major changes]"

# Tag the release
git tag -a v0.4.0 -m "Release v0.4.0"
git push origin main --tags
```

### 5. Deploy

#### Development
```bash
git push origin main:dev
# Triggers: deploy-api-ts.yml, deploy-webapp.yml, deploy-bot.yml
# Deploys to: devapi.suwappu.bot, devfront.suwappu.bot
```

#### Production
```bash
git push origin main
# Triggers workflows for production
# Deploys to: api.suwappu.bot, app.suwappu.bot
```

### 6. Verify Deployment

```bash
# Check API health
curl https://devapi.suwappu.bot/health
curl https://api.suwappu.bot/health

# Check versions match
curl https://devapi.suwappu.bot/health | jq '.version'
```

## Hotfix Process

For urgent fixes:

```bash
# Create hotfix branch
git checkout -b hotfix/description

# Make fix, test
bun run test

# Bump patch version
# e.g., 0.4.0 -> 0.4.1

# Merge to main
git checkout main
git merge hotfix/description
git push origin main

# Tag
git tag -a v0.4.1 -m "Hotfix: description"
git push origin main --tags
```

## Rollback

If deployment fails:

```bash
# Find previous working image
aws ecr describe-images --repository-name suwappu-api-ts \
  --query 'imageDetails | sort_by(@, &imagePushedAt) | [-5:]'

# Update service to previous image
aws ecs update-service --cluster suwappu-cluster \
  --service suwappu-api-ts-dev \
  --task-definition suwappu-api-ts-dev:PREVIOUS_REVISION \
  --force-new-deployment
```

## CI/CD Workflows

| Workflow | Trigger | Target |
|----------|---------|--------|
| `deploy-api-ts.yml` | Push to dev/main | ECS API service |
| `deploy-webapp.yml` | Push to dev/main | ECS Webapp service |
| `deploy-bot.yml` | Push to dev/main | ECS Bot service |

## Environment URLs

| Environment | API | Webapp | Bot |
|-------------|-----|--------|-----|
| Development | devapi.suwappu.bot | devfront.suwappu.bot | @SuwappuDevBot |
| Production | api.suwappu.bot | app.suwappu.bot | @SuwappuBot |
