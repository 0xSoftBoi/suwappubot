#!/usr/bin/env bash
# Enable ECS Exec on all Suwappu ECS services.
# Run once after deploying the CDK stack with SSM IAM permissions.
#
# Prerequisites:
#   - AWS CLI v2 configured with appropriate permissions
#   - Session Manager plugin installed: https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html
#
# Usage:
#   ./scripts/enable-ecs-exec.sh
#
# After running, verify with:
#   aws ecs execute-command --cluster suwappu-cluster --service <service> --task <task-id> --command "/bin/sh" --interactive

set -euo pipefail

CLUSTER="suwappu-cluster"
SERVICES=(
  suwappu-bot-prod
  suwappu-bot-dev
  suwappu-api-ts-prod
  suwappu-api-ts-dev
  suwappu-webapp-prod
  suwappu-webapp-dev
)

for SERVICE in "${SERVICES[@]}"; do
  echo "Enabling ECS Exec on ${SERVICE}..."
  aws ecs update-service \
    --cluster "${CLUSTER}" \
    --service "${SERVICE}" \
    --enable-execute-command \
    --force-new-deployment \
    --no-cli-pager 2>/dev/null \
  && echo "  ✓ ${SERVICE}" \
  || echo "  ✗ ${SERVICE} (may not exist yet)"
done

echo ""
echo "Done. New tasks will have ECS Exec enabled."
echo "Wait for services to stabilize, then test with:"
echo "  aws ecs execute-command --cluster ${CLUSTER} --service <service> --task <task-id> --command '/bin/sh' --interactive"
