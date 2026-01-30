#!/bin/bash
# Check status of api-ts dev environment
CLUSTER="suwappu-cluster"
SERVICE="suwappu-api-ts-dev"

echo "🔍 ECS Service Status:"
AWS_PROFILE=Swappu aws ecs describe-services \
  --cluster "$CLUSTER" \
  --services "$SERVICE" \
  --region us-east-1 \
  --query 'services[0].{Running:runningCount,Desired:desiredCount,Pending:pendingCount}' \
  --output table

echo ""
echo "🏥 Health Check:"
curl -s http://devapi.suwappu.dev/health | jq . 2>/dev/null || curl -s http://devapi.suwappu.dev/health
