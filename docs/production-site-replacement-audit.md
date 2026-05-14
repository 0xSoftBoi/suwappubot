# Production Site Replacement Audit

Date: 2026-05-13
Branch: `feat/terminal-site-replacement-story`

## Current Production Targets

- `suwappu.bot` resolves to the shared AWS ALB addresses `52.0.228.199` and `44.195.251.102`.
- `terminal.suwappu.bot` is a CNAME to `suwappu-alb-1189665712.us-east-1.elb.amazonaws.com`, which resolves to the same ALB addresses.
- `https://suwappu.bot` currently responds as the Next.js showcase app.
- `https://terminal.suwappu.bot/health` responds from nginx with `{"status":"ok","service":"suwappu-terminal"}`.
- AWS verification uses the default AWS CLI profile, which is configured for account `905418423235` in `us-east-1`.

## Repo Deploy Evidence

- Root marketing/docs site evidence points at `showcase/`.
  - `showcase/package.json` names the app `suwappu-showcase`.
  - `showcase/buildspec.yml` builds and pushes the showcase Docker image, then forces an ECS redeploy.
  - AWS CodeBuild project `suwappu-showcase-build` uses source `https://github.com/0xSoftBoi/suwappubot.git` and buildspec `showcase/buildspec.yml`.
  - AWS ECS service `suwappu-showcase` is active in cluster `suwappu-cluster`.
- Terminal evidence points at `terminal/`.
  - `terminal/Dockerfile` builds the Vite app with Bun and serves `dist/` through nginx.
  - `terminal/buildspec.yml` builds `terminal/Dockerfile`, pushes the image, then forces an ECS redeploy.
  - AWS CodeBuild project `suwappu-terminal-build` uses source `https://github.com/0xSoftBoi/suwappubot.git`, source version `main`, and buildspec `terminal/buildspec.yml`.
  - AWS ECS service `suwappu-terminal-prod` is active in cluster `suwappu-cluster`, desired `1`, running `1`, task definition `suwappu-terminal-prod:2`.
  - `terminal/TERMINAL.md` maps terminal deploy to ECR repository `suwappu-terminal` and host rule `terminal.suwappu.bot`.

## Build Env Requirements

- `VITE_API_URL` must be `https://api.suwappu.bot`.
  - Current `terminal/Dockerfile` default: `ARG VITE_API_URL=https://api.suwappu.bot`.
  - Current `terminal/buildspec.yml`: passes `--build-arg VITE_API_URL=https://api.suwappu.bot`.
- Turnkey is the primary wallet/auth path and must stay server-side through API/runtime secrets, not Vite browser env.
- `VITE_WC_PROJECT_ID` is optional external-wallet support for RainbowKit/WalletConnect.
  - `terminal/Dockerfile` now accepts `ARG VITE_WC_PROJECT_ID` and exports it for Vite.
  - `terminal/buildspec.yml` now passes `--build-arg VITE_WC_PROJECT_ID=$VITE_WC_PROJECT_ID`.
  - `terminal/buildspec.yml` does not block deploy when `VITE_WC_PROJECT_ID` is empty because Turnkey is the production-default wallet path.
  - AWS CodeBuild project `suwappu-terminal-build` currently does not define `VITE_WC_PROJECT_ID`.
  - AWS SSM Parameter Store has no matching `WC`, `Wallet`, `VITE`, or `suwappu` parameter.
  - AWS Secrets Manager has Suwappu shared secrets, but their JSON keys do not include a matching `WC`, `Wallet`, `VITE`, `PROJECT`, or `TERMINAL` key.
  - Current ECS task definition `suwappu-terminal-prod:2` has no runtime environment variables or secrets; this is expected for Vite because the value must exist at build time.
  - Current production terminal bundle contains the fallback `projectId:"demo"`, not a real WalletConnect project id.
- Browserbase credentials must be available for production QA:
  - `BROWSERBASE_API_KEY`
  - `BROWSERBASE_PROJECT_ID`
  - These are QA runner secrets only and must not be exposed to the browser bundle.

## Deploy Command

The repo-documented manual terminal deploy path is:

```bash
docker build \
  -f terminal/Dockerfile \
  --build-arg VITE_API_URL=https://api.suwappu.bot \
  --build-arg VITE_WC_PROJECT_ID="${VITE_WC_PROJECT_ID:-}" \
  -t 905418423235.dkr.ecr.us-east-1.amazonaws.com/suwappu-terminal:latest \
  .

docker push 905418423235.dkr.ecr.us-east-1.amazonaws.com/suwappu-terminal:latest

aws ecs update-service \
  --cluster suwappu-cluster \
  --service suwappu-terminal-prod \
  --force-new-deployment \
  --region us-east-1
```

CodeBuild uses the same shape through `terminal/buildspec.yml`, with `IMAGE_URI`, `COMMIT_URI`, `ECS_CLUSTER`, `ECS_SERVICE`, and `AWS_DEFAULT_REGION` supplied by the provider.

## Browserbase Production QA Gate

Browserbase is part of the definition of done for deploy preview and production release tickets. Local Playwright screenshots are not enough by themselves.

Run against a deployed preview or production URL:

```bash
cd showcase
BROWSERBASE_API_KEY=... \
BROWSERBASE_PROJECT_ID=... \
QA_TARGET_URL=https://suwappu.bot \
QA_TERMINAL_URL=https://terminal.suwappu.bot \
bun run qa:browserbase
```

The run must attach the Browserbase session link, `report.json`, and screenshots from `showcase/qa-screenshots/browserbase-production/`.

Required checks:

- `390x900`, `430x932`, `768x1024`, `1440x900`, and `1600x1000` screenshots captured in Browserbase.
- No horizontal overflow for every viewport (`scrollWidth <= innerWidth` in Browserbase).
- Primary CTA visible in the first viewport.
- Next section hint visible in the first viewport.
- `Open Terminal` resolves to `https://terminal.suwappu.bot`.
- `Docs/API` resolves to `/docs`.
- `terminal.suwappu.bot` smoke loads terminal content.
- Any API traffic observed during the run must target `https://api.suwappu.bot`, not localhost.
