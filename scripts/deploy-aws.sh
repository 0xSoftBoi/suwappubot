#!/bin/bash
# AWS Deployment Script for Suwappu
# Usage: ./scripts/deploy-aws.sh [command]
# Commands: setup, deploy, push, update, logs, status

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
AWS_REGION="${AWS_REGION:-us-east-1}"
ECR_REPOSITORY="suwappu"
ECS_CLUSTER="suwappu-cluster"
ECS_SERVICE="suwappu-bot-prod"

# Get AWS account ID
get_account_id() {
    aws sts get-caller-identity --query Account --output text
}

# Setup CDK (first time)
setup() {
    echo -e "${YELLOW}Setting up CDK infrastructure...${NC}"
    
    cd infra
    
    # Install dependencies
    echo "Installing dependencies..."
    npm install
    
    # Bootstrap CDK
    ACCOUNT_ID=$(get_account_id)
    echo "Bootstrapping CDK for account $ACCOUNT_ID in $AWS_REGION..."
    npx cdk bootstrap aws://$ACCOUNT_ID/$AWS_REGION
    
    # Deploy infrastructure
    echo "Deploying infrastructure..."
    npx cdk deploy --all --require-approval never
    
    echo -e "${GREEN}Infrastructure deployed successfully!${NC}"
    echo ""
    echo "Next steps:"
    echo "1. Update secrets in AWS Secrets Manager"
    echo "2. Build and push Docker image: ./scripts/deploy-aws.sh push"
    echo "3. Update ECS service: ./scripts/deploy-aws.sh update"
}

# Deploy CDK changes
deploy() {
    echo -e "${YELLOW}Deploying CDK changes...${NC}"
    cd infra
    npx cdk deploy --all --require-approval never
    echo -e "${GREEN}Deployment complete!${NC}"
}

# Build and push Docker image
push() {
    echo -e "${YELLOW}Building and pushing Docker image...${NC}"
    
    ACCOUNT_ID=$(get_account_id)
    ECR_URI="$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPOSITORY"
    
    # Login to ECR
    echo "Logging in to ECR..."
    aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com
    
    # Build image
    echo "Building Docker image..."
    docker build -t $ECR_REPOSITORY:latest .
    
    # Tag and push
    echo "Pushing to ECR..."
    docker tag $ECR_REPOSITORY:latest $ECR_URI:latest
    docker tag $ECR_REPOSITORY:latest $ECR_URI:$(git rev-parse --short HEAD)
    docker push $ECR_URI:latest
    docker push $ECR_URI:$(git rev-parse --short HEAD)
    
    echo -e "${GREEN}Image pushed successfully!${NC}"
    echo "Image URI: $ECR_URI:latest"
}

# Update ECS service
update() {
    echo -e "${YELLOW}Updating ECS service...${NC}"
    
    aws ecs update-service \
        --cluster $ECS_CLUSTER \
        --service $ECS_SERVICE \
        --force-new-deployment \
        --region $AWS_REGION
    
    echo "Waiting for service to stabilize..."
    aws ecs wait services-stable \
        --cluster $ECS_CLUSTER \
        --services $ECS_SERVICE \
        --region $AWS_REGION
    
    echo -e "${GREEN}Service updated successfully!${NC}"
}

# View logs
logs() {
    echo -e "${YELLOW}Streaming CloudWatch logs...${NC}"
    aws logs tail /ecs/suwappu --follow --region $AWS_REGION
}

# Check service status
status() {
    echo -e "${YELLOW}Checking service status...${NC}"
    
    aws ecs describe-services \
        --cluster $ECS_CLUSTER \
        --services $ECS_SERVICE \
        --region $AWS_REGION \
        --query 'services[0].{Status:status,Running:runningCount,Desired:desiredCount,Pending:pendingCount}' \
        --output table
    
    echo ""
    echo "Load Balancer URL:"
    aws cloudformation describe-stacks \
        --stack-name SuwappuStack \
        --query 'Stacks[0].Outputs[?OutputKey==`LoadBalancerDns`].OutputValue' \
        --output text \
        --region $AWS_REGION
}

# Show help
help() {
    echo "Suwappu AWS Deployment Script"
    echo ""
    echo "Usage: ./scripts/deploy-aws.sh [command]"
    echo ""
    echo "Commands:"
    echo "  setup   - Initial setup: install deps, bootstrap CDK, deploy infrastructure"
    echo "  deploy  - Deploy CDK infrastructure changes"
    echo "  push    - Build and push Docker image to ECR"
    echo "  update  - Force ECS service to pull latest image"
    echo "  logs    - Stream CloudWatch logs"
    echo "  status  - Check ECS service status"
    echo "  help    - Show this help message"
}

# Main
case "${1:-help}" in
    setup)
        setup
        ;;
    deploy)
        deploy
        ;;
    push)
        push
        ;;
    update)
        update
        ;;
    logs)
        logs
        ;;
    status)
        status
        ;;
    help|*)
        help
        ;;
esac
