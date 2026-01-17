# GitHub Actions Workflows

This directory contains CI/CD workflows for automated deployment.

## Workflows

### deploy-ecs.yml

Automated deployment to AWS ECS Fargate.

**Triggers:**
- Push to `main` branch → Production deployment
- Push to `dev` branch → Development deployment
- Manual dispatch via GitHub Actions UI

**What it does:**
1. Builds Docker image from Dockerfile
2. Pushes image to Amazon ECR
3. Updates ECS service with new image
4. Waits for deployment to stabilize

## Branch → Environment Mapping

| Branch | Environment | ECS Service |
|--------|-------------|-------------|
| `main` | Production | `SuwappuStack-SuwappuService3F99BDF9-gqorD1QDcEXk` |
| `dev` | Development | `suwappu-dev-service` |

## Required GitHub Secrets

Configure these in **Settings → Secrets and variables → Actions**:

| Secret | Description |
|--------|-------------|
| `AWS_ACCESS_KEY_ID` | AWS access key for CI/CD user |
| `AWS_SECRET_ACCESS_KEY` | AWS secret key for CI/CD user |

## AWS IAM Policy

The CI/CD user needs these permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ecr:GetAuthorizationToken",
        "ecr:BatchCheckLayerAvailability",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage",
        "ecr:PutImage",
        "ecr:InitiateLayerUpload",
        "ecr:UploadLayerPart",
        "ecr:CompleteLayerUpload"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "ecs:UpdateService",
        "ecs:DescribeServices"
      ],
      "Resource": [
        "arn:aws:ecs:us-east-1:905418423235:service/suwappu-cluster/*"
      ]
    }
  ]
}
```

## Manual Deployment

To deploy manually:

1. Go to **Actions** tab in GitHub
2. Select **Deploy to AWS ECS** workflow
3. Click **Run workflow**
4. Select branch and environment
5. Click **Run workflow**

## Monitoring

After deployment:
- Check ECS console for task status
- View CloudWatch logs at `/ecs/suwappu-dev` or production log group
- Use TUI dashboard: `cd tui && bun run dev`

## Troubleshooting

**Deployment stuck:**
```bash
aws ecs describe-services --cluster suwappu-cluster --services <service-name>
```

**View recent task failures:**
```bash
aws ecs list-tasks --cluster suwappu-cluster --service-name <service-name> --desired-status STOPPED
```

**Force new deployment:**
```bash
aws ecs update-service --cluster suwappu-cluster --service <service-name> --force-new-deployment
```
