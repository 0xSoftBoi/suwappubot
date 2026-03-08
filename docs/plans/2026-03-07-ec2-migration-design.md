# EC2 Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace ECS Fargate with a single EC2 instance + systemd for faster deploys (~30s), SSH debugging, and reliable bot polling.

**Architecture:** Single EC2 instance in public subnet (for SSH) runs the bot via systemd + uvicorn. Secrets are pulled from AWS Secrets Manager at boot and written to `.env`. GitHub Actions deploys by SSH → git pull → pip install → systemctl restart. ALB routes traffic to EC2 on port 10000. Health check verifies bot is actually polling Telegram, not just returning HTTP 200.

**Tech Stack:** EC2 (t3.small), systemd, uvicorn, AWS Secrets Manager, GitHub Actions SSH, existing VPC/ALB/RDS from CDK.

---

### Task 1: Fix Health Check to Verify Bot Polling

**Files:**
- Modify: `api/main.py:467-475`

**Step 1: Update health check to report bot polling status**

Replace the health check endpoint in `api/main.py` with:

```python
@app.get("/health", tags=["Health"], summary="Service health check")
async def health_check():
    """Health check endpoint for load balancers, monitoring, and orchestration."""
    from database.db import DATABASE_AVAILABLE

    # Check if bot is actually polling
    bot_status = "unknown"
    try:
        bot_app = getattr(app.state, "bot_app", None)
        if bot_app and bot_app.updater and bot_app.updater.running:
            bot_status = "polling"
        elif bot_app:
            bot_status = "not_polling"
        else:
            bot_status = "no_bot_app"
    except Exception:
        bot_status = "error"

    is_healthy = DATABASE_AVAILABLE and bot_status == "polling"

    return JSONResponse(
        status_code=200 if is_healthy else 503,
        content={
            "status": "healthy" if is_healthy else "degraded",
            "service": "suwappu-bot",
            "database": "connected" if DATABASE_AVAILABLE else "disconnected",
            "bot": bot_status,
        },
    )
```

**Step 2: Verify it works locally (manual smoke test)**

Run: `python -c "from api.main import app; print('import ok')"`

**Step 3: Commit**

```bash
git add api/main.py
git commit -m "fix: health check verifies bot is actually polling"
```

---

### Task 2: Update systemd Service File

**Files:**
- Modify: `suwappubot.service`

**Step 1: Update service to run uvicorn (api/main.py) instead of bot.main**

```ini
[Unit]
Description=Suwappu Bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ubuntu
Group=ubuntu
WorkingDirectory=/home/ubuntu/suwappubot
EnvironmentFile=/home/ubuntu/suwappubot/.env
ExecStart=/home/ubuntu/suwappubot/venv/bin/uvicorn api.main:app --host 0.0.0.0 --port 10000
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=suwappubot

# Watchdog: systemd kills if health check fails for 90s
WatchdogSec=90
NotifyAccess=all

# Security
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

**Step 2: Commit**

```bash
git add suwappubot.service
git commit -m "feat: update systemd service for uvicorn api/main.py"
```

---

### Task 3: Create EC2 Setup Script

**Files:**
- Create: `scripts/ec2-setup.sh`

This script runs ONCE on a fresh EC2 instance to set it up. It installs dependencies, clones the repo, creates the venv, pulls secrets, and enables the systemd service.

**Step 1: Write the setup script**

```bash
#!/bin/bash
# EC2 instance setup for Suwappu Bot
# Run once on a fresh Ubuntu 22.04/24.04 EC2 instance:
#   curl -sL <raw-github-url> | sudo bash
set -euo pipefail

APP_USER="ubuntu"
APP_DIR="/home/$APP_USER/suwappubot"
REPO_URL="https://github.com/0xSoftBoi/suwappubot.git"
BRANCH="${1:-main}"
AWS_REGION="us-east-1"
SECRETS_ID="suwappu/app-secrets"
DB_SECRETS_ID="suwappu/db-credentials"

echo "=== Installing system dependencies ==="
apt-get update
apt-get install -y python3.11 python3.11-venv python3.11-dev \
  gcc g++ libpq-dev libssl-dev git curl jq

echo "=== Cloning repo ==="
if [ ! -d "$APP_DIR" ]; then
  sudo -u $APP_USER git clone "$REPO_URL" "$APP_DIR"
else
  sudo -u $APP_USER git -C "$APP_DIR" fetch origin
  sudo -u $APP_USER git -C "$APP_DIR" checkout "$BRANCH"
  sudo -u $APP_USER git -C "$APP_DIR" pull
fi

echo "=== Creating venv ==="
sudo -u $APP_USER python3.11 -m venv "$APP_DIR/venv"
sudo -u $APP_USER "$APP_DIR/venv/bin/pip" install --upgrade pip
sudo -u $APP_USER "$APP_DIR/venv/bin/pip" install -r "$APP_DIR/requirements.txt"
sudo -u $APP_USER "$APP_DIR/venv/bin/pip" install psycopg2-binary gunicorn
sudo -u $APP_USER "$APP_DIR/venv/bin/pip" install "$APP_DIR"

echo "=== Pulling secrets from AWS Secrets Manager ==="
bash "$APP_DIR/scripts/pull-secrets.sh"

echo "=== Installing systemd service ==="
cp "$APP_DIR/suwappubot.service" /etc/systemd/system/suwappubot.service
systemctl daemon-reload
systemctl enable suwappubot
systemctl start suwappubot

echo "=== Setup complete ==="
echo "Check status: systemctl status suwappubot"
echo "View logs:    journalctl -u suwappubot -f"
```

**Step 2: Commit**

```bash
git add scripts/ec2-setup.sh
git commit -m "feat: add EC2 instance setup script"
```

---

### Task 4: Create Secrets Pull Script

**Files:**
- Create: `scripts/pull-secrets.sh`

Pulls secrets from AWS Secrets Manager and writes a `.env` file. Called by setup and by deploy.

**Step 1: Write the secrets script**

```bash
#!/bin/bash
# Pull secrets from AWS Secrets Manager and write to .env
set -euo pipefail

APP_DIR="/home/ubuntu/suwappubot"
AWS_REGION="us-east-1"
ENV_FILE="$APP_DIR/.env"

echo "Pulling app secrets..."
APP_SECRETS=$(aws secretsmanager get-secret-value \
  --secret-id "suwappu/app-secrets" \
  --region "$AWS_REGION" \
  --query 'SecretString' --output text)

echo "Pulling DB credentials..."
DB_SECRETS=$(aws secretsmanager get-secret-value \
  --secret-id "suwappu/db-credentials" \
  --region "$AWS_REGION" \
  --query 'SecretString' --output text)

# Build DATABASE_URL from RDS secret
DB_HOST=$(echo "$DB_SECRETS" | jq -r '.host')
DB_PORT=$(echo "$DB_SECRETS" | jq -r '.port')
DB_USER=$(echo "$DB_SECRETS" | jq -r '.username')
DB_PASS=$(echo "$DB_SECRETS" | jq -r '.password')
DB_NAME=$(echo "$DB_SECRETS" | jq -r '.dbname // "suwappubot"')
DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}/${DB_NAME}?sslmode=require"

# Write .env
cat > "$ENV_FILE" << ENVEOF
# Auto-generated from AWS Secrets Manager — do not edit manually
# Last updated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")

DATABASE_URL=${DATABASE_URL}
ENVIRONMENT=production
PORT=10000
LOG_LEVEL=INFO
WALLET_PROVIDER=local
ENVEOF

# Append each key from app-secrets
echo "$APP_SECRETS" | jq -r 'to_entries[] | "\(.key)=\(.value)"' >> "$ENV_FILE"

chmod 600 "$ENV_FILE"
chown ubuntu:ubuntu "$ENV_FILE"
echo "Secrets written to $ENV_FILE"
```

**Step 2: Commit**

```bash
git add scripts/pull-secrets.sh
git commit -m "feat: add secrets pull script for EC2 deploys"
```

---

### Task 5: Create GitHub Actions EC2 Deploy Workflow

**Files:**
- Create: `.github/workflows/deploy-ec2.yml`

**GitHub Secrets needed:**
- `EC2_SSH_KEY` — private SSH key for the EC2 instance
- `EC2_HOST` — EC2 public IP or elastic IP
- `AWS_ROLE_ARN` — (already exists) for Secrets Manager access on the instance

**Step 1: Write the workflow**

```yaml
name: Deploy Bot to EC2

on:
  push:
    branches: [main, dev]
    paths:
      - 'bot/**'
      - 'api/**'
      - 'database/**'
      - 'scripts/**'
      - 'requirements.txt'
      - 'suwappubot.service'
      - '.github/workflows/deploy-ec2.yml'
  workflow_dispatch:
    inputs:
      environment:
        description: 'Environment to deploy'
        required: true
        default: 'development'
        type: choice
        options:
          - production
          - development

permissions:
  contents: read

jobs:
  deploy:
    name: Deploy to EC2
    runs-on: ubuntu-latest
    environment: ${{ (github.ref == 'refs/heads/main' || inputs.environment == 'production') && 'production' || 'development' }}

    steps:
      - name: Set environment
        id: env
        run: |
          if [ "${{ github.ref }}" == "refs/heads/main" ] || [ "${{ inputs.environment }}" == "production" ]; then
            echo "ENVIRONMENT=production" >> $GITHUB_OUTPUT
            echo "EC2_HOST=${{ secrets.EC2_HOST_PROD }}" >> $GITHUB_OUTPUT
            echo "BRANCH=main" >> $GITHUB_OUTPUT
          else
            echo "ENVIRONMENT=development" >> $GITHUB_OUTPUT
            echo "EC2_HOST=${{ secrets.EC2_HOST_DEV }}" >> $GITHUB_OUTPUT
            echo "BRANCH=dev" >> $GITHUB_OUTPUT
          fi

      - name: Deploy via SSH
        uses: appleboy/ssh-action@v1.2.0
        with:
          host: ${{ steps.env.outputs.EC2_HOST }}
          username: ubuntu
          key: ${{ secrets.EC2_SSH_KEY }}
          script_stop: true
          command_timeout: 5m
          script: |
            set -euo pipefail
            cd /home/ubuntu/suwappubot

            echo "=== Pulling latest code ==="
            git fetch origin
            git checkout ${{ steps.env.outputs.BRANCH }}
            git pull origin ${{ steps.env.outputs.BRANCH }}

            echo "=== Installing dependencies ==="
            ./venv/bin/pip install -r requirements.txt -q
            ./venv/bin/pip install . -q

            echo "=== Refreshing secrets ==="
            sudo bash scripts/pull-secrets.sh

            echo "=== Updating systemd service ==="
            sudo cp suwappubot.service /etc/systemd/system/suwappubot.service
            sudo systemctl daemon-reload

            echo "=== Restarting bot ==="
            sudo systemctl restart suwappubot

            echo "=== Waiting for startup ==="
            sleep 5

            echo "=== Health check ==="
            for i in 1 2 3 4 5; do
              if curl -sf http://localhost:10000/health; then
                echo ""
                echo "Deploy successful!"
                exit 0
              fi
              echo "Attempt $i: waiting..."
              sleep 5
            done

            echo "Health check failed — checking logs:"
            journalctl -u suwappubot --no-pager -n 30
            exit 1

      - name: Verify Telegram polling
        if: success()
        uses: appleboy/ssh-action@v1.2.0
        with:
          host: ${{ steps.env.outputs.EC2_HOST }}
          username: ubuntu
          key: ${{ secrets.EC2_SSH_KEY }}
          script: |
            HEALTH=$(curl -sf http://localhost:10000/health)
            BOT_STATUS=$(echo "$HEALTH" | python3 -c "import sys,json; print(json.load(sys.stdin).get('bot','unknown'))")
            echo "Bot status: $BOT_STATUS"
            if [ "$BOT_STATUS" != "polling" ]; then
              echo "WARNING: Bot is NOT polling!"
              journalctl -u suwappubot --no-pager -n 50
              exit 1
            fi
            echo "Bot is polling successfully."

      - name: Deployment summary
        if: always()
        run: |
          echo "## EC2 Deployment Summary" >> $GITHUB_STEP_SUMMARY
          echo "" >> $GITHUB_STEP_SUMMARY
          echo "| Property | Value |" >> $GITHUB_STEP_SUMMARY
          echo "|----------|-------|" >> $GITHUB_STEP_SUMMARY
          echo "| Environment | ${{ steps.env.outputs.ENVIRONMENT }} |" >> $GITHUB_STEP_SUMMARY
          echo "| Host | ${{ steps.env.outputs.EC2_HOST }} |" >> $GITHUB_STEP_SUMMARY
          echo "| Branch | ${{ steps.env.outputs.BRANCH }} |" >> $GITHUB_STEP_SUMMARY
          echo "| Commit | ${{ github.sha }} |" >> $GITHUB_STEP_SUMMARY
```

**Step 2: Commit**

```bash
git add .github/workflows/deploy-ec2.yml
git commit -m "feat: add EC2 SSH deploy workflow (replaces ECS)"
```

---

### Task 6: Add EC2 Instance to CDK Stack

**Files:**
- Modify: `infra/lib/suwappu-stack.ts`

**Step 1: Add EC2 instance, security group, and IAM role to the CDK stack**

Add after the ECS section (which can be left for reference but commented or removed later):

```typescript
// ==================== EC2 Bot Instance ====================
const botSecurityGroup = new ec2.SecurityGroup(this, 'BotSecurityGroup', {
  vpc: this.vpc,
  description: 'Security group for EC2 bot instance',
  allowAllOutbound: true,
});
botSecurityGroup.addIngressRule(
  ec2.Peer.anyIpv4(),
  ec2.Port.tcp(22),
  'SSH access'
);
botSecurityGroup.addIngressRule(
  albSecurityGroup,
  ec2.Port.tcp(10000),
  'Allow from ALB on port 10000'
);

// Allow EC2 to reach RDS
rdsSecurityGroup.addIngressRule(
  botSecurityGroup,
  ec2.Port.tcp(5432),
  'Allow PostgreSQL from EC2 bot'
);

// IAM role for EC2 (Secrets Manager + SSM)
const botRole = new iam.Role(this, 'BotInstanceRole', {
  assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
  managedPolicies: [
    iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
  ],
});
appSecrets.grantRead(botRole);
this.database.secret?.grantRead(botRole);

const botInstance = new ec2.Instance(this, 'BotInstance', {
  vpc: this.vpc,
  vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
  instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.SMALL),
  machineImage: ec2.MachineImage.fromSsmParameter(
    '/aws/service/canonical/ubuntu/server/22.04/stable/current/amd64/hvm/ebs-gp2/ami-id'
  ),
  securityGroup: botSecurityGroup,
  role: botRole,
  keyPair: ec2.KeyPair.fromKeyPairName(this, 'BotKeyPair', 'suwappu-bot-key'),
  blockDevices: [{
    deviceName: '/dev/sda1',
    volume: ec2.BlockDeviceVolume.ebs(30, { volumeType: ec2.EbsDeviceVolumeType.GP3 }),
  }],
});

// Elastic IP for stable SSH target
const eip = new ec2.CfnEIP(this, 'BotEip');
new ec2.CfnEIPAssociation(this, 'BotEipAssoc', {
  instanceId: botInstance.instanceId,
  allocationId: eip.attrAllocationId,
});

// Register with ALB
const botTargetGroup = new elbv2.ApplicationTargetGroup(this, 'BotTargetGroup', {
  vpc: this.vpc,
  port: 10000,
  protocol: elbv2.ApplicationProtocol.HTTP,
  targets: [new elbv2_targets.InstanceTarget(botInstance, 10000)],
  healthCheck: {
    path: '/health',
    interval: cdk.Duration.seconds(30),
    healthyThresholdCount: 2,
    unhealthyThresholdCount: 3,
  },
});

// Add to HTTPS listener with host-based routing
httpsListener.addTargetGroups('BotTarget', {
  targetGroups: [botTargetGroup],
  conditions: [elbv2.ListenerCondition.hostHeaders(['bot.suwappu.bot'])],
  priority: 10,
});

new cdk.CfnOutput(this, 'BotInstancePublicIp', {
  value: eip.ref,
  description: 'Bot EC2 Elastic IP (add to GitHub Secrets as EC2_HOST_PROD)',
  exportName: 'SuwappuBotIp',
});
```

**Note:** You'll need to add the import at the top of the file:
```typescript
import * as elbv2_targets from 'aws-cdk-lib/aws-elasticloadbalancingv2-targets';
```

**Step 2: Commit**

```bash
git add infra/lib/suwappu-stack.ts
git commit -m "feat: add EC2 bot instance to CDK stack"
```

---

### Task 7: Disable Old ECS Deploy Workflow

**Files:**
- Rename: `.github/workflows/deploy-bot.yml` → `.github/workflows/deploy-bot.yml.disabled`

**Step 1: Disable the old workflow**

```bash
git mv .github/workflows/deploy-bot.yml .github/workflows/deploy-bot.yml.disabled
```

**Step 2: Commit**

```bash
git add .github/workflows/
git commit -m "chore: disable ECS deploy workflow (replaced by EC2)"
```

---

### Task 8: Create Devops Skill

**Files:**
- Create: Skill file (path TBD based on skill framework location)

This is done AFTER the EC2 migration is deployed and verified working. Captures the full deploy + debug workflow so it never needs to be re-figured-out.

Content covers:
- How deploys work (SSH → git pull → pip install → restart)
- How to debug (SSH, journalctl, health check)
- How secrets work (Secrets Manager → pull-secrets.sh → .env)
- How to roll back (git checkout <sha>, restart)
- How to add new secrets
- Common failure modes and fixes

**Step 1: Write the skill (after verifying deployment works)**

**Step 2: Commit the skill**

---

## Execution Order

1. Task 1 — Fix health check (immediate value, works on both ECS and EC2)
2. Task 2 — Update systemd service
3. Task 3 — EC2 setup script
4. Task 4 — Secrets pull script
5. Task 5 — GitHub Actions EC2 deploy workflow
6. Task 6 — CDK EC2 instance (deploy infra)
7. Task 7 — Disable old ECS workflow
8. Task 8 — Create devops skill

## Manual Steps Required (between tasks)

After Task 6 (CDK deploy):
1. Create EC2 key pair in AWS Console: `suwappu-bot-key`
2. Run `cd infra && npx cdk deploy`
3. Note the Elastic IP from CDK output
4. SSH into the instance and run `scripts/ec2-setup.sh`
5. Add to GitHub Secrets: `EC2_HOST_PROD`, `EC2_SSH_KEY`
6. Test deploy workflow via workflow_dispatch
