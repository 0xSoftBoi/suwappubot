# Railway: best-practice audit + IaC migration

Audited 2026-08-26 against the live `suwappu` Railway project (`428680a3-…`,
production env) and the current Railway docs. Everything below is a *verified*
observation, not a guess — each item names how it was checked.

---

## 1. HEADLINE: Config as Code is deprecated. Hard cutoff **2026-12-01**.

Railway has deprecated `railway.json` / `railway.toml` in favour of
**Infrastructure as Code** (`.railway/railway.ts`).

> "Existing Config as Code files stop being read on **2026-12-01** (hard cutoff).
> New services cannot opt into Config as Code."
> — <https://docs.railway.com/infrastructure-as-code#iac-vs-config-as-code>

This repo ships **7** CaC files (`railway.python-api.json`,
`railway.python-worker.json`, `railway.showcase.json`, `railway.terminal.json`,
`railway.webapp.json`, `railway.monitor.json`, `railway.suwappubot.json`,
`api-ts/railway.json`). On 2026-12-01 every one of them silently stops being
read and each service falls back to whatever is set in the dashboard. Nothing
breaks loudly — deploys just quietly start using different settings.

**~3 months of runway from the audit date.** See §4 for the migration.

## 2. Verified drift: several CaC files are already dead

`get-service-config` reports `configFile` only for **showcase**
(`railway.showcase.json`). Railway auto-detects a CaC file only at the
service's Root Directory, named exactly `railway.json`/`railway.toml`;
anything else needs the service's *Config File* setting (or the
`RAILWAY_CONFIG_FILE` variable) pointed at it.

| Service | Root Dir | CaC file in repo | Actually read? | Evidence |
|---|---|---|---|---|
| python-api | `/` | `railway.python-api.json` | **No** | no `configFile`, no `RAILWAY_CONFIG_FILE` var, and no `/railway.json` exists |
| python-worker | `/` | `railway.python-worker.json` | Yes | `RAILWAY_CONFIG_FILE` set as a service variable |
| api-ts | `api-ts` | `api-ts/railway.json` | Yes | auto-detected at Root Dir |
| terminal | `/` | `railway.terminal.json` | **No** | no `configFile`, no `RAILWAY_CONFIG_FILE` |
| webapp | `/` | `railway.webapp.json` | **No** | no `configFile`; live config has **no watchPatterns at all** |
| showcase | `/` | `railway.showcase.json` | Yes | `configFile: railway.showcase.json` |
| *(none)* | — | `railway.monitor.json` | **Orphan** | no `monitor` service exists in the project |
| *(none)* | — | `railway.suwappubot.json` | **Orphan** | no `suwappubot` service exists in the project |

Consequences today, before the deprecation even lands:

- **webapp rebuilds on every single push to any file in the monorepo** — it has
  no watch patterns live, and the file that would give it some is not read.
  Pure wasted build minutes on every unrelated commit.
- **python-api and terminal** run on dashboard settings, not the committed file.
  The committed `overlapSeconds: 0` / `drainingSeconds: 30` /
  `restartPolicyType` on python-api are **not in effect**. The healthcheck and
  watch patterns happen to match, so this has been invisible.

**Fix (dashboard / variable, one-time):** set `RAILWAY_CONFIG_FILE` on
python-api → `railway.python-api.json`, terminal → `railway.terminal.json`,
webapp → `railway.webapp.json`. Or skip it and go straight to §4 — IaC makes
the whole per-service config-path problem disappear.

## 3. Verified: cross-region database traffic

Region placement from `get-service-config` (`multiRegionConfig`):

| Region | Services |
|---|---|
| `us-east4-eqdc4a` (Virginia) | **Postgres**, python-api, terminal |
| `us-west2` (California) | **api-ts**, **python-worker**, showcase, webapp |

`api-ts` and `python-worker` are the two heaviest database consumers and both
sit on the opposite coast from Postgres. Every query pays a coast-to-coast
round trip (~60–70 ms RTT) on top of query time — and Effect/Drizzle request
handlers that issue several sequential queries multiply that per request.

Railway's own guidance: choose regions by proximity, and region changes are
zero-downtime for services without a volume
(<https://docs.railway.com/deployments/regions#impact-of-region-changes>).
python-api, api-ts, python-worker, showcase and webapp have **no volume**
(only Postgres does), so moving them is a free, downtime-free change.

**Applied in this commit, as code.** `api-ts/railway.json` and
`railway.python-worker.json` now pin `multiRegionConfig` to
`us-east4-eqdc4a`, co-locating both with Postgres. Expressing the move as
config rather than a dashboard click means it lands through normal review and
is revertible with a git revert. It takes effect on the next deploy of each
service from `main`.

Note both files previously carried a top-level `numReplicas: 1` *and* now need
region placement; `numReplicas` is expressed **inside** `multiRegionConfig`, so
the top-level key was removed to avoid two sources of replica count.

## 4. Migration path off Config as Code

Do **not** hand-write `.railway/railway.ts`. IaC is *omit means delete* over the
whole project, and this project has 22 services (`signal-lab`,
`pump-onchain-ingest`, `market-data-capture`, the `*-marketdata` set, the
testnet runners, `suwappu-relayer`, `suwappu-bridge`, `Postgres`, `Redis`, …).
A hand-authored file that forgets one of them plans its deletion.

Generate it from live state instead:

```bash
railway login
railway link                       # pick project=suwappu, env=production

# 1. Import the ACTUAL current project into .railway/railway.ts
railway config pull

# 2. Confirm the import is faithful — this must print "already up to date"
railway config plan
```

`railway config plan` **refuses to run** while any service is still managed by a
`railway.json`/`railway.toml`, to prevent two sources of truth. So per service:

```bash
# Preview the generated IaC for one CaC service
railway config migrate

# Write it and clear that service's Railway Config File setting
railway config migrate --apply

# Once every service is migrated, drop the old files
railway config migrate --apply --delete-files
```

Then review and apply:

```bash
railway config plan                 # read every line; expect NO deletes
railway config apply
```

Guardrails worth knowing:

- `railway config plan` is read-only and redacts variable values (`«hidden»`).
  Use `--show-values` only for non-secret review.
- Destructive changes need `--confirm-destructive` in addition to `--yes` when
  non-interactive. **Never** pass both blind.
- Apply re-plans immediately before committing and rejects a stale plan, so a
  concurrent dashboard edit can't be silently clobbered.
- CI drift gate: `railway config plan --detailed-exit-code` exits `0` for
  no-change, `2` for pending changes.

`railway config migrate` writes a **named partial** (`export const partial =
"…"`) because CaC was per-service. Once all services live in one file, drop the
partial export — one project, one file, one apply.

DSL mapping for what this repo uses:

| `railway.json` | `.railway/railway.ts` |
|---|---|
| `build.dockerfilePath` | `source: github("0xSoftBoi/suwappubot", { rootDirectory: … })` + Dockerfile detected in-repo |
| `deploy.healthcheckPath` | `healthcheck: "/health"` |
| `deploy.healthcheckTimeout` | `healthcheckTimeout: 300` |
| `deploy.numReplicas` + region | `replicas: { "us-east4-eqdc4a": 1 }` |
| service variables | `env: { … }`, secrets as `preserve()` |
| `${{Postgres.DATABASE_URL}}` | `env: { DATABASE_URL: db.env.DATABASE_URL }` |

Secrets already in Railway must be imported as `preserve()` — the CLI cannot
read encrypted values, and a literal would overwrite them.

## 5. Healthchecks: what is and isn't true here

From <https://docs.railway.com/deployments/healthchecks>:

- The healthcheck runs **only at deploy time**, to gate the traffic switch. It
  is **not** continuous monitoring. `scripts/uptime_probe.py` +
  `docs/deployment/monitoring.md` remain the only continuous signal — do not
  read a green Railway deploy as "the service is up".
- Railway probes from the hostname `healthcheck.railway.app`. Checked: neither
  the FastAPI app nor api-ts installs a `TrustedHostMiddleware`/host allowlist,
  so nothing rejects it. If one is ever added, allowlist that hostname.
- Default healthcheck timeout is 300 s; also settable via a
  `RAILWAY_HEALTHCHECK_TIMEOUT_SEC` service variable.
- A service with a **volume attached cannot do zero-downtime deploys** — Railway
  refuses to run two deployments mounted to the same volume. Only Postgres has
  a volume here, so every app service is eligible for true zero-downtime.

Confirmed non-issues (previously suspected):

- **terminal port.** `terminal/nginx.conf` is `listen ${PORT}` and the Dockerfile
  defaults `PORT=8080`, so the healthcheck hits the right port. `docs/deployment/railway.md`
  claiming nginx "hardcodes `listen 80`, set Railway target port = 80" is **stale**
  and has been corrected.
- **showcase healthcheck.** `railway.showcase.json` uses `/robots.txt`;
  `showcase/src/app/robots.ts` generates it and the live URL returns `200`.
  The live *dashboard* value is `/`, but the config file overrides it at deploy.

## 6. Zero-downtime: applied in this commit, and what wasn't

Railway's deployment teardown knobs
(<https://docs.railway.com/config-as-code/reference>):

- `overlapSeconds` — how long the old deployment keeps serving alongside the new.
- `drainingSeconds` — SIGTERM → SIGKILL grace for the old deployment.

**Applied here** — the stateless HTTP services (`api-ts`, `showcase`,
`terminal`, `webapp`) now declare `overlapSeconds: 30` + `drainingSeconds: 30`,
plus an explicit `restartPolicyType`/`restartPolicyMaxRetries` matching live.
They serve ordinary request traffic, so overlap is exactly what it is for.

**Deliberately NOT changed** — `python-api` and `python-worker` keep
`overlapSeconds: 0`. That is not an oversight: the Telegram bot runs in
**polling** mode unless `USE_WEBHOOK=true`, and two overlapping polling
instances produce **duplicate messages to users** (see the "Polling vs Webhook"
gotcha in `CLAUDE.md`). Overlap on these two is only safe once webhook mode is
confirmed on for both. Leave the `0` and the comment in place.

Worth knowing: `RAILWAY_DEPLOYMENT_OVERLAP_SECONDS` **defaults to `0`**
(<https://docs.railway.com/variables/reference#user-provided-configuration-variables>).
So before this change *no* service here had any deploy overlap — the
zero-downtime win is real, not a no-op.

**Also wired in — the live Config File setting.** The bootstrapping problem in
§2 cannot be fixed from inside the config file itself (a file that isn't read
can't tell Railway to read it), so it was applied directly to the service:
python-api → `railway.python-api.json`, terminal → `railway.terminal.json`,
webapp → `railway.webapp.json`, via the service's Config File setting. This
does not trigger a redeploy; it applies on each service's next deployment.

**Still open — deliberately not done here:**

1. Run the IaC migration before **2026-12-01** (§1, §4). This needs an
   authenticated `railway` CLI to run `config pull` against live state; it
   cannot be hand-authored safely (omit means delete across 22 services).
2. Set `VITE_TURNKEY_PROXY_URL` on the webapp service if the Turnkey proxy is
   intended (§7) — it is a config value nobody here can invent.
3. Decide the fate of the two orphaned files, `railway.monitor.json` and
   `railway.suwappubot.json` — no matching service exists in the project. They
   are left in place rather than deleted, because a service may be intended
   later; if not, delete them so they stop reading as live config.
4. Optional build-speed win, not taken: Railway supports Dockerfile cache
   mounts (`--mount=type=cache,id=s/<service id>-<path>,target=<path>`,
   <https://docs.railway.com/builds/dockerfiles#cache-mounts>). A pip cache on
   `api/Dockerfile.railway` would cut Python build times, but that Dockerfile
   has a long history of build breakage and the id must be pinned to a single
   service id while two services share the file. Not worth the risk without a
   reason to touch it.

## 7. Bug: the `buildArgs` blocks were invalid and did nothing

`railway.webapp.json` and `railway.terminal.json` carried a `build.buildArgs`
block of the form:

```json
"buildArgs": { "VITE_TURNKEY_ORG_ID": "${{ secrets.VITE_TURNKEY_ORG_ID }}" }
```

Two independent things are wrong with it, both verified against the docs:

1. **`buildArgs` is not a Config-as-Code field.** The full list of supported keys
   (<https://docs.railway.com/config-as-code/reference>) is `builder`,
   `watchPatterns`, `buildCommand`, `dockerfilePath`, `railpackVersion`,
   `startCommand`, `preDeployCommand`, `multiRegionConfig`, `healthcheckPath`,
   `healthcheckTimeout`, `restartPolicyType`, `restartPolicyMaxRetries`,
   `cronSchedule`, `overlapSeconds`, `drainingSeconds`, and `environments`.
   There is no `buildArgs`.
2. **`secrets` is not a Railway namespace.** Railway's template syntax is
   `${{NAMESPACE.VAR}}` where the namespace is `shared` or a *service name*
   (<https://docs.railway.com/variables/reference#template-syntax>).
   `secrets.` is GitHub Actions syntax that leaked in.

Checked directly against the published schema
(`curl https://railway.com/railway.schema.json`): `build` accepts only
`builder`, `buildCommand`, `dockerfilePath`, `nixpacksConfigPath`,
`nixpacksPlan`, `nixpacksVersion`, `railpackVersion`, `watchPatterns` — no
`buildArgs`. The schema leaves `additionalProperties` unset, which in JSON
Schema means unknown keys are **ignored, not rejected**. That is why this has
sat there harmlessly instead of failing a build, and why it was invisible.

The real mechanism, which already works: Railway injects service variables into
the build, and the Dockerfile picks them up by declaring `ARG`
(<https://docs.railway.com/builds/dockerfiles#using-variables-at-build-time>).
`webapp/Dockerfile:26-35` and `terminal/Dockerfile:22-23` already do exactly
that, and the matching `VITE_*` service variables are set on both services. So
the feature was never broken — the JSON was simply inert. **Both blocks are
removed in this commit** rather than left to imply a mechanism that does not
exist.

One genuine gap this surfaced: `webapp/Dockerfile` declares
`ARG VITE_TURNKEY_PROXY_URL`, but that variable is **not** set on the webapp
service (its live vars are `VITE_API_URL`, `VITE_TURNKEY_ORG_ID`,
`VITE_TURNKEY_RP_ID`, `VITE_ALCHEMY_API_KEY`, `RAILWAY_DOCKERFILE_PATH`). It
therefore builds empty and `webapp/src/lib/turnkey-client.ts:12` falls back to
`https://api.turnkey.com` — the app talks to Turnkey directly instead of
through the proxy. Not an outage, but it is silently not the configured
behaviour. Set the variable on the webapp service if the proxy is intended.

## 8. Postgres: an armed CVE remediation

`Postgres` runs `ghcr.io/railwayapp-templates/postgres-ssl:18` at `18.4`, with
auto-updates set to `type: vuln`, `tagMode: sha`. There is an **armed
remediation notice for CVE-2026-15741 (HIGH)**, armed `2026-08-25`, inside a
weekend maintenance window (Sat 10:00–24:00, Sun 00:00–18:00). Expect a
Postgres restart in that window. This is Railway acting correctly — just don't
mistake the resulting blip for an app incident.
