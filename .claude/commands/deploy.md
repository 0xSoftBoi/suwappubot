---
description: "Deploy Suwappu services to EC2/ECS. Usage: /deploy [prod|dev] [bot|webapp|api-ts|all]"
---

# Suwappu Deployment Skill

When invoked, execute the deployment immediately. Parse arguments:
- **First arg**: `prod` (default) or `dev`
- **Second arg**: `bot` (default), `webapp`, `api-ts`, or `all`

## Step 1: Pre-deploy checks

Run these before deploying:

```bash
# Verify SSH key exists
test -f ~/.ssh/suwappu-bot-key && echo "SSH key: OK" || echo "SSH key: MISSING"

# Verify Docker is running (for webapp/api-ts)
docker info > /dev/null 2>&1 && echo "Docker: OK" || echo "Docker: NOT RUNNING"

# Check current branch
git branch --show-current
```

For bot deploys: warn if current branch is not `main` (prod) or `dev` (dev) and confirm with user.

## Step 2: Deploy

### Bot (EC2 SSH)

Run the deploy script directly:

```bash
./scripts/deploy.sh <prod|dev>
```

This SSHs into EC2, pulls the branch, installs deps, refreshes secrets from AWS Secrets Manager, restarts the systemd service, and runs health checks.

**Success**: output contains `Deploy OK!`
**Failure**: output contains `FAILED` with journalctl logs

### Webapp (ECS Fargate)

Run from the `webapp/` directory:

```bash
# 1. ECR login
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin 452574030926.dkr.ecr.us-east-1.amazonaws.com

# 2. Build and push
cd webapp
docker build -t 452574030926.dkr.ecr.us-east-1.amazonaws.com/suwappu-webapp:prod .
docker push 452574030926.dkr.ecr.us-east-1.amazonaws.com/suwappu-webapp:prod

# 3. Force redeploy
aws ecs update-service --cluster suwappu-production --service suwappu-webapp --force-new-deployment --region us-east-1
```

> **Note:** There is only one ECS webapp service (no separate dev). Both prod and dev use the same service with the `prod` image tag.

### API-TS (ECS Fargate)

Run from the `api-ts/` directory:

```bash
# 1. ECR login (same as above)
# 2. Build and push
cd api-ts
docker build -t 452574030926.dkr.ecr.us-east-1.amazonaws.com/suwappu-api-ts:latest .
docker push 452574030926.dkr.ecr.us-east-1.amazonaws.com/suwappu-api-ts:latest

# 3. Force redeploy
aws ecs update-service --cluster suwappu-production --service suwappu-api --force-new-deployment --region us-east-1
```

> **Note:** There is only one ECS api service (no separate dev). Uses the `latest` image tag.

## Step 3: Verify

### Bot health
If the deploy script didn't already confirm, check manually:
```bash
ssh -T -i ~/.ssh/suwappu-bot-key -o StrictHostKeyChecking=no ubuntu@23.21.184.77 \
  "curl -s http://localhost:10000/health | python3 -m json.tool"
```

### ECS health
```bash
aws ecs describe-services \
  --cluster suwappu-production \
  --services suwappu-webapp suwappu-api \
  --region us-east-1 \
  --query 'services[].{Service:serviceName,Running:runningCount,Desired:desiredCount}'
```

### Endpoint checks
```bash
curl -s -o /dev/null -w "%{http_code}" https://app.suwappu.bot/
```

## Troubleshooting

```bash
# Bot logs
ssh -T -i ~/.ssh/suwappu-bot-key -o StrictHostKeyChecking=no ubuntu@23.21.184.77 \
  "sudo journalctl -u suwappubot --no-pager -n 100"

# Restart bot without full deploy
ssh -T -i ~/.ssh/suwappu-bot-key -o StrictHostKeyChecking=no ubuntu@23.21.184.77 \
  "sudo systemctl restart suwappubot && sleep 8 && curl -s http://localhost:10000/health"

# Re-pull secrets only
ssh -T -i ~/.ssh/suwappu-bot-key -o StrictHostKeyChecking=no ubuntu@23.21.184.77 \
  "cd /home/ubuntu/suwappubot && sudo bash scripts/pull-secrets.sh && sudo systemctl restart suwappubot"

# ECS service events
aws ecs describe-services --cluster suwappu-production --services <service> --region us-east-1 \
  --query 'services[0].events[:5]'
```

## Reference

| Service | Method | Image Tag | ECS Service | Endpoint |
|---------|--------|-----------|-------------|----------|
| Bot (prod) | EC2 SSH | n/a | n/a | http://23.21.184.77:10000 |
| Bot (dev) | EC2 SSH | n/a | n/a | http://54.224.128.32:10000 |
| Webapp | ECS Fargate | `prod` | `suwappu-webapp` | https://app.suwappu.bot |
| API-TS | ECS Fargate | `latest` | `suwappu-api` | (internal) |

- **AWS Account:** 905418423235 (EC2/Secrets), 452574030926 (ECS/ECR)
- **EC2 Prod:** 23.21.184.77 (Elastic IP)
- **EC2 Dev:** 54.224.128.32 (Elastic IP)
- **ECS Cluster:** suwappu-production (account 452574030926)
- **ECR Repos:** suwappu-webapp, suwappu-api-ts
- **Region:** us-east-1
- **Systemd Service:** suwappubot
- **Prod Secrets:** `suwappu/app-secrets`, `suwappu/db-credentials`
- **Dev Secrets:** `suwappu/dev-secrets`

> **Note:** GitHub Actions CI/CD (`deploy-ec2.yml`) exists but is currently non-functional due to billing. Use this skill for direct deploys until CI/CD is restored.
