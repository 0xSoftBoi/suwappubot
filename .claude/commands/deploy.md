---
description: "Deploy Suwappu webapp and api-ts to AWS ECS"
---

# Suwappu Deployment Skill

Deploy the Suwappu webapp and/or api-ts services to AWS ECS.

## Prerequisites

- AWS CLI configured (default profile, account `905418423235`)
- Docker installed and running
- Access to AWS account `905418423235`

## Deployment Steps

### Step 1: Login to ECR

```bash
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin 905418423235.dkr.ecr.us-east-1.amazonaws.com
```

### Step 2: Build and Push Images

**Webapp (from webapp/ directory):**
```bash
# Build prod
docker build -t 905418423235.dkr.ecr.us-east-1.amazonaws.com/suwappu-webapp:prod .
docker push 905418423235.dkr.ecr.us-east-1.amazonaws.com/suwappu-webapp:prod

# Build dev
docker build -t 905418423235.dkr.ecr.us-east-1.amazonaws.com/suwappu-webapp:dev .
docker push 905418423235.dkr.ecr.us-east-1.amazonaws.com/suwappu-webapp:dev
```

**API-TS (from api-ts/ directory):**
```bash
# Build prod (latest tag)
docker build -t 905418423235.dkr.ecr.us-east-1.amazonaws.com/suwappu-api-ts:latest .
docker push 905418423235.dkr.ecr.us-east-1.amazonaws.com/suwappu-api-ts:latest

# Build dev (development tag)
docker build -t 905418423235.dkr.ecr.us-east-1.amazonaws.com/suwappu-api-ts:development .
docker push 905418423235.dkr.ecr.us-east-1.amazonaws.com/suwappu-api-ts:development
```

### Step 3: Force Redeploy ECS Services

```bash
# Webapp services
aws ecs update-service --cluster suwappu-cluster --service suwappu-webapp-prod --force-new-deployment --region us-east-1
aws ecs update-service --cluster suwappu-cluster --service suwappu-webapp-dev --force-new-deployment --region us-east-1

# API services
aws ecs update-service --cluster suwappu-cluster --service suwappu-api-ts-prod --force-new-deployment --region us-east-1
aws ecs update-service --cluster suwappu-cluster --service suwappu-api-ts-dev --force-new-deployment --region us-east-1
```

### Step 4: Verify Health

Wait 60-90 seconds for deployment, then check:

```bash
# Check ECS service status
aws ecs describe-services \
  --cluster suwappu-cluster \
  --services suwappu-webapp-prod suwappu-webapp-dev suwappu-api-ts-prod suwappu-api-ts-dev \
  --region us-east-1 \
  --query 'services[].{Service:serviceName,Running:runningCount,Desired:desiredCount}'

# Check endpoints
curl -s -o /dev/null -w "%{http_code}" https://app.suwappu.bot/
curl -s -o /dev/null -w "%{http_code}" https://devfront.suwappu.bot/
curl -s http://devapi.suwappu.dev/health
```

## Service Mapping

| Service | Image Tag | Endpoint |
|---------|-----------|----------|
| suwappu-webapp-prod | `prod` | https://app.suwappu.bot |
| suwappu-webapp-dev | `dev` | https://devfront.suwappu.bot |
| suwappu-api-ts-prod | `latest` | (internal) |
| suwappu-api-ts-dev | `development` | http://devapi.suwappu.dev |

## Troubleshooting

### Check Target Health
```bash
# Get target group ARNs
aws elbv2 describe-target-groups --region us-east-1 \
  --query 'TargetGroups[?contains(TargetGroupName, `suwappu`)].{Name:TargetGroupName,ARN:TargetGroupArn}'

# Check specific target health
aws elbv2 describe-target-health \
  --target-group-arn <TARGET_GROUP_ARN> --region us-east-1
```

### Check ECS Task Logs
```bash
# List recent tasks
aws ecs list-tasks --cluster suwappu-cluster --service-name <SERVICE_NAME> --region us-east-1

# Describe task for container details
aws ecs describe-tasks --cluster suwappu-cluster --tasks <TASK_ARN> --region us-east-1
```

### Service Events
```bash
aws ecs describe-services \
  --cluster suwappu-cluster \
  --services <SERVICE_NAME> \
  --region us-east-1 \
  --query 'services[0].events[:5]'
```

## Infrastructure Reference

- **AWS Account:** 905418423235 (default profile)
- **ECS Cluster:** suwappu-cluster
- **ECR Repos:** suwappu-webapp, suwappu-api-ts
- **Region:** us-east-1

Execute each step and verify before proceeding to the next.
