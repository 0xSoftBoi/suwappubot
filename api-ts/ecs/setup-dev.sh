#!/bin/bash
set -e

# Configuration (from your existing Suwappu stack)
AWS_REGION="us-east-1"
AWS_ACCOUNT_ID="905418423235"
AWS_PROFILE="Swappu"
ECR_REPO="suwappu-api-ts"
ECS_CLUSTER="suwappu-cluster"
SERVICE_NAME="suwappu-api-ts-dev"
LOG_GROUP="/ecs/suwappu-api-ts"

# Network config (from existing service)
SUBNETS="subnet-028201d90d1e42146,subnet-053c24a62515265c8"
SECURITY_GROUP="sg-0cc9f4d21fa8a5175"

# ALB
ALB_ARN="arn:aws:elasticloadbalancing:us-east-1:905418423235:loadbalancer/app/Suwapp-Suwap-PpZLUzYhsvuj/51b1646f453d843c"
LISTENER_ARN="arn:aws:elasticloadbalancing:us-east-1:905418423235:listener/app/Suwapp-Suwap-PpZLUzYhsvuj/51b1646f453d843c/2d6251b1159acac2"

# Get VPC from subnet
VPC_ID=$(aws ec2 describe-subnets --subnet-ids subnet-028201d90d1e42146 --query 'Subnets[0].VpcId' --output text --profile $AWS_PROFILE --region $AWS_REGION)

echo "=== Suwappu API-TS Dev Setup ==="
echo "VPC: $VPC_ID"
echo "Subnets: $SUBNETS"
echo "Security Group: $SECURITY_GROUP"
echo ""

echo "=== Step 1: Create ECR Repository ==="
aws ecr describe-repositories --repository-names $ECR_REPO --region $AWS_REGION --profile $AWS_PROFILE 2>/dev/null || \
aws ecr create-repository --repository-name $ECR_REPO --region $AWS_REGION --profile $AWS_PROFILE
echo "✓ ECR repository ready"

echo ""
echo "=== Step 2: Create CloudWatch Log Group ==="
aws logs describe-log-groups --log-group-name-prefix $LOG_GROUP --region $AWS_REGION --profile $AWS_PROFILE | grep -q $LOG_GROUP || \
aws logs create-log-group --log-group-name $LOG_GROUP --region $AWS_REGION --profile $AWS_PROFILE
echo "✓ Log group ready"

echo ""
echo "=== Step 3: Build and Push Docker Image ==="
cd "$(dirname "$0")/.."

# Login to ECR
aws ecr get-login-password --region $AWS_REGION --profile $AWS_PROFILE | docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com

# Build and push
docker build -t $ECR_REPO:development .
docker tag $ECR_REPO:development $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPO:development
docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPO:development
echo "✓ Image pushed"

echo ""
echo "=== Step 4: Register Task Definition ==="
aws ecs register-task-definition \
  --cli-input-json file://ecs/task-definition-dev.json \
  --region $AWS_REGION \
  --profile $AWS_PROFILE
echo "✓ Task definition registered"

echo ""
echo "=== Step 5: Create Target Group ==="
TG_ARN=$(aws elbv2 describe-target-groups --names suwappu-api-ts-dev --query 'TargetGroups[0].TargetGroupArn' --output text --profile $AWS_PROFILE --region $AWS_REGION 2>/dev/null || echo "None")

if [ "$TG_ARN" == "None" ]; then
  echo "Creating target group..."
  TG_ARN=$(aws elbv2 create-target-group \
    --name suwappu-api-ts-dev \
    --protocol HTTP \
    --port 8000 \
    --vpc-id $VPC_ID \
    --target-type ip \
    --health-check-path /health \
    --health-check-interval-seconds 30 \
    --healthy-threshold-count 2 \
    --unhealthy-threshold-count 3 \
    --query 'TargetGroups[0].TargetGroupArn' \
    --output text \
    --profile $AWS_PROFILE \
    --region $AWS_REGION)
  echo "✓ Target group created: $TG_ARN"
else
  echo "✓ Target group exists: $TG_ARN"
fi

echo ""
echo "=== Step 6: Add ALB Listener Rule for devapi.suwappu.dev ==="
# Check if rule exists
RULE_EXISTS=$(aws elbv2 describe-rules --listener-arn $LISTENER_ARN --query "Rules[?Conditions[?Values[?contains(@, 'devapi.suwappu.dev')]]].RuleArn" --output text --profile $AWS_PROFILE --region $AWS_REGION 2>/dev/null || echo "")

if [ -z "$RULE_EXISTS" ]; then
  echo "Creating listener rule for devapi.suwappu.dev..."
  aws elbv2 create-rule \
    --listener-arn $LISTENER_ARN \
    --priority 10 \
    --conditions '[{"Field":"host-header","Values":["devapi.suwappu.dev"]}]' \
    --actions "[{\"Type\":\"forward\",\"TargetGroupArn\":\"$TG_ARN\"}]" \
    --profile $AWS_PROFILE \
    --region $AWS_REGION
  echo "✓ Listener rule created"
else
  echo "✓ Listener rule already exists"
fi

echo ""
echo "=== Step 7: Create ECS Service ==="
SERVICE_STATUS=$(aws ecs describe-services --cluster $ECS_CLUSTER --services $SERVICE_NAME --region $AWS_REGION --profile $AWS_PROFILE --query 'services[0].status' --output text 2>/dev/null || echo "MISSING")

if [ "$SERVICE_STATUS" == "ACTIVE" ]; then
  echo "Service exists, forcing new deployment..."
  aws ecs update-service \
    --cluster $ECS_CLUSTER \
    --service $SERVICE_NAME \
    --task-definition suwappu-api-ts-dev \
    --force-new-deployment \
    --region $AWS_REGION \
    --profile $AWS_PROFILE
else
  echo "Creating new ECS service..."
  aws ecs create-service \
    --cluster $ECS_CLUSTER \
    --service-name $SERVICE_NAME \
    --task-definition suwappu-api-ts-dev \
    --desired-count 1 \
    --launch-type FARGATE \
    --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$SECURITY_GROUP],assignPublicIp=DISABLED}" \
    --load-balancers "targetGroupArn=$TG_ARN,containerName=api-ts,containerPort=8000" \
    --region $AWS_REGION \
    --profile $AWS_PROFILE
fi
echo "✓ Service deployed"

echo ""
echo "=== Step 8: Wait for service to stabilize ==="
echo "Waiting for deployment (this may take 2-3 minutes)..."
aws ecs wait services-stable \
  --cluster $ECS_CLUSTER \
  --services $SERVICE_NAME \
  --region $AWS_REGION \
  --profile $AWS_PROFILE

echo ""
echo "=========================================="
echo "✓ DEPLOYMENT COMPLETE"
echo "=========================================="
echo ""
echo "API URL: http://devapi.suwappu.dev/health"
echo "Logs:    aws logs tail $LOG_GROUP --follow --profile $AWS_PROFILE"
echo ""
echo "NOTE: Add this DNS record in Vercel:"
echo "  devapi.suwappu.dev  CNAME  Suwapp-Suwap-PpZLUzYhsvuj-1262209256.us-east-1.elb.amazonaws.com"
