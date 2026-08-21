---
description: "Deploy Suwappu services on Railway. Usage: /deploy [prod|dev] [python-api|python-worker|terminal|api-ts|showcase|all]"
---

# Suwappu Deployment Skill (Railway)

**Suwappu runs entirely on Railway — there is NO AWS/ECS/EC2 anymore.** The old
AWS-ECS Telegram Mini App was abandoned on 2026-06-08 (commit `e262711`); `app.suwappu.bot`
now mirrors the **terminal** service. Ignore any older AWS/SSM/ECS instructions.

## How deploys actually happen: auto on push to main

Railway is wired to GitHub via the `deploy-railway.yml` Action + per-service
`watchPatterns`. **Merging to `main` auto-deploys any service whose watched paths changed.**
You usually do NOT need to run anything — merge the PR and Railway rebuilds.

| Service | `railway.*.json` | Dockerfile | watchPatterns (auto-deploy trigger) |
|---|---|---|---|
| `python-api` (bot + FastAPI) | `railway.python-api.json` | `api/Dockerfile.railway` | `api/**`, `bot/**`, `database/**`, `requirements.txt` |
| `python-worker` (background tasks) | `railway.python-worker.json` | `api/Dockerfile.railway` | `api/**`, `bot/**`, `database/**`, `requirements.txt` |
| `terminal` (live Telegram Mini App — `app.suwappu.bot` + `terminal.suwappu.bot`) | `railway.terminal.json` | `terminal/Dockerfile` | `terminal/**`, `packages/design-tokens/**` |
| `api-ts` | `api-ts/railway.json` | `api-ts/Dockerfile` | (root) |
| `showcase` (`www.suwappu.bot`) | `showcase/railway.json` | `showcase/Dockerfile` | (root) |

Other services in the project: `suwappu-bridge`, `suwappu-relayer`, `Postgres`, `Redis`.
**`webapp/` is DEAD** — no Railway config, deployed nowhere. The live Mini App is `terminal/`.

Project: `suwappu` (id `428680a3-dd24-4f7c-8349-e66d791b5104`), workspace "Eric Manganaro's Projects",
env `production`. python-api service id `fed701e4-8fd9-47ec-9e1d-56bcceea1d90`.

## Manual deploy (emergency override / when you can't merge)

This machine has the `railway` CLI (no `aws`, no `docker` needed for source-upload deploys).
Deploy from a **clean `origin/main` worktree** so you never upload other sessions' uncommitted changes:

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
