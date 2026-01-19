# Suwappu Deployment Report

**Date:** 2026-01-18
**Version:** webapp v1.1.0, api-ts v0.2.0

## Summary

Successfully deployed updated versions of webapp and api-ts to AWS ECS.

## What Was Done

### 1. Version Bumps
- `webapp`: 1.0.0 → 1.1.0
- `api-ts`: 0.1.0 → 0.2.0

### 2. Docker Image Build & Push

Built and pushed Docker images to the correct AWS account ECR:

| Image | Tags | ECR Repository |
|-------|------|----------------|
| webapp | `prod`, `dev` | `905418423235.dkr.ecr.us-east-1.amazonaws.com/suwappu-webapp` |
| api-ts | `latest`, `development` | `905418423235.dkr.ecr.us-east-1.amazonaws.com/suwappu-api-ts` |

### 3. ECS Service Redeployment

Force-deployed all 4 services in `suwappu-cluster`:
- `suwappu-webapp-prod`
- `suwappu-webapp-dev`
- `suwappu-api-ts-prod`
- `suwappu-api-ts-dev`

### 4. Health Verification

All services verified healthy:

| Endpoint | Status | Protocol |
|----------|--------|----------|
| https://app.suwappu.bot | 200 OK | HTTPS |
| https://devfront.suwappu.bot | 200 OK | HTTPS |
| http://devapi.suwappu.dev/health | 200 OK | HTTP only |

## Infrastructure Details

### AWS Account: `905418423235` (Swappu profile)

**ECS Cluster:** `suwappu-cluster`

**Load Balancers:**
| ALB | DNS | Used By |
|-----|-----|---------|
| suwappu-webapp-prod | suwappu-webapp-prod-494496315.us-east-1.elb.amazonaws.com | app.suwappu.bot |
| suwappu-webapp-dev | suwappu-webapp-dev-1074869316.us-east-1.elb.amazonaws.com | devfront.suwappu.bot |
| Suwapp-Suwap-PpZLUzYhsvuj | Suwapp-Suwap-PpZLUzYhsvuj-1262209256.us-east-1.elb.amazonaws.com | devapi.suwappu.dev |
| suwappu-api-prod | suwappu-api-prod-1251755078.us-east-1.elb.amazonaws.com | (no HTTPS configured) |

**ECR Repositories:**
- `suwappu-webapp`
- `suwappu-api-ts`
- `suwappu`

## Issues Encountered

### 1. Wrong AWS Account Initially
- Default AWS profile was for account `452574030926`
- Suwappu infrastructure is in account `905418423235`
- Solution: Used `AWS_PROFILE=Swappu` for all commands

### 2. API HTTPS Not Working
- `devapi.suwappu.dev` ALB only has HTTP listener (port 80)
- HTTPS (port 443) not configured
- API works via HTTP: `http://devapi.suwappu.dev/health`

### 3. Temporary Health Check Failures
- api-ts-prod tasks initially failed health checks
- Self-recovered after retry
- Root cause: Health check uses `wget` which may have timing issues

## Deployment Commands Reference

```bash
# Login to correct ECR
AWS_PROFILE=Swappu aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin 905418423235.dkr.ecr.us-east-1.amazonaws.com

# Build and push webapp
cd webapp
docker build -t 905418423235.dkr.ecr.us-east-1.amazonaws.com/suwappu-webapp:prod .
docker push 905418423235.dkr.ecr.us-east-1.amazonaws.com/suwappu-webapp:prod

# Build and push api-ts
cd api-ts
docker build -t 905418423235.dkr.ecr.us-east-1.amazonaws.com/suwappu-api-ts:latest .
docker push 905418423235.dkr.ecr.us-east-1.amazonaws.com/suwappu-api-ts:latest

# Force redeploy ECS services
AWS_PROFILE=Swappu aws ecs update-service \
  --cluster suwappu-cluster \
  --service suwappu-webapp-prod \
  --force-new-deployment \
  --region us-east-1

# Check service health
AWS_PROFILE=Swappu aws ecs describe-services \
  --cluster suwappu-cluster \
  --services suwappu-webapp-prod suwappu-webapp-dev suwappu-api-ts-prod suwappu-api-ts-dev \
  --region us-east-1 \
  --query 'services[].{Service:serviceName,Running:runningCount,Desired:desiredCount}'
```

## Recommendations

1. **Add HTTPS to API ALB**: Configure SSL certificate and HTTPS listener for `devapi.suwappu.dev`
2. **Update health check**: Consider using `curl` instead of `wget` in Dockerfile, or add `wget` to bun image
3. **Document AWS profile**: Add AWS profile info to CLAUDE.md for future deployments
