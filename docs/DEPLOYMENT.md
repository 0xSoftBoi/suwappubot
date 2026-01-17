# Deployment Guide

This guide covers deploying the Suwappu Cross-Chain Swap Bot to AWS.

## Table of Contents
1. [Prerequisites](#prerequisites)
2. [AWS Architecture](#aws-architecture)
3. [Deployment Steps](#deployment-steps)
4. [Environment Variables](#environment-variables)
5. [Security](#security)
6. [Monitoring](#monitoring)

---

## Prerequisites

- AWS Account with appropriate permissions
- AWS CLI configured (`aws configure`)
- Node.js 18+ (for CDK)
- Docker installed locally
- Telegram Bot Token (from [@BotFather](https://t.me/BotFather))

---

## AWS Architecture

```
                    ┌─────────────────┐
                    │   Route 53      │
                    │   (DNS)         │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │   ALB           │
                    │   (Load Balancer)│
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
       ┌──────▼──────┐┌──────▼──────┐┌──────▼──────┐
       │   ECS Task  ││   ECS Task  ││   ECS Task  │
       │   (Fargate) ││   (Fargate) ││   (Fargate) │
       └──────┬──────┘└──────┬──────┘└──────┬──────┘
              │              │              │
              └──────────────┼──────────────┘
                             │
                    ┌────────▼────────┐
                    │   RDS PostgreSQL│
                    │   (Database)    │
                    └─────────────────┘
```

**Components:**
- **VPC**: 2 AZs with public/private/isolated subnets
- **ECS Fargate**: Auto-scaling 1-3 containers
- **RDS PostgreSQL**: Managed database with backups
- **ALB**: Internet-facing load balancer
- **ECR**: Container registry
- **Secrets Manager**: Secure credential storage
- **CloudWatch**: Logs and metrics

---

## Deployment Steps

### 1. Install CDK Dependencies

```bash
cd infra
npm install
```

### 2. Configure AWS Secrets

Create secrets in AWS Secrets Manager:

```bash
# Create bot secrets
aws secretsmanager create-secret \
  --name suwappu/bot-token \
  --secret-string "YOUR_TELEGRAM_BOT_TOKEN"

aws secretsmanager create-secret \
  --name suwappu/encryption-key \
  --secret-string "$(python -c 'import secrets; print(secrets.token_hex(32))')"

# Optional: API keys
aws secretsmanager create-secret \
  --name suwappu/alchemy-api-key \
  --secret-string "YOUR_ALCHEMY_KEY"
```

### 3. Bootstrap CDK (First Time Only)

```bash
cd infra
npx cdk bootstrap
```

### 4. Deploy Infrastructure

```bash
# Deploy all stacks
npx cdk deploy --all

# Or deploy specific stack
npx cdk deploy SuwappuStack
```

### 5. Build and Push Docker Image

```bash
# Get ECR login
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com

# Build image
docker build -t suwappu .

# Tag for ECR
docker tag suwappu:latest ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/suwappu:latest

# Push to ECR
docker push ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/suwappu:latest
```

### 6. Force New Deployment

```bash
aws ecs update-service \
  --cluster suwappu-cluster \
  --service suwappu-service \
  --force-new-deployment
```

---

## Environment Variables

Set these in the ECS task definition or Secrets Manager:

```bash
# Required
TELEGRAM_BOT_TOKEN=         # From @BotFather
ENCRYPTION_KEY=             # 32-byte hex key
DATABASE_URL=               # RDS connection string (auto-set by CDK)

# Optional - API Keys
ALCHEMY_API_KEY=            # For enhanced RPC
LIFI_API_KEY=               # For bridge aggregation
SOCKET_API_KEY=             # For Socket.tech

# Optional - OAuth
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
TWITTER_CLIENT_ID=
TWITTER_CLIENT_SECRET=
OAUTH_REDIRECT_BASE=https://your-domain.com

# Optional - Turnkey (for managed wallets)
WALLET_PROVIDER=turnkey
TURNKEY_ORGANIZATION_ID=
TURNKEY_API_PUBLIC_KEY=
TURNKEY_API_PRIVATE_KEY=

# Configuration
LOG_LEVEL=INFO
SWAP_FEE_PERCENTAGE=0.8
REFERRAL_REWARD_PERCENTAGE=30
```

---

## CI/CD with CodePipeline

The `buildspec.yml` is configured for AWS CodeBuild:

```yaml
version: 0.2
phases:
  pre_build:
    commands:
      - aws ecr get-login-password | docker login --username AWS --password-stdin $ECR_REGISTRY
  build:
    commands:
      - docker build -t $IMAGE_REPO_NAME:$IMAGE_TAG .
      - docker tag $IMAGE_REPO_NAME:$IMAGE_TAG $ECR_REGISTRY/$IMAGE_REPO_NAME:$IMAGE_TAG
  post_build:
    commands:
      - docker push $ECR_REGISTRY/$IMAGE_REPO_NAME:$IMAGE_TAG
```

To set up automatic deployments:

1. Connect GitHub to CodePipeline
2. Configure CodeBuild with `buildspec.yml`
3. Add ECS deploy action after build

---

## Security

### Secrets Management

```bash
# Rotate encryption key (careful - affects existing wallets!)
aws secretsmanager rotate-secret --secret-id suwappu/encryption-key

# View secret value
aws secretsmanager get-secret-value --secret-id suwappu/bot-token
```

### Network Security

- ALB accepts HTTP/HTTPS from internet (0.0.0.0/0)
- ECS tasks in private subnets (NAT gateway for outbound)
- RDS in isolated subnet (only accessible from ECS)
- Security groups restrict traffic appropriately

### IAM Permissions

The CDK creates minimal IAM roles:
- ECS Task Role: Access to Secrets Manager, CloudWatch
- ECS Execution Role: Pull from ECR, write logs

---

## Monitoring

### CloudWatch Logs

```bash
# View recent logs
aws logs tail /ecs/suwappu --follow

# Search logs
aws logs filter-log-events \
  --log-group-name /ecs/suwappu \
  --filter-pattern "ERROR"
```

### Health Check

```bash
# Check ALB health
curl https://your-alb-dns.amazonaws.com/health

# Expected response
{"status": "healthy", "service": "suwappu-api", "database": "connected"}
```

### Alarms (Add in CDK)

```typescript
// CPU alarm
new cloudwatch.Alarm(this, 'CpuAlarm', {
  metric: service.metricCpuUtilization(),
  threshold: 80,
  evaluationPeriods: 2,
});
```

---

## Scaling

Auto-scaling is configured in CDK:

```typescript
const scaling = service.autoScaleTaskCount({
  minCapacity: 1,
  maxCapacity: 3,
});

scaling.scaleOnCpuUtilization('CpuScaling', {
  targetUtilizationPercent: 70,
});
```

To manually scale:

```bash
aws ecs update-service \
  --cluster suwappu-cluster \
  --service suwappu-service \
  --desired-count 2
```

---

## Cost Estimates

| Component | Monthly Cost |
|-----------|-------------|
| ECS Fargate (1 task, 0.25 vCPU, 0.5GB) | ~$10 |
| RDS PostgreSQL (t3.micro) | ~$15 |
| ALB | ~$20 |
| NAT Gateway | ~$35 |
| ECR Storage | ~$1 |
| CloudWatch Logs | ~$5 |
| **Total** | **~$85/month** |

Cost optimization:
- Use Fargate Spot for dev/staging
- Schedule scaling down during off-hours
- Use Reserved Capacity for production

---

## Troubleshooting

### ECS Task Won't Start

```bash
# Check task status
aws ecs describe-tasks \
  --cluster suwappu-cluster \
  --tasks TASK_ARN

# Check stopped task reason
aws ecs describe-tasks \
  --cluster suwappu-cluster \
  --tasks TASK_ARN \
  --query 'tasks[0].stoppedReason'
```

### Database Connection Issues

```bash
# Test from local (requires VPN/bastion)
psql $DATABASE_URL -c "SELECT 1"

# Check security groups allow ECS -> RDS
aws ec2 describe-security-groups --group-ids sg-xxx
```

### Image Pull Errors

```bash
# Verify image exists
aws ecr describe-images --repository-name suwappu

# Check execution role has ECR permissions
aws iam get-role-policy --role-name ecsTaskExecutionRole --policy-name ecr-policy
```

---

## Useful Commands

```bash
# Deploy
cd infra && npx cdk deploy --all

# Destroy (careful!)
cd infra && npx cdk destroy --all

# View stack outputs
aws cloudformation describe-stacks --stack-name SuwappuStack --query 'Stacks[0].Outputs'

# Force deployment
aws ecs update-service --cluster suwappu-cluster --service suwappu-service --force-new-deployment

# View running tasks
aws ecs list-tasks --cluster suwappu-cluster --service-name suwappu-service
```

---

## Support

- Issues: [GitHub Issues](https://github.com/0xSoftBoi/suwappubot/issues)
