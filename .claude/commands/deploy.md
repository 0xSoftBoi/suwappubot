---
description: "Deploy Suwappu services to EC2/ECS. Usage: /deploy [prod|dev] [bot|webapp|api-ts|all]"
---

# Suwappu Deployment Skill

When invoked, execute the deployment immediately. Parse arguments:
- **First arg**: `prod` (default) or `dev`
- **Second arg**: `bot` (default), `webapp`, `api-ts`, or `all`

## Step 1: Pre-deploy checks

```bash
# Verify Docker is running (for webapp/api-ts)
docker info > /dev/null 2>&1 && echo "Docker: OK" || echo "Docker: NOT RUNNING"

# Verify AWS credentials
aws sts get-caller-identity --query Account --output text  # Should be 905418423235

# Check current branch
git branch --show-current
```

## Step 2: Deploy

### Bot (EC2 via SSM)

No SSH key needed — use AWS SSM:

```bash
# Prod
aws ssm send-command --instance-ids i-087a3657720f6f450 \
  --document-name "AWS-RunShellScript" \
  --parameters 'commands=["export HOME=/root && git config --global --add safe.directory /home/ubuntu/suwappubot && cd /home/ubuntu/suwappubot && git pull origin main 2>&1 && bash scripts/pull-secrets.sh 2>&1 && systemctl restart suwappubot.service && sleep 12 && journalctl -u suwappubot -n 15 --no-pager 2>&1"]' \
  --query 'Command.CommandId' --output text

# Dev
aws ssm send-command --instance-ids i-0e27e67d0c43eedbb \
  --document-name "AWS-RunShellScript" \
  --parameters 'commands=["export HOME=/root && git config --global --add safe.directory /home/ubuntu/suwappubot && cd /home/ubuntu/suwappubot && git pull origin dev 2>&1 && bash scripts/pull-secrets-dev.sh 2>&1 && systemctl restart suwappubot.service && sleep 12 && journalctl -u suwappubot -n 15 --no-pager 2>&1"]' \
  --query 'Command.CommandId' --output text

# Check result (ALWAYS check StandardOutputContent — Status:Failed can be misleading)
aws ssm get-command-invocation --command-id COMMAND_ID \
  --instance-id INSTANCE_ID \
  --query '[Status,StandardOutputContent]' --output text
```

**SSM Gotchas:**
- SSM runs as root without `$HOME` → always `export HOME=/root`
- Git needs `safe.directory` for repos owned by ubuntu
- `Status: Failed` if last command returns non-zero, even if deploy succeeded — check `StandardOutputContent`

### Webapp (ECS Fargate)

```bash
# 1. ECR login
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin 905418423235.dkr.ecr.us-east-1.amazonaws.com

# 2. Build for amd64 (ECS runs Linux x86_64, Mac builds arm64 by default)
cd webapp
docker build --platform linux/amd64 \
  -t 905418423235.dkr.ecr.us-east-1.amazonaws.com/suwappu-webapp:prod .

# 3. Push
docker push 905418423235.dkr.ecr.us-east-1.amazonaws.com/suwappu-webapp:prod

# 4. Force redeploy
aws ecs update-service --cluster suwappu-cluster --service suwappu-webapp-prod --force-new-deployment --region us-east-1
# For dev:
aws ecs update-service --cluster suwappu-cluster --service suwappu-webapp-dev --force-new-deployment --region us-east-1
```

### API-TS (ECS Fargate)

**IMPORTANT:** The task definition uses a git commit SHA as the image tag, not `:latest`. You must tag with the correct SHA.

```bash
# 1. ECR login (same as above)
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin 905418423235.dkr.ecr.us-east-1.amazonaws.com

# 2. Find the image tag the task definition expects
IMAGE_TAG=$(aws ecs describe-services --cluster suwappu-cluster --service suwappu-api-ts-dev --region us-east-1 \
  --query 'services[0].taskDefinition' --output text | \
  xargs -I{} aws ecs describe-task-definition --task-definition {} --region us-east-1 \
  --query 'taskDefinition.containerDefinitions[0].image' --output text | \
  sed 's/.*://')
echo "Image tag needed: $IMAGE_TAG"

# 3. Build for amd64
cd api-ts
docker build --platform linux/amd64 \
  -t 905418423235.dkr.ecr.us-east-1.amazonaws.com/suwappu-api-ts:latest \
  -t 905418423235.dkr.ecr.us-east-1.amazonaws.com/suwappu-api-ts:$IMAGE_TAG .

# 4. Push both tags
docker push 905418423235.dkr.ecr.us-east-1.amazonaws.com/suwappu-api-ts:$IMAGE_TAG
docker push 905418423235.dkr.ecr.us-east-1.amazonaws.com/suwappu-api-ts:latest

# 5. Force redeploy
aws ecs update-service --cluster suwappu-cluster --service suwappu-api-ts-dev --force-new-deployment --region us-east-1
```

## Step 3: Verify

### Bot health (via SSM)
```bash
aws ssm send-command --instance-ids i-087a3657720f6f450 \
  --document-name "AWS-RunShellScript" \
  --parameters 'commands=["curl -s http://localhost:10000/health 2>&1"]' \
  --query 'Command.CommandId' --output text
```

### ECS health
```bash
aws ecs describe-services \
  --cluster suwappu-cluster \
  --services suwappu-api-ts-dev suwappu-webapp-prod suwappu-showcase \
  --region us-east-1 \
  --query 'services[].{Service:serviceName,Running:runningCount,Desired:desiredCount}'
```

### Endpoint checks
```bash
curl -s https://devapi.suwappu.bot/health    # TS API
curl -s -o /dev/null -w "%{http_code}" https://app.suwappu.bot/  # Webapp
```

## Troubleshooting

```bash
# Bot logs via SSM
aws ssm send-command --instance-ids i-087a3657720f6f450 \
  --document-name "AWS-RunShellScript" \
  --parameters 'commands=["journalctl -u suwappubot --no-pager -n 100 2>&1"]' \
  --query 'Command.CommandId' --output text

# ECS service events (check for image pull errors, health check failures)
aws ecs describe-services --cluster suwappu-cluster --services suwappu-api-ts-dev --region us-east-1 \
  --query 'services[0].events[:5]'

# Check stopped tasks for crash reasons
aws ecs list-tasks --cluster suwappu-cluster --service-name suwappu-api-ts-dev --desired-status STOPPED --region us-east-1 --query 'taskArns[0]' --output text | \
  xargs -I{} aws ecs describe-tasks --cluster suwappu-cluster --tasks {} --region us-east-1 \
  --query 'tasks[0].{reason:stoppedReason,exit:containers[0].exitCode}'

# Common ECS issues:
# - "CannotPullContainerError: image not found" → wrong image tag, check task def
# - "platform 'linux/amd64'" error → rebuild with --platform linux/amd64
# - EACCES on startup → Dockerfile missing --chown=bun:bun on COPY commands
# - Exit code 2 → bun syntax/import error, check container logs
```

## Reference

| Service | Method | ECS Service | Endpoint |
|---------|--------|-------------|----------|
| Bot (prod) | EC2 SSM | n/a | http://23.21.184.77:10000 |
| Bot (dev) | EC2 SSM | n/a | http://54.224.128.32:10000 |
| Webapp (prod) | ECS Fargate | `suwappu-webapp-prod` | https://app.suwappu.bot |
| Webapp (dev) | ECS Fargate | `suwappu-webapp-dev` | https://devfront.suwappu.bot |
| API-TS | ECS Fargate | `suwappu-api-ts-dev` | https://devapi.suwappu.bot |
| Showcase | ECS Fargate | `suwappu-showcase` | https://www.suwappu.bot |
| Terminal | ECS Fargate | `suwappu-terminal-prod` | — |

- **AWS Account:** 905418423235 (everything — EC2, ECS, ECR, Secrets, all services)
- **ECS Cluster:** suwappu-cluster
- **ECR:** 905418423235.dkr.ecr.us-east-1.amazonaws.com/suwappu-{api-ts,webapp,showcase,terminal}
- **EC2 Prod:** i-087a3657720f6f450 (23.21.184.77)
- **EC2 Dev:** i-0e27e67d0c43eedbb (54.224.128.32)
- **Region:** us-east-1
- **Systemd Service:** suwappubot
- **Secrets:** `suwappu/app-secrets`, `suwappu/db-credentials` (prod), `suwappu/dev-secrets` (dev)

> **Note:** GitHub Actions CI/CD exists but is non-functional due to billing. Use this skill for direct deploys.
> **Note:** Always build Docker images with `--platform linux/amd64` — Mac M-series builds arm64 by default which won't run on ECS.
