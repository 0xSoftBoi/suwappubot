#!/usr/bin/env bash
#
# One-time setup script for Showcase ECS infrastructure.
# Run with: AWS_PROFILE=Swappu bash scripts/setup-showcase-ecs.sh
#
set -euo pipefail

AWS_REGION="us-east-1"
ACCOUNT_ID="905418423235"
CLUSTER="suwappu-cluster"
ECR_REPO="suwappu-showcase"
SERVICE_NAME="suwappu-showcase-prod"
TASK_FAMILY="suwappu-showcase"
TG_NAME="suwappu-showcase-tg"
LOG_GROUP="/ecs/suwappu-showcase"
IMAGE="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPO}:production"

echo "=== Showcase ECS Setup ==="
echo "Region: ${AWS_REGION}"
echo "Account: ${ACCOUNT_ID}"
echo ""

# ---------- 1. ECR Repository ----------
echo "--- 1. Creating ECR repository (if needed)..."
aws ecr describe-repositories --repository-names "${ECR_REPO}" --region "${AWS_REGION}" 2>/dev/null \
  || aws ecr create-repository \
       --repository-name "${ECR_REPO}" \
       --image-scanning-configuration scanOnPush=true \
       --region "${AWS_REGION}"
echo "ECR repository: ${ECR_REPO} ✓"

# ---------- 2. CloudWatch Log Group ----------
echo "--- 2. Creating CloudWatch log group (if needed)..."
aws logs create-log-group --log-group-name "${LOG_GROUP}" --region "${AWS_REGION}" 2>/dev/null || true
echo "Log group: ${LOG_GROUP} ✓"

# ---------- 3. Task Definition ----------
echo "--- 3. Registering ECS task definition..."

# Get the existing task execution role ARN (reuse from other services)
EXEC_ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/ecsTaskExecutionRole"

cat > /tmp/showcase-task-def.json <<EOF
{
  "family": "${TASK_FAMILY}",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "256",
  "memory": "512",
  "executionRoleArn": "${EXEC_ROLE_ARN}",
  "containerDefinitions": [
    {
      "name": "showcase",
      "image": "${IMAGE}",
      "essential": true,
      "portMappings": [
        {
          "containerPort": 3000,
          "protocol": "tcp"
        }
      ],
      "healthCheck": {
        "command": ["CMD-SHELL", "wget --no-verbose --tries=1 --spider http://localhost:3000/ || exit 1"],
        "interval": 30,
        "timeout": 5,
        "retries": 3,
        "startPeriod": 15
      },
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "${LOG_GROUP}",
          "awslogs-region": "${AWS_REGION}",
          "awslogs-stream-prefix": "showcase"
        }
      },
      "environment": [
        { "name": "NODE_ENV", "value": "production" },
        { "name": "PORT", "value": "3000" },
        { "name": "HOSTNAME", "value": "0.0.0.0" }
      ]
    }
  ]
}
EOF

aws ecs register-task-definition \
  --cli-input-json file:///tmp/showcase-task-def.json \
  --region "${AWS_REGION}" > /dev/null

echo "Task definition: ${TASK_FAMILY} ✓"

# ---------- 4. Target Group ----------
echo "--- 4. Creating ALB target group..."

# Get VPC ID from the cluster
VPC_ID=$(aws ec2 describe-vpcs \
  --filters "Name=tag:Name,Values=*Suwappu*" \
  --query "Vpcs[0].VpcId" \
  --output text \
  --region "${AWS_REGION}")

TG_ARN=$(aws elbv2 create-target-group \
  --name "${TG_NAME}" \
  --protocol HTTP \
  --port 3000 \
  --vpc-id "${VPC_ID}" \
  --target-type ip \
  --health-check-path "/" \
  --health-check-interval-seconds 30 \
  --healthy-threshold-count 2 \
  --unhealthy-threshold-count 3 \
  --query "TargetGroups[0].TargetGroupArn" \
  --output text \
  --region "${AWS_REGION}" 2>/dev/null) || {
    # Target group may already exist
    TG_ARN=$(aws elbv2 describe-target-groups \
      --names "${TG_NAME}" \
      --query "TargetGroups[0].TargetGroupArn" \
      --output text \
      --region "${AWS_REGION}")
  }

echo "Target group: ${TG_ARN} ✓"

# ---------- 5. HTTPS Listener Rule ----------
echo "--- 5. Adding HTTPS listener rule for suwappu.bot..."

# Find the ALB and HTTPS listener
ALB_ARN=$(aws elbv2 describe-load-balancers \
  --query "LoadBalancers[?contains(LoadBalancerName, 'Suwappu') || contains(LoadBalancerName, 'suwappu')].LoadBalancerArn" \
  --output text \
  --region "${AWS_REGION}")

LISTENER_ARN=$(aws elbv2 describe-listeners \
  --load-balancer-arn "${ALB_ARN}" \
  --query "Listeners[?Port==\`443\`].ListenerArn" \
  --output text \
  --region "${AWS_REGION}")

# Get the next available priority
EXISTING_PRIORITIES=$(aws elbv2 describe-rules \
  --listener-arn "${LISTENER_ARN}" \
  --query "Rules[?Priority!='default'].Priority" \
  --output text \
  --region "${AWS_REGION}" | tr '\t' '\n' | sort -n | tail -1)

NEXT_PRIORITY=$((${EXISTING_PRIORITIES:-0} + 10))

aws elbv2 create-rule \
  --listener-arn "${LISTENER_ARN}" \
  --priority "${NEXT_PRIORITY}" \
  --conditions "Field=host-header,Values=suwappu.bot" \
  --actions "Type=forward,TargetGroupArn=${TG_ARN}" \
  --region "${AWS_REGION}" > /dev/null 2>/dev/null || echo "  (listener rule may already exist)"

echo "Listener rule: host=suwappu.bot → ${TG_NAME} (priority ${NEXT_PRIORITY}) ✓"

# ---------- 6. ECS Service ----------
echo "--- 6. Creating ECS service..."

# Get private subnets
SUBNET_IDS=$(aws ec2 describe-subnets \
  --filters "Name=vpc-id,Values=${VPC_ID}" "Name=tag:Name,Values=*Private*" \
  --query "Subnets[*].SubnetId" \
  --output text \
  --region "${AWS_REGION}" | tr '\t' ',')

# Get ALB security group
ALB_SG=$(aws ec2 describe-security-groups \
  --filters "Name=vpc-id,Values=${VPC_ID}" "Name=group-name,Values=*Alb*" \
  --query "SecurityGroups[0].GroupId" \
  --output text \
  --region "${AWS_REGION}")

# Get ECS security group
ECS_SG=$(aws ec2 describe-security-groups \
  --filters "Name=vpc-id,Values=${VPC_ID}" "Name=group-name,Values=*Ecs*" \
  --query "SecurityGroups[0].GroupId" \
  --output text \
  --region "${AWS_REGION}")

# Ensure ECS SG allows port 3000 from ALB SG
aws ec2 authorize-security-group-ingress \
  --group-id "${ECS_SG}" \
  --protocol tcp \
  --port 3000 \
  --source-group "${ALB_SG}" \
  --region "${AWS_REGION}" 2>/dev/null || echo "  (SG rule for port 3000 may already exist)"

aws ecs create-service \
  --cluster "${CLUSTER}" \
  --service-name "${SERVICE_NAME}" \
  --task-definition "${TASK_FAMILY}" \
  --desired-count 1 \
  --launch-type FARGATE \
  --deployment-configuration "deploymentCircuitBreaker={enable=true,rollback=true},maximumPercent=200,minimumHealthyPercent=100" \
  --network-configuration "awsvpcConfiguration={subnets=[${SUBNET_IDS}],securityGroups=[${ECS_SG}],assignPublicIp=DISABLED}" \
  --load-balancers "targetGroupArn=${TG_ARN},containerName=showcase,containerPort=3000" \
  --region "${AWS_REGION}" > /dev/null 2>/dev/null || echo "  (service may already exist — use update-service instead)"

echo "ECS service: ${SERVICE_NAME} ✓"

# ---------- 7. Summary ----------
ALB_DNS=$(aws elbv2 describe-load-balancers \
  --load-balancer-arns "${ALB_ARN}" \
  --query "LoadBalancers[0].DNSName" \
  --output text \
  --region "${AWS_REGION}")

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Next steps:"
echo "  1. Build and push the showcase Docker image"
echo "  2. Create Route53 ALIAS record:"
echo "     suwappu.bot → ${ALB_DNS}"
echo "  3. Push to main branch (or trigger workflow manually) to deploy"
echo ""
echo "Verify with:"
echo "  aws ecs describe-services --cluster ${CLUSTER} --services ${SERVICE_NAME} --region ${AWS_REGION}"
