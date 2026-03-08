#!/bin/bash
# Deploy api-ts to dev environment
set -e

REPO="905418423235.dkr.ecr.us-east-1.amazonaws.com/suwappu-api-ts"
TAG="development"
CLUSTER="suwappu-cluster"
SERVICE="suwappu-api-ts-dev"

cd "$(dirname "$0")/.."

echo "🔐 Logging into ECR..."
AWS_PROFILE=Swappu aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin 905418423235.dkr.ecr.us-east-1.amazonaws.com

echo "🔨 Building Docker image..."
docker build -t "$REPO:$TAG" .

echo "📤 Pushing to ECR..."
docker push "$REPO:$TAG"

echo "🚀 Deploying to ECS..."
AWS_PROFILE=Swappu aws ecs update-service \
  --cluster "$CLUSTER" \
  --service "$SERVICE" \
  --force-new-deployment \
  --region us-east-1 \
  --query 'service.serviceName' \
  --output text

echo "✅ Deployment triggered! Use './scripts/logs-dev.sh' to monitor"
