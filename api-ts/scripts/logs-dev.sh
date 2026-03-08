#!/bin/bash
# View logs for api-ts dev environment
CLUSTER="suwappu-cluster"
SERVICE="suwappu-api-ts-dev"
LOG_GROUP="/ecs/suwappu"

TASK_ID=$(AWS_PROFILE=Swappu aws ecs list-tasks \
  --cluster "$CLUSTER" \
  --service-name "$SERVICE" \
  --region us-east-1 \
  --query 'taskArns[0]' \
  --output text | xargs basename)

echo "📋 Task ID: $TASK_ID"
echo "---"

AWS_PROFILE=Swappu aws logs get-log-events \
  --log-group-name "$LOG_GROUP" \
  --log-stream-name "api-ts-dev/api-ts/$TASK_ID" \
  --start-from-head \
  --limit "${1:-50}" \
  --region us-east-1 \
  --query 'events[*].message' \
  --output text
