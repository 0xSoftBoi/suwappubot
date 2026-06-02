# Railway deployment

Migration target: **Superposition's Railway Pro org** (off AWS). This documents how each
service is built and what it needs. The AWS Dockerfiles, `buildspec.yml`s, and GitHub
Actions are intentionally left in place for reversibility — nothing here deletes them.

There are **4 app services** + **Postgres** + **Redis**. Each app service is a separate
Railway service pointing at this one repo with its own Root Directory / Dockerfile.

## Services at a glance

Each service is configured by a committed `railway.json` (config-as-code). The build +
deploy settings (Dockerfile path, healthcheck, restart policy, replicas) live in those
files. **Two settings are NOT expressible in `railway.json` and must be set per service in
the Railway dashboard:** the **Root Directory** and the **Config-as-code path** (which file
to read). Set them as below.

| Service | Root Directory (dashboard) | Config path (dashboard) | Listens on | Notes |
|---|---|---|---|---|
| **python-api** (FastAPI + Telegram bot) | `/` (repo root) | `railway.python-api.json` | `$PORT` (CMD expands it) | New self-contained image + `requirements.txt`. The old `api/Dockerfile` needs the private ECR base — do **not** use it on Railway. |
| **api-ts** (Hono + Effect) | `api-ts` | `railway.json` (auto-detected) | `$PORT` (`Bun.serve({port: env.PORT})`) | Existing Dockerfile works as-is (public ECR base, no AWS auth). |
| **terminal** (Vite + nginx) | `/` (repo root) | `railway.terminal.json` | **80** (nginx hardcodes `listen 80`) | Build context is repo root (copies `packages/design-tokens`). Set Railway **target port = 80**. `VITE_API_URL` is baked at build time — see below. |
| **showcase** (Next.js) | `showcase` | `railway.json` (auto-detected) | `$PORT` (`next start`) | Existing Dockerfile works as-is. |

Why distinct filenames for python-api and terminal: both build from repo root (Root
Directory `/`), so they'd both auto-pick a single `/railway.json`. Giving each its own file
+ pointing the service's Config path at it keeps them separate. api-ts and showcase use
their subdirectory as Root Directory, so a plain `railway.json` there is auto-detected.
`dockerfilePath` in each file is relative to that service's Root Directory.

> Build bases use `public.ecr.aws/...` which is **publicly pullable without AWS auth**
> (originally chosen to dodge Docker Hub rate limits) — keep them; they work on Railway.

### terminal: build-time API URL
`terminal/Dockerfile` bakes `VITE_API_URL` (and optional `VITE_WC_PROJECT_ID`) at build
time via `--build-arg`. On Railway set these as **build-time variables** on the terminal
service (Railway passes service variables as build args), pointing `VITE_API_URL` at the
public python-api domain (e.g. `https://<python-api>.up.railway.app` or your custom
domain). Default in the Dockerfile is `https://api.suwappu.bot`.

## Data services

- **Postgres**: add the Railway Postgres plugin. It exposes `DATABASE_URL`. Reference it
  from python-api and api-ts as `DATABASE_URL=${{Postgres.DATABASE_URL}}`.
  - Python (`database/db.py`) uses **psycopg2** with `sslmode=require` + `connect_timeout`.
    Railway's internal `DATABASE_URL` may be plaintext on the private network; if SSL
    negotiation fails, append `?sslmode=disable` for the internal URL (the code only adds
    `sslmode=require` when no `sslmode=` is already present).
  - Schema is created/migrated at runtime by `_ensure_schema()` (Python) and
    `drizzle-kit migrate/push` in api-ts `start.sh` — no separate migration step.
  - One-time data move from the current DB: `pg_dump` the old DB → `pg_restore`/`psql`
    into Railway Postgres before first boot.
- **Redis**: add the Railway Redis plugin. Reference `REDIS_URL=${{Redis.REDIS_URL}}` on
  python-api and api-ts.

## Required environment variables

### python-api (FastAPI + bot)
Required (no default — app fails to start without them):
- `TELEGRAM_BOT_TOKEN`
- `ENCRYPTION_KEY` — 32-byte key for legacy/fallback wallet encryption.

KMS (we moved off AWS KMS to a local env-var KEK — see
`docs` / the KMS migration plan):
- `KMS_PROVIDER=local`
- `WALLET_MASTER_KEK` — generate: `python3 -c "import os,base64;print(base64.b64encode(os.urandom(32)).decode())"`
- During the one-time re-wrap migration only, also set `KMS_KEY_ID`, `KMS_REGION`,
  `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` so `scripts/rewrap_kms_to_local.py` can
  unwrap existing AWS-wrapped DEKs once. Remove the AWS vars after cutover.

Core:
- `DATABASE_URL`, `REDIS_URL`, `INTERNAL_API_KEY` (shared secret with api-ts)
- `USE_WEBHOOK` — leave `false` (polling) only if **single instance**. For >1 replica set
  `USE_WEBHOOK=true` + `WEBHOOK_URL` + `WEBHOOK_SECRET_TOKEN`.
- Turnkey (primary key custody): `WALLET_PROVIDER=turnkey`, `TURNKEY_ORGANIZATION_ID`,
  `TURNKEY_API_PUBLIC_KEY`, `TURNKEY_API_PRIVATE_KEY`.
- RPC/keys as used: `INFURA_API_KEY`, `ALCHEMY_API_KEY`, fee collector addrs, OAuth, etc.
  (see `bot/config/settings.py` for the full field list — pydantic, case-insensitive).

### api-ts
- `DATABASE_URL` (**required** at runtime), `REDIS_URL`
- `INTERNAL_API_KEY` (must match python-api), `INTERNAL_API_URL` → python-api internal URL
  (Railway private networking: `http://python-api.railway.internal:$PORT`)
- `TURNKEY_API_PUBLIC_KEY`, `TURNKEY_API_PRIVATE_KEY`, `TURNKEY_ORGANIZATION_ID`
- `NODE_ENV=production` (selects `drizzle-kit migrate` over `push` in `start.sh`)
- `ALLOWED_ORIGINS` (CORS — include the terminal + showcase domains), `JWT_SECRET`,
  `FEE_WALLET_EVM`, `FEE_WALLET_SOLANA`, `POLYMARKET_CREDENTIAL_KEY` as needed.

### terminal (build-time)
- `VITE_API_URL` (build arg), `VITE_WC_PROJECT_ID` (build arg, optional).

### showcase
- Typically none beyond defaults; `PORT` is provided by Railway.

## Inter-service networking
Use Railway **private networking** for service-to-service calls (api-ts → python-api
`/internal/*` fallback signing). Set `INTERNAL_API_URL` to the python-api
`*.railway.internal` host so traffic stays on the private network and isn't exposed
publicly.

## Python image notes (`api/Dockerfile.railway`)
- Multi-stage: builder (with `build-essential`/`libpq-dev`) installs into `/opt/venv`;
  runtime is `python:3.9-slim-bookworm`, non-root (`botuser`), copies only `api/ bot/
  database/` + the venv.
- **Python 3.9 is pinned deliberately** — `requirements.txt` pins were resolved against
  3.9, and `py-clob-client` requires Python ≥3.9.10 (satisfied by slim-bookworm's 3.9.18+;
  it will NOT resolve on an older 3.9.x).
- `requirements.txt` is a **reconstruction** (the real list lived only in the ECR base
  image). The first `docker build` is the validation step. If the pip resolver conflicts
  on a pinned line, relax that one line and rebuild. Packages added beyond the local venv
  freeze are commented inline in `requirements.txt`.
- `boto3` is **not** in the runtime image (it conflicts with the pinned `urllib3` and is
  only needed by the one-time migration). The re-wrap job installs it via
  `scripts/requirements-migrate.txt`. To switch back to AWS KMS at runtime later, add
  `boto3` to `requirements.txt` and relax the `urllib3` pin so botocore can resolve.
- `google-cloud-kms` is commented out; uncomment only if switching to GCP KMS.

## CI/CD — GitHub Action

`.github/workflows/deploy-railway.yml` deploys on push to `main` (→ production) and `dev`
(→ development), and via manual `workflow_dispatch` (pick service + environment). It only
deploys services whose files changed (same path scoping as the `watchPatterns`); a manual
run can target one service or `all`.

**One-time setup:**
1. In Railway, create a **project token** per environment (Project → Settings → Tokens),
   one scoped to the production environment and one to development.
2. In GitHub, create two **Environments** (repo → Settings → Environments):
   `production` and `development`. In each, add a secret named **`RAILWAY_TOKEN`** set to
   that environment's project token. (Environment-scoped secrets keep prod and dev tokens
   separate while the workflow references a single `RAILWAY_TOKEN` name.)
3. Ensure the Railway **service names** match the workflow's matrix values exactly:
   `python-api`, `api-ts`, `terminal`, `showcase` (rename in Railway or in the workflow).

The token is environment-scoped, so `railway up --ci --service <name>` deploys to the
right environment with no `--environment` flag. `railway up` honors each service's Root
Directory + `railway.json`, so it runs from the repo root for every service.

> The old AWS workflows (`deploy-api.yml`, `deploy-frontend.yml`) are `workflow_dispatch`
> only — they never auto-run, so they don't conflict. Left in place for reversibility.

## Provisioned this session (CLI)

Workspace **Eric Manganaro's Projects** (= Superposition), project **suwappu**
(`428680a3-dd24-4f7c-8349-e66d791b5104`), environment **production**:
- Services created: **Postgres**, **Redis**, **python-api**, **api-ts**, **terminal**,
  **showcase** (the four app services are empty — no source connected yet, so nothing
  has built).
- Variables set:
  - python-api: `KMS_PROVIDER=local`, `WALLET_MASTER_KEK` (minted), `INTERNAL_API_KEY`
    (minted), `WALLET_PROVIDER=turnkey`, `USE_WEBHOOK=false`, `PORT=8000`,
    `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `REDIS_URL=${{Redis.REDIS_URL}}`.
  - api-ts: `NODE_ENV=production`, `INTERNAL_API_KEY` (same minted value),
    `INTERNAL_API_URL=http://python-api.railway.internal:8000`,
    `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `REDIS_URL=${{Redis.REDIS_URL}}`.

> **Back up `WALLET_MASTER_KEK` now.** It was generated and written only to Railway
> (python-api → Variables) — never printed. Copy it to a password manager. After the
> re-wrap migration runs, losing this key = unrecoverable local-KMS wallets. The same
> value must be available to the migration job.

### Remaining manual steps (dashboard-only — CLI/API can't do these)

1. **Per service: Root Directory + Config-as-code path** (Service → Settings):
   | Service | Root Directory | Config-as-code path (absolute) |
   |---|---|---|
   | python-api | `/` | `/railway.python-api.json` |
   | api-ts | `api-ts` | `/api-ts/railway.json` |
   | terminal | `/` | `/railway.terminal.json` |
   | showcase | `showcase` | `/showcase/railway.json` |
   (Config path does **not** follow Root Directory — give the absolute repo path.)
2. **Source**: connect the GitHub repo `0xSoftBoi/suwappubot` to each service (Settings →
   Source), or deploy via the GitHub Action / `railway up`. If you use native GitHub
   deploys, the `deploy-railway.yml` Action is redundant (pick one to avoid double builds).
3. **terminal**: set **target port = 80** (Settings → Networking) and the build variable
   `VITE_API_URL` = python-api's public URL.
4. **Paste the external secrets** you hold (Variables):
   - python-api: `TELEGRAM_BOT_TOKEN`, **`ENCRYPTION_KEY` (MUST equal the current prod
     value or legacy wallets won't decrypt)**, `TURNKEY_ORGANIZATION_ID`,
     `TURNKEY_API_PUBLIC_KEY`, `TURNKEY_API_PRIVATE_KEY`, `INFURA_API_KEY`,
     `ALCHEMY_API_KEY`, fee/OAuth vars as used.
   - api-ts: `TURNKEY_API_PUBLIC_KEY`, `TURNKEY_API_PRIVATE_KEY`, `TURNKEY_ORGANIZATION_ID`,
     `JWT_SECRET`, `FEE_WALLET_EVM`, `FEE_WALLET_SOLANA`, `POLYMARKET_CREDENTIAL_KEY`,
     `ALLOWED_ORIGINS` (terminal + showcase domains).
5. **Generate public domains** (Settings → Networking → Generate Domain) for python-api,
   api-ts, terminal, showcase; then set `VITE_API_URL` and `ALLOWED_ORIGINS` accordingly.
6. **Data**: the Railway Postgres is empty. To carry over users/wallets, `pg_dump` the
   current DB → restore into Railway Postgres, then run the KMS re-wrap (next section)
   **before** the app serves traffic — its v2 wallets are AWS-wrapped and won't decrypt
   under `KMS_PROVIDER=local` until re-wrapped. Starting fresh (no restore) needs no
   migration.

## Cutover order
1. Provision Postgres + Redis; restore data into Postgres.
2. Deploy **python-api** (KMS still `aws` if you have not run the re-wrap yet — see the
   KMS plan; otherwise `local`). Verify `/health`.
3. Run `scripts/rewrap_kms_to_local.py --dry-run --table all` then `--commit`, flip
   `KMS_PROVIDER=local`, redeploy, drop AWS vars.
4. Deploy **api-ts**; point `INTERNAL_API_URL` at python-api's internal host. Verify `/health`.
5. Build/deploy **terminal** with `VITE_API_URL` → python-api public domain (target port 80).
6. Deploy **showcase**.
7. Point custom domains; update `ALLOWED_ORIGINS` and Telegram webhook (if `USE_WEBHOOK=true`).
