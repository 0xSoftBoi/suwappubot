# AWS Deployment Guide

Complete guide for deploying Suwappu to AWS.

## Architecture

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

## Prerequisites

1. **AWS Account** with administrative access
2. **AWS CLI** installed and configured (`aws configure`)
3. **Docker** installed
4. **Node.js 18+** installed

## Quick Start

```bash
# 1. Deploy infrastructure
./scripts/deploy-aws.sh setup

# 2. Configure secrets (see below)

# 3. Build and push Docker image
./scripts/deploy-aws.sh push

# 4. Update ECS service
./scripts/deploy-aws.sh update

# 5. Check status
./scripts/deploy-aws.sh status
```


## Detailed Steps

### Step 1: Deploy Infrastructure

```bash
./scripts/deploy-aws.sh setup
```

This will:
- Install CDK dependencies
- Bootstrap CDK in your AWS account
- Create VPC, subnets, security groups
- Create RDS PostgreSQL database
- Create ECS cluster and service
- Create Application Load Balancer
- Create ECR repository
- Create Secrets Manager secrets

### Step 2: Configure Secrets

After infrastructure is deployed, update the secrets:

```bash
# Get the secrets ARN
aws secretsmanager list-secrets --query 'SecretList[?Name==`suwappu/app-secrets`].ARN' --output text

# Update secrets
aws secretsmanager update-secret \
  --secret-id suwappu/app-secrets \
  --secret-string '{
    "TELEGRAM_BOT_TOKEN": "YOUR_TELEGRAM_BOT_TOKEN",
    "ENCRYPTION_KEY": "YOUR_32_BYTE_ENCRYPTION_KEY",
    "ADMIN_API_KEY": "YOUR_ADMIN_API_KEY",
    "LIFI_API_KEY": "YOUR_LIFI_API_KEY",
    "TURNKEY_ORGANIZATION_ID": "YOUR_TURNKEY_ORG_ID",
    "TURNKEY_API_PUBLIC_KEY": "YOUR_TURNKEY_PUBLIC_KEY",
    "TURNKEY_API_PRIVATE_KEY": "YOUR_TURNKEY_PRIVATE_KEY",
    "WHATSAPP_ACCESS_TOKEN": "YOUR_WHATSAPP_TOKEN",
    "WHATSAPP_PHONE_NUMBER_ID": "YOUR_WHATSAPP_PHONE_ID",
    "ADMIN_IDS": "123456789,987654321",
    "SECRET_KEY": "GENERATED_AUTOMATICALLY"
  }'
```

### Step 3: Build and Push Docker Image

```bash
./scripts/deploy-aws.sh push
```

### Step 4: Update ECS Service

```bash
./scripts/deploy-aws.sh update
```

### Step 5: Verify Deployment

```bash
# Check service status
./scripts/deploy-aws.sh status

# View logs
./scripts/deploy-aws.sh logs

# Test health endpoint
curl http://YOUR_LOAD_BALANCER_DNS/health
```

## Database Migration

### Export from Render

```bash
# Get connection string from Render dashboard
pg_dump "postgresql://user:pass@host/dbname" > backup.sql
```

### Import to AWS RDS

```bash
# Get RDS endpoint
aws rds describe-db-instances \
  --db-instance-identifier suwappustack-suwappudatabase* \
  --query 'DBInstances[0].Endpoint.Address' \
  --output text

# Get RDS password from Secrets Manager
aws secretsmanager get-secret-value \
  --secret-id suwappu/db-credentials \
  --query SecretString \
  --output text | jq -r '.password'

# Import backup
psql "postgresql://suwappu:PASSWORD@RDS_ENDPOINT:5432/suwappubot" < backup.sql
```

## GitHub Actions CI/CD

### Setup OIDC Provider

1. Go to AWS IAM > Identity providers > Add provider
2. Provider type: OpenID Connect
3. Provider URL: `https://token.actions.githubusercontent.com`
4. Audience: `sts.amazonaws.com`

### Create IAM Role

```bash
# Create role with trust policy for GitHub
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

cat > trust-policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::${ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:0xSoftBoi/suwappubot:*"
        }
      }
    }
  ]
}
EOF

aws iam create-role \
  --role-name GitHubActionsRole \
  --assume-role-policy-document file://trust-policy.json

# Attach required policies
aws iam attach-role-policy --role-name GitHubActionsRole \
  --policy-arn arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryPowerUser
aws iam attach-role-policy --role-name GitHubActionsRole \
  --policy-arn arn:aws:iam::aws:policy/AmazonECS_FullAccess
```

### Add GitHub Secret

1. Go to GitHub repo > Settings > Secrets and variables > Actions
2. Add secret `AWS_ROLE_ARN` with value: `arn:aws:iam::ACCOUNT_ID:role/GitHubActionsRole`

## Monitoring

### CloudWatch Logs

```bash
# Stream logs
aws logs tail /ecs/suwappu --follow

# Search logs
aws logs filter-log-events \
  --log-group-name /ecs/suwappu \
  --filter-pattern "ERROR"
```

### ECS Service Metrics

View in AWS Console: CloudWatch > Metrics > ECS

Key metrics:
- CPUUtilization
- MemoryUtilization
- RunningTaskCount

### Set Up Alarms

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name suwappu-cpu-high \
  --metric-name CPUUtilization \
  --namespace AWS/ECS \
  --statistic Average \
  --period 300 \
  --threshold 80 \
  --comparison-operator GreaterThanThreshold \
  --dimensions Name=ClusterName,Value=suwappu-cluster Name=ServiceName,Value=SuwappuStack-SuwappuService \
  --evaluation-periods 2 \
  --alarm-actions arn:aws:sns:us-east-1:ACCOUNT_ID:alerts
```

## Troubleshooting

### Container Won't Start

```bash
# Check task status
aws ecs describe-tasks \
  --cluster suwappu-cluster \
  --tasks $(aws ecs list-tasks --cluster suwappu-cluster --query 'taskArns[0]' --output text)

# Check stopped task reason
aws ecs describe-tasks \
  --cluster suwappu-cluster \
  --tasks TASK_ARN \
  --query 'tasks[0].stoppedReason'
```

### Database Connection Issues

```bash
# Test connectivity from ECS task
aws ecs execute-command \
  --cluster suwappu-cluster \
  --task TASK_ID \
  --container suwappu \
  --interactive \
  --command "psql \$DATABASE_URL -c 'SELECT 1'"
```

### Health Check Failing

```bash
# Check container logs
aws logs tail /ecs/suwappu --since 10m

# Test health endpoint locally
docker run -p 10000:10000 suwappu:latest
curl http://localhost:10000/health
```

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

## Cost Optimization

### Reduce NAT Gateway Costs

NAT Gateway costs ~$32/month. To reduce:

1. **Use NAT Instance** instead (t3.nano ~$3/month)
2. **Use VPC Endpoints** for AWS services
3. **Remove NAT** and put ECS in public subnet (less secure)

### Use Spot Instances for Fargate

Add to task definition:
```typescript
capacityProviderStrategies: [
  { capacityProvider: 'FARGATE_SPOT', weight: 1 },
  { capacityProvider: 'FARGATE', weight: 0, base: 1 },
]
```

### Scale to Zero

For dev environments, scale to 0 during off-hours:
```bash
aws ecs update-service \
  --cluster suwappu-cluster \
  --service SuwappuStack-SuwappuService \
  --desired-count 0
```

## Cleanup

To destroy all resources:

```bash
cd infra
npx cdk destroy --all
```

**Warning**: This will delete the database. Make sure to backup first!
