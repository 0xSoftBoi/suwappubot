# Production Site Replacement Audit

Date: 2026-05-15
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
  - AWS CodeBuild project `suwappu-showcase-build` exists and uses source `https://github.com/0xSoftBoi/suwappubot.git` with buildspec `showcase/buildspec.yml`, but it has no webhook configured.
  - AWS ECS service `suwappu-showcase` is active in cluster `suwappu-cluster`, desired `1`, running `1`, task definition `suwappu-showcase:1`.
  - The service runs `905418423235.dkr.ecr.us-east-1.amazonaws.com/suwappu-showcase:latest`.
  - Production release image was pushed on `2026-05-14T19:50:57-04:00` with commit tag `2a65430fdb8e4a9ba4872f996c60410b68c7adfc`, digest `sha256:1423b4a74baad7d6237684c0d2ccd6aa20517429fc1b46b2ef0b71b0eb561669`.
- Terminal evidence points at `terminal/`.
  - `terminal/Dockerfile` builds the Vite app with Bun and serves `dist/` through nginx.
  - `terminal/buildspec.yml` builds `terminal/Dockerfile`, pushes the image, then forces an ECS redeploy.
  - AWS CodeBuild project `suwappu-terminal-build` exists and uses source `https://github.com/0xSoftBoi/suwappubot.git` with buildspec `terminal/buildspec.yml`, but it has no webhook configured.
  - AWS ECS service `suwappu-terminal-prod` is active in cluster `suwappu-cluster`, desired `1`, running `1`, task definition `suwappu-terminal-prod:2`.
  - The service runs `905418423235.dkr.ecr.us-east-1.amazonaws.com/suwappu-terminal:latest`.
  - Current running terminal task `9718cefda7454f448e5a9982b859cdb4` is healthy on digest `sha256:60da3f275244f5cf31150bcb5589da98e50c8b1d5aef1aca17ead679d806823f`.
  - `terminal/TERMINAL.md` maps terminal deploy to ECR repository `suwappu-terminal` and host rule `terminal.suwappu.bot`.
- API evidence points at the Python app behind `https://api.suwappu.bot`.
  - ALB routes general API traffic to ECS service `suwappu-bot-prod` in cluster `suwappu-cluster`.
  - The service runs `905418423235.dkr.ecr.us-east-1.amazonaws.com/suwappu:latest`.
  - Production API task definition is `suwappu-bot-prod:15`.
  - Running task `af7f35f32511475abb95682fabbb3a93` is healthy on digest `sha256:1da7fafb7e2550df9ae629677fbb7aeb900d2edbb0869759e09936609e147723`.
  - The API image overlay must include `api/main.py`, `api/webapp.py`, `api/routes/terminal.py`, and `bot/services/swap_engine.py`; otherwise prod can expose the terminal routes while retaining an older swap executor.
  - `suwappu-bot-prod:15` includes Turnkey runtime secrets and `OAUTH_REDIRECT_BASE=https://suwappu.bot`.

## Deployment Discovery

- Production did not auto-deploy from GitHub `main` during discovery.
  - Both CodeBuild projects have `webhook: null`.
  - The repo had no `.github/workflows/` deployment workflow.
  - GitHub listed only Codespaces, Dependabot, and a stale/debug workflow as active for `0xSoftBoi/suwappubot`.
  - Pushing `main` does not move ECS or ECR by itself.
- A controlled manual GitHub Actions deploy path has been restored.
  - `.github/workflows/deploy-frontend.yml` supports `workflow_dispatch` for `showcase`, `terminal`, or `all`.
  - The workflow uses `AWS_ROLE_ARN`, builds linux/amd64 Docker images, pushes commit SHA and `latest` tags to ECR, forces ECS redeploy, waits for service stability, and verifies the live endpoint.
  - It intentionally does not run on every push, to avoid recreating the previous CI cost/billing problem.
- Live ingress is still ALB to ECS/Fargate for the frontend domains.
  - ALB listener rule priority `28` routes `suwappu.bot` to target group `suwappu-showcase`.
  - ALB listener rule priority `30` routes `www.suwappu.bot` to target group `suwappu-showcase`.
  - ALB listener rule priority `25` routes `terminal.suwappu.bot` to target group `suwappu-terminal-prod`.
  - `suwappu-showcase` target group has healthy target `10.0.2.61:3000`, which matches running ECS Fargate task `eff26e8054bd40079227dca90a175eb3`.
  - `suwappu-terminal-prod` target group has healthy target `10.0.2.159:80`, which matches running ECS Fargate task `56ea038c13a345e3a68f83e4032c5843`.
- CodeBuild was used historically.
  - CloudTrail shows `suwappu-codebuild-role` pushed ECR images and ran `ecs:UpdateService` for `suwappu-showcase` on `2026-04-01T10:41:04Z`.
  - CloudTrail shows `suwappu-codebuild-role` pushed ECR images and ran `ecs:UpdateService` for `suwappu-terminal-prod` on `2026-03-31T15:08:40Z`.
  - Latest successful builds were `suwappu-showcase-build:3afd0a0e-b686-485a-bc7f-d093d8e5f1bd` and `suwappu-terminal-build:94b143f1-c63b-41cf-b8e3-69ae06aa5cab`.
- Historical "direct" deploy evidence applies to the Telegram bot/EC2 path, not the live frontend domains.
  - Commit history includes `scripts/deploy.sh` for EC2 SSH deploys to `/home/ubuntu/suwappubot`.
  - The current prod EC2 instance `i-087a3657720f6f450` exists for the bot, but `suwappu.bot` and `terminal.suwappu.bot` do not route to that instance.
  - Historical `deploy-showcase.yml` and `deploy-terminal.yml` still built Docker images, pushed ECR, and updated ECS.
- No active non-ECR frontend host was found in the current AWS account.
  - Amplify apps: none.
  - App Runner services: none.
  - Elastic Beanstalk apps: none.
  - CloudFront distributions: none.
  - CodePipeline pipelines: none.
  - Route 53 hosted zone for `suwappu.bot`: none found in this account.
  - S3 buckets matching Suwappu are operational buckets (`suwappu-codebuild-source-905418423235`, `suwappu-db-backups`, `suwappu-internal-ops`), not static frontend hosting buckets.
- Manual CodeBuild is not currently usable as the reliable deploy lever.
  - `aws codebuild start-build` returned `AccountLimitExceededException: Cannot have more than 0 builds in queue for the account`.
- Current production release lever is ECR image push plus ECS force-new-deployment.
  - Build the image locally or in a functioning CI runner.
  - Push `:latest` and a commit SHA tag to ECR.
  - Run `aws ecs update-service --force-new-deployment` for the target service.
- If the desired future state is non-ECR/direct frontend deployment, it is a migration, not the currently active path.
  - The low-friction direct path for `showcase/` and the static terminal shell is S3 plus CloudFront/ACM, or Amplify if Git-connected deploys are preferred.
  - That migration must include DNS cutover from the ALB, replacement health checks, and Browserbase QA against the new edge URL before production cutover.

## Build Env Requirements

- `VITE_API_URL` must be `https://api.suwappu.bot`.
  - Current `terminal/Dockerfile` default: `ARG VITE_API_URL=https://api.suwappu.bot`.
  - Current `terminal/buildspec.yml`: passes `--build-arg VITE_API_URL=https://api.suwappu.bot`.
- Turnkey is the primary wallet/auth path and must stay server-side through API/runtime secrets, not Vite browser env.
- `VITE_WC_PROJECT_ID` is not required for the production terminal path.
  - RainbowKit/WalletConnect providers were removed from the production render path.
  - The visible auth entry is Turnkey/passkey copy, not external wallet connection copy.
  - AWS CodeBuild project `suwappu-terminal-build` still does not define `VITE_WC_PROJECT_ID`, which is acceptable for the Turnkey default.
- Browserbase credentials must be available for production QA:
  - `BROWSERBASE_API_KEY`
  - `BROWSERBASE_PROJECT_ID`
  - These are QA runner secrets only and must not be exposed to the browser bundle.

## Deploy Command

Preferred manual GitHub Actions deploy path:

```bash
gh workflow run "Deploy Frontend" \
  --repo 0xSoftBoi/suwappubot \
  --ref main \
  -f target=showcase
```

Use `target=terminal` for `terminal.suwappu.bot` or `target=all` for both.

Verified production deploy runs:

- Showcase: `https://github.com/0xSoftBoi/suwappubot/actions/runs/25892256968`
- Terminal: `https://github.com/0xSoftBoi/suwappubot/actions/runs/25892776905`
- Terminal branch preview/prod update: `https://github.com/0xSoftBoi/suwappubot/actions/runs/25920731998` on commit `6c69941d5e5c9c425245ba9205d532b0267ccf2f`
- Earlier terminal branch deploy: `https://github.com/0xSoftBoi/suwappubot/actions/runs/25919969631` on commit `5ab552b1d1441b950113d63b93598e5f467ee1ab`

Current manual showcase deploy path:

```bash
aws ecr get-login-password --region us-east-1 \
  | docker login --username AWS --password-stdin 905418423235.dkr.ecr.us-east-1.amazonaws.com

docker build \
  -f showcase/Dockerfile \
  -t 905418423235.dkr.ecr.us-east-1.amazonaws.com/suwappu-showcase:latest \
  ./showcase

docker push 905418423235.dkr.ecr.us-east-1.amazonaws.com/suwappu-showcase:latest

aws ecs update-service \
  --cluster suwappu-cluster \
  --service suwappu-showcase \
  --force-new-deployment \
  --region us-east-1
```

Current manual terminal deploy path:

```bash
aws ecr get-login-password --region us-east-1 \
  | docker login --username AWS --password-stdin 905418423235.dkr.ecr.us-east-1.amazonaws.com

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

Current manual API deploy path used for terminal auth/swap fixes:

```bash
aws ecr get-login-password --region us-east-1 \
  | docker login --username AWS --password-stdin 905418423235.dkr.ecr.us-east-1.amazonaws.com

docker build \
  --platform linux/amd64 \
  -f api/Dockerfile \
  -t 905418423235.dkr.ecr.us-east-1.amazonaws.com/suwappu:latest \
  .

docker push 905418423235.dkr.ecr.us-east-1.amazonaws.com/suwappu:latest

aws ecs update-service \
  --cluster suwappu-cluster \
  --service suwappu-bot-prod \
  --force-new-deployment \
  --region us-east-1
```

If CodeBuild queue limits are fixed, CodeBuild uses the same shape through `showcase/buildspec.yml` and `terminal/buildspec.yml`, with `IMAGE_URI`, `COMMIT_URI`, `ECS_CLUSTER`, `ECS_SERVICE`, and `AWS_DEFAULT_REGION` supplied by the provider.

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

Latest passing production QA:

- Homepage + terminal Browserbase session: `https://www.browserbase.com/sessions/1399265a-a698-4909-8328-867986719e81`
- Focused terminal Browserbase session: `https://www.browserbase.com/sessions/036c3f8f-ef51-4bf6-85c9-7f103276643b`
- Result: `failures: []`
- Terminal swap functional Browserbase session: `https://www.browserbase.com/sessions/e91d7b72-4f45-4647-a9aa-014e3e8ee29a`
- Swap result: Turnkey passkey auth `200`, `/auth/me` `200`, `/webapp/portfolio` `200`, `/webapp/swap/quote` `200` via `lifi`, `/webapp/swap/execute` `200 submitted` with swap id `48`.
- Swap report and screenshots: `terminal/qa-screenshots/browserbase-functional-prod/swap-functional-report.json`, `after-turnkey-auth.png`, `after-swap-functional.png`.
- Latest terminal button regression check: `https://www.browserbase.com/sessions/5a437810-5089-4a54-a86b-f27dd2a0da31`
- Result: header Turnkey button created a passkey wallet, `/auth/me` returned authenticated user `58`, `/webapp/swap/quote` returned `200`, and `/webapp/swap/execute` reached the expected insufficient-funds path for the fresh wallet.

Run the terminal swap functional gate:

```bash
cd terminal
BROWSERBASE_API_KEY=... \
BROWSERBASE_PROJECT_ID=... \
QA_TERMINAL_URL=https://terminal.suwappu.bot \
QA_API_URL=https://api.suwappu.bot \
bun run qa:browserbase:swap
```

Latest API verification:

- `https://api.suwappu.bot/health` returned `{"status":"healthy","service":"suwappu-bot","database":"connected","bot":"webhook"}`.
- `https://terminal.suwappu.bot/health` returned `{"status":"ok","service":"suwappu-terminal"}`.
- `GET /webapp/tokens/popular?chain=ethereum`, `GET /webapp/chains`, and `GET /terminal/chart/ohlcv?...` returned `200` with `access-control-allow-origin: https://terminal.suwappu.bot`.
- Browserbase swap QA confirmed no localhost API traffic and no WalletConnect/RainbowKit copy in the production terminal path.

Required checks:

- `390x900`, `430x932`, `768x1024`, `1440x900`, and `1600x1000` screenshots captured in Browserbase.
- No horizontal overflow for every viewport (`scrollWidth <= innerWidth` in Browserbase).
- Primary CTA visible in the first viewport.
- Next section hint visible in the first viewport.
- `Open Terminal` resolves to `https://terminal.suwappu.bot`.
- `Docs/API` resolves to `/docs`.
- `terminal.suwappu.bot` smoke loads terminal content.
- Any API traffic observed during the run must target `https://api.suwappu.bot`, not localhost.
