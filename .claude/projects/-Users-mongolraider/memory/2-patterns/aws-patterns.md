<!-- Created: 2026-02-16 -->
<!-- Last verified: 2026-02-16 -->
<!-- Next review: 2026-03-16 -->

# AWS Deployment Patterns

This file captures AWS CLI usage patterns, deployment workflows, and ECS/Fargate conventions.

## Common AWS CLI Patterns

### ECS Operations

```bash
# List clusters
AWS_PROFILE=Swappu aws ecs list-clusters

# List services in cluster
AWS_PROFILE=Swappu aws ecs list-services --cluster <cluster-name>

# Describe service
AWS_PROFILE=Swappu aws ecs describe-services \
  --cluster <cluster-name> \
  --services <service-name>
```

### CloudWatch Logs

```bash
# Tail logs
AWS_PROFILE=Swappu aws logs tail /ecs/<service-name> --follow
```

---

## Placeholder

*(This file will be populated as AWS patterns emerge across sessions)*
