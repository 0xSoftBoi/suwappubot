# Suwappu AWS Infrastructure

AWS CDK infrastructure for deploying Suwappu Bot to AWS.

## Architecture

- **Compute**: ECS Fargate (serverless containers)
- **Database**: RDS PostgreSQL
- **Load Balancer**: Application Load Balancer (ALB)
- **Container Registry**: Amazon ECR
- **Secrets**: AWS Secrets Manager
- **Logging**: CloudWatch Logs

## Prerequisites

1. AWS Account with CLI configured
2. Node.js 18+
3. AWS CDK CLI (`npm install -g aws-cdk`)

## Setup

### 1. Install Dependencies

```bash
cd infra
npm install
```

### 2. Bootstrap CDK (first time only)

```bash
# Bootstrap CDK in your AWS account
npx cdk bootstrap aws://ACCOUNT-ID/REGION
```

### 3. Deploy Infrastructure

```bash
# Preview changes
npx cdk diff

# Deploy
npx cdk deploy --all
```

## Post-Deployment Setup

### 1. Configure Secrets

After deployment, update the secrets in AWS Secrets Manager:

```bash
# Update app secrets
aws secretsmanager update-secret \
  --secret-id suwappu/app-secrets \
  --secret-string '{
    "TELEGRAM_BOT_TOKEN": "your-token",
    "ENCRYPTION_KEY": "your-32-byte-key",
    "ADMIN_API_KEY": "your-admin-key",
    "LIFI_API_KEY": "your-lifi-key",
    "ADMIN_IDS": "123456789",
    "SECRET_KEY": "auto-generated"
  }'
```

### 2. Build and Push Docker Image

```bash
# Login to ECR
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin ACCOUNT.dkr.ecr.us-east-1.amazonaws.com

# Build and push
docker build -t suwappu .
docker tag suwappu:latest ACCOUNT.dkr.ecr.us-east-1.amazonaws.com/suwappu:latest
docker push ACCOUNT.dkr.ecr.us-east-1.amazonaws.com/suwappu:latest
```

### 3. Force ECS Service Update

```bash
aws ecs update-service \
  --cluster suwappu-cluster \
  --service SuwappuStack-SuwappuService \
  --force-new-deployment
```

## GitHub Actions Setup

To enable automated deployments:

1. Create an IAM Role for GitHub Actions with OIDC
2. Add `AWS_ROLE_ARN` to GitHub repository secrets
3. Push to `main` branch to trigger deployment

### Create IAM Role for GitHub OIDC

```bash
# Create trust policy
cat > trust-policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:YOUR_ORG/YOUR_REPO:*"
        }
      }
    }
  ]
}
EOF

aws iam create-role \
  --role-name GitHubActionsRole \
  --assume-role-policy-document file://trust-policy.json

# Attach policies
aws iam attach-role-policy \
  --role-name GitHubActionsRole \
  --policy-arn arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryPowerUser

aws iam attach-role-policy \
  --role-name GitHubActionsRole \
  --policy-arn arn:aws:iam::aws:policy/AmazonECS_FullAccess
```

## Useful Commands

```bash
# View CloudWatch logs
aws logs tail /ecs/suwappu --follow

# Connect to container for debugging
aws ecs execute-command \
  --cluster suwappu-cluster \
  --task TASK_ID \
  --container suwappu \
  --interactive \
  --command "/bin/bash"

# Check service status
aws ecs describe-services \
  --cluster suwappu-cluster \
  --services SuwappuStack-SuwappuService

# Destroy infrastructure (careful!)
npx cdk destroy --all
```

## Cost Estimate

| Service | Monthly Cost |
|---------|-------------|
| ECS Fargate | ~$10 |
| RDS PostgreSQL (t3.micro) | ~$15 |
| ALB | ~$16 |
| NAT Gateway | ~$32 |
| ECR | ~$1 |
| Secrets Manager | ~$1 |
| **Total** | **~$75/month** |

Note: NAT Gateway is the largest cost. Consider removing it and using public subnets if cost is a concern.
