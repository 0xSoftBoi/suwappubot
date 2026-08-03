---
description: "Deploy Suwappu services on Railway. Usage: /deploy [prod|dev] [python-api|python-worker|terminal|api-ts|showcase|all]"
---

# Suwappu Deployment Skill (Railway)

**Suwappu runs entirely on Railway — there is NO AWS/ECS/EC2 anymore.** The old
AWS-ECS Telegram Mini App was abandoned on 2026-06-08 (commit `e262711`). Ignore
any older AWS/SSM/ECS instructions.

## How deploys actually happen (verified 2026-08-03)

**Native Railway GitHub integration** (NOT the `deploy-railway.yml` Action — that
workflow is disabled pending a `RAILWAY_TOKEN` secret) auto-deploys **python-api,
api-ts, terminal, showcase** on every push to `main`. For those four, merging the
PR IS the deploy.

**python-worker and webapp have NO auto-deploy** — every deploy is a manual
`railway up`. They silently fall behind main otherwise (worker ran 3-day-old code
in Aug 2026; webapp ran 9-day-old code with a broken build nobody had noticed).
After a worker deploy, verify `worker_fingerprint` on
`https://python-api-production-8526.up.railway.app/health/ready` matches the
expected hash (`scripts/verify_deploy.sh`); `checks.worker_code_matches_api:
false` there means the worker is on a different build than python-api.

| Service | `railway.*.json` | Dockerfile | Auto-deploy? |
|---|---|---|---|
| `python-api` (bot + FastAPI) | `railway.python-api.json` | `api/Dockerfile.railway` | yes — push to main |
| `python-worker` (background tasks) | `railway.python-worker.json` | `api/Dockerfile.railway` | **NO — manual only** |
| `terminal` (trading terminal — `terminal.suwappu.bot`) | `railway.terminal.json` | `terminal/Dockerfile` | yes — push to main |
| `api-ts` | `api-ts/railway.json` | `api-ts/Dockerfile` | yes — push to main |
| `showcase` (`suwappu.bot` + `www`) | `showcase/railway.json` | `showcase/Dockerfile` | yes — push to main |
| `webapp` (Telegram Mini App — `app.suwappu.bot`) | `railway.webapp.json` | `webapp/Dockerfile` | **NO — manual only** |

Other services in the project: `suwappu-bridge`, `suwappu-relayer`, `Postgres`, `Redis`.
(`webapp` was once dead but was revived as its own Railway service in Jul 2026 —
`app.suwappu.bot` serves **webapp**, not terminal.)

Project: `suwappu` (id `428680a3-dd24-4f7c-8349-e66d791b5104`), workspace "Eric Manganaro's Projects",
env `production`. python-api service id `fed701e4-8fd9-47ec-9e1d-56bcceea1d90`.

## Manual deploy (emergency override / when you can't merge)

This machine has the `railway` CLI (no `aws`, no `docker` needed for source-upload deploys).
Deploy from a **FRESHLY-CREATED `origin/main` worktree** — two reasons, both hit in prod:
(1) `railway up` uploads the working directory, so a shared tree ships other sessions'
uncommitted changes; (2) **re-running `railway up` from the SAME directory can upload a
STALE snapshot** (verified 2026-08-03: two deploys shipped 30-min-old content, silently
omitting fresh commits, while reporting SUCCESS). Create the worktree, deploy once,
remove it. Always verify the fingerprint actually changed afterward:

```bash
cd /home/mongolraider/suwappu
git fetch origin main
WT=/home/mongolraider/suwappu-wt-deploy
git worktree remove "$WT" --force 2>/dev/null || true
git worktree add --detach "$WT" origin/main
cd "$WT"
# Link this fresh worktree to the project/service (non-interactive):
railway link -p 428680a3-dd24-4f7c-8349-e66d791b5104 -e production -s <SERVICE>
railway up --service <SERVICE> --detach     # uploads source, builds server-side
```
`<SERVICE>` = `python-api` | `python-worker` | `terminal` | `api-ts` | `showcase`.

## Verify

```bash
# python-api (bot + API): health + clean boot + migrations
curl -s -o /dev/null -w "health=%{http_code}\n" https://api.suwappu.bot/health   # expect 200
timeout 35 railway logs --service python-api 2>&1 | tail -120 | \
  grep -iE "schema migrations complete|Application startup complete|ImportError|ModuleNotFound|cannot import|Traceback" | tail -6
# A NEW endpoint should return its real status (e.g. 401 for auth-gated), NOT 404 — proves the new build is live:
curl -s -o /dev/null -w "%{http_code}\n" https://api.suwappu.bot/<new-endpoint>

# terminal (Mini App): both hostnames serve the terminal build
curl -s https://app.suwappu.bot/ | grep -oiE "<title>[^<]*</title>"       # expect "Suwappu Terminal"
curl -s -o /dev/null -w "%{http_code}\n" https://terminal.suwappu.bot/

# api-ts / showcase
curl -s -o /dev/null -w "%{http_code}\n" https://api-ts-production.up.railway.app/health
curl -s -o /dev/null -w "%{http_code}\n" https://www.suwappu.bot/
```

## Health / endpoints reference

| Service | URL |
|---|---|
| python-api | https://api.suwappu.bot/health · https://python-api-production-8526.up.railway.app |
| terminal (Mini App) | https://app.suwappu.bot · https://terminal.suwappu.bot |
| api-ts | https://api-ts-production.up.railway.app/health |
| showcase | https://www.suwappu.bot |
| suwappu-bridge | https://suwappu-bridge-production.up.railway.app |

## Notes / gotchas

- **CI green ≠ bot boots.** After a python-api deploy, always confirm `schema migrations complete` + `Application startup complete` and zero `ImportError` in logs (see the standing rule in CLAUDE.md).
- Multiple Claude sessions share this working tree — deploy from a **detached `origin/main` worktree**, never `railway up` from the shared tree (it would upload other sessions' uncommitted changes).
- `railway status` / `railway logs` / `railway up` need the worktree linked first (`railway link -p … -e production -s …`).
- `numReplicas: 1` on python-api → single instance; the bot polls Telegram, so do not scale replicas without switching to webhook mode (see CLAUDE.md "Polling vs Webhook").
