---
description: "Deploy Suwappu services (bot via EC2 SSH, webapp/api-ts via ECS)"
---

# Suwappu Deployment Skill

## Python Bot (EC2 SSH Deploy)

The primary deployment method for the Python bot (`api/` + `bot/`). Uses `scripts/deploy.sh` to SSH into EC2, pull code, install deps, refresh secrets, and restart the systemd service.

### Prerequisites

- SSH key at `~/.ssh/suwappu-bot-key`
- EC2 instance running with systemd service `suwappubot`
- AWS Secrets Manager configured (`suwappu/app-secrets`, `suwappu/db-credentials`)

### Deploy

```bash
# Production (main branch)
./scripts/deploy.sh prod

# Development (dev branch)
./scripts/deploy.sh dev
```

### What the script does

1. SSH into EC2 host (`23.21.184.77`)
2. `git fetch` + `git reset --hard origin/<branch>`
3. `pip install -r requirements.txt`
4. `sudo bash scripts/pull-secrets.sh` (pulls from AWS Secrets Manager → `.env`)
5. Copies `suwappubot.service` → systemd, daemon-reload, restart
6. Health checks on `http://localhost:10000/health` (retries 5x)
7. Reports status: `healthy polling connected` = success

### Verify manually

```bash
# SSH in and check
ssh -i ~/.ssh/suwappu-bot-key ubuntu@23.21.184.77

# On the server:
sudo systemctl status suwappubot
sudo journalctl -u suwappubot --no-pager -n 50
curl -s http://localhost:10000/health | python3 -m json.tool
```

### Troubleshooting

```bash
# Check service logs
ssh -i ~/.ssh/suwappu-bot-key ubuntu@23.21.184.77 \
  "sudo journalctl -u suwappubot --no-pager -n 100"

# Restart without full deploy
ssh -i ~/.ssh/suwappu-bot-key ubuntu@23.21.184.77 \
  "sudo systemctl restart suwappubot && sleep 8 && curl -s http://localhost:10000/health"

# Re-pull secrets only
ssh -i ~/.ssh/suwappu-bot-key ubuntu@23.21.184.77 \
  "cd /home/ubuntu/suwappubot && sudo bash scripts/pull-secrets.sh && sudo systemctl restart suwappubot"
```

---

## Webapp & API-TS (ECS Fargate Deploy)

These services still deploy via Docker → ECR → ECS.

### Prerequisites

- AWS CLI configured (account `905418423235`)
- Docker installed and running

### Step 1: Login to ECR

```bash
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin 905418423235.dkr.ecr.us-east-1.amazonaws.com
```

### Step 2: Build and Push Images

**Webapp (from webapp/ directory):**
```bash
docker build -t 905418423235.dkr.ecr.us-east-1.amazonaws.com/suwappu-webapp:prod .
docker push 905418423235.dkr.ecr.us-east-1.amazonaws.com/suwappu-webapp:prod
```

**API-TS (from api-ts/ directory):**
```bash
docker build -t 905418423235.dkr.ecr.us-east-1.amazonaws.com/suwappu-api-ts:latest .
docker push 905418423235.dkr.ecr.us-east-1.amazonaws.com/suwappu-api-ts:latest
```

### Step 3: Force Redeploy ECS Services

```bash
aws ecs update-service --cluster suwappu-cluster --service suwappu-webapp-prod --force-new-deployment --region us-east-1
aws ecs update-service --cluster suwappu-cluster --service suwappu-api-ts-prod --force-new-deployment --region us-east-1
```

### Step 4: Verify Health

```bash
aws ecs describe-services \
  --cluster suwappu-cluster \
  --services suwappu-webapp-prod suwappu-api-ts-prod \
  --region us-east-1 \
  --query 'services[].{Service:serviceName,Running:runningCount,Desired:desiredCount}'

curl -s -o /dev/null -w "%{http_code}" https://app.suwappu.bot/
```

---

## Service Map

| Service | Deploy Method | Command | Endpoint |
|---------|--------------|---------|----------|
| Python bot (prod) | EC2 SSH | `./scripts/deploy.sh prod` | http://23.21.184.77:10000 |
| Python bot (dev) | EC2 SSH | `./scripts/deploy.sh dev` | http://23.21.184.77:10000 |
| Webapp (prod) | ECS Fargate | Docker → ECR → ECS | https://app.suwappu.bot |
| Webapp (dev) | ECS Fargate | Docker → ECR → ECS | https://devfront.suwappu.bot |
| API-TS (prod) | ECS Fargate | Docker → ECR → ECS | (internal) |
| API-TS (dev) | ECS Fargate | Docker → ECR → ECS | http://devapi.suwappu.dev |

## Infrastructure Reference

- **AWS Account:** 905418423235
- **EC2 Host:** 23.21.184.77 (Elastic IP)
- **ECS Cluster:** suwappu-cluster
- **ECR Repos:** suwappu-webapp, suwappu-api-ts
- **Region:** us-east-1
- **Systemd Service:** suwappubot
- **Secrets:** `suwappu/app-secrets`, `suwappu/db-credentials` (AWS Secrets Manager)
