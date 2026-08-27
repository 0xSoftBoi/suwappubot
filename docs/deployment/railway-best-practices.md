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

---

# Round 2 — data durability and network exposure (2026-08-26)

The first pass audited *deployment* config. This pass looks at the two things
that actually lose money or data. Both findings below are verified against the
live production project, and both outrank every item in the "Still open" list.

## 9. P0 — Point-in-Time Recovery is OFF on production Postgres

Railway Postgres supports [PITR](https://docs.railway.com/volumes/point-in-time-recovery):
`pgBackRest` archives every WAL segment to a Railway bucket, with a weekly full
plus daily incremental base backup and roughly a **4-week restore window**.

**It is not enabled here.** Enabling PITR sets `WAL_ARCHIVE_*` env vars on the
Postgres service. The live variable list is:

```
DATABASE_PUBLIC_URL, DATABASE_URL, PGDATA, PGDATABASE, PGHOST, PGPASSWORD,
PGPORT, PGUSER, POSTGRES_DB, POSTGRES_PASSWORD, POSTGRES_USER,
RAILWAY_DEPLOYMENT_DRAINING_SECONDS, SSL_CERT_DAYS
```

No `WAL_ARCHIVE_*`. No `Postgres-PITR` bucket exists in the project either.

Why this is the top item for *this* codebase specifically:

- The database holds **encrypted wallet material** (`kms_aesgcm_v2` envelope
  DEKs), user balances, referral/XP accounting, and order state. Losing a day
  of it is not a "restore from staging" situation.
- There is **no Alembic**. `database/db.py::_ensure_schema()` mutates the
  production schema **at boot, on every deploy**. The migrations are additive
  and idempotent by convention — but "by convention" is exactly what PITR
  exists to backstop. One bad `_ensure_schema()` edit runs against prod with no
  point-in-time undo.
- Postgres is **single-node** (`numReplicas: 1`, not the `postgres-ha` cluster
  the service is capable of converting to). No replica, no failover, and
  currently no PITR — the volume is the only copy.

The image is on the major tag `postgres-ssl:18`, which is what PITR requires
(a minor pin like `:18.4` breaks it). So enabling is a clean path.

**Recommendation: enable PITR.** Exact steps — either one works:

```bash
# CLI (not installed in the audit container; run from a linked checkout)
railway login && railway link          # project=suwappu, env=production
railway postgres pitr status  --service postgres    # confirm it reports OFF
railway postgres pitr enable  --service postgres
railway postgres pitr status  --service postgres    # archiver healthy?
```

Or: Railway dashboard → **Postgres** → **Backups** tab → **Enable PITR**.

It creates the bucket, sets the archive vars and redeploys once.

> **Not done by the audit.** Enabling PITR was attempted from this session and
> blocked by the environment's permission policy. It was deliberately **not**
> worked around by hand-setting `WAL_ARCHIVE_*` — Railway's flow also creates
> the backing bucket and wires its credentials, so setting the vars alone would
> produce a service that looks configured and archives nothing. This needs a
> human with dashboard or CLI access.

Expect one brief restart of the database when it redeploys — single-node
Postgres has no replica to fail over to. Worth pairing with the already-armed
CVE-2026-15741 auto-update window (§8) so it costs one restart, not two. Cost is bucket storage + egress on
zstd-compressed WAL — a few GB/day under steady write load, and the
`expire` job stabilises the bucket at ~4 weeks. Note the window starts at the
first post-enable base backup: **it is not retroactive**, so the sooner it is
on, the sooner it is useful.

## 10. P1 — Postgres is exposed to the public internet

The Postgres service has an **ACTIVE public TCP proxy**:

```
kodama.proxy.rlwy.net:13450  ->  applicationPort 5432   syncStatus: ACTIVE
```

and correspondingly publishes `DATABASE_PUBLIC_URL`. So the production
database is reachable from anywhere on the internet, with the Postgres
password as the only control — no IP allowlist, no network boundary.

Railway's own guidance is to keep service-to-service traffic on
[private networking](https://docs.railway.com/networking/tcp-proxy#tcp-with-private-networking)
via `*.railway.internal` precisely so it is not "exposed to the public
internet". The service already has a private endpoint (`privateNetworkEndpoint:
postgres`), so in-project consumers do not need the proxy.

A public proxy is legitimate for `pg_dump`/`psql` from a laptop and for the
documented one-time data migration — but it is a standing hole kept open for
occasional use.

**That dependency check has now been done, and it found one.**
`scripts/verify_auth.sh:30` reads `DATABASE_PUBLIC_URL` out of
`railway variables --service postgres` and connects SQLAlchemy straight to
production over the public proxy to look up a real user id:

```bash
DBURL=$(railway variables --service postgres --kv | grep '^DATABASE_PUBLIC_URL=' | cut -d= -f2-)
# ... sa.create_engine('$DBURL') ; SELECT id FROM users ORDER BY id LIMIT 1
```

So **deleting the proxy outright would break that script.** Revised
recommendation, in preference order:

1. **Best — move the check inside the network.** `verify_auth.sh` is an ops
   script; run it as a one-off Railway job (or against
   `postgres.railway.internal`) and it needs no public endpoint at all. Then
   delete the proxy.
2. **If it has to keep working from a laptop today** — keep the proxy, but
   treat `kodama.proxy.rlwy.net:13450` as a tracked exposure: rotate
   `POSTGRES_PASSWORD` on a schedule, and note that the script reads a
   production `users` row over the open internet every time it runs.

Do **not** simply delete the proxy without doing (1) first — the earlier draft
of this section said "remove it", and that was written before this dependency
was checked. It is recorded here so the next person does not repeat the
mistake.

> Note: a raw TCP connect from the audit container failed, but that proves
> nothing — this environment's egress goes through an HTTPS agent proxy that
> will not carry arbitrary TCP. Railway reporting the proxy `ACTIVE` is the
> authoritative signal, not that negative result.

## 11. Not verified — private networking for service-to-service calls

`api-ts` has `INTERNAL_API_URL` set, and `docs/deployment/railway.md` says it
should point at python-api's `*.railway.internal` host. **This could not be
confirmed**: the audit connection returns variable names with
`valuesRedacted: true`, so the value is not readable here.

Worth a manual look — if it points at a public `*.up.railway.app` domain
instead, every internal signing call is making a public round trip it does not
need to, and Railway lists exactly that as a cause of
[slow applications](https://docs.railway.com/deployments/troubleshooting/slow-deployments#not-using-private-networking).
The service already has `RAILWAY_PRIVATE_DOMAIN` available to use.

## Priority

| # | Item | Severity | Effort |
|---|------|----------|--------|
| 9 | Enable Postgres PITR | **P0** — data loss is unrecoverable | one click, not retroactive |
| 10 | Move `verify_auth.sh` off the public proxy, then remove it | **P1** — standing exposure | script change first, *not* a blind delete |
| 11 | Confirm `INTERNAL_API_URL` is `.railway.internal` | P2 — latency | one look |
| 1 | IaC migration (§4) | P2 — hard deadline 2026-12-01 | ~an hour with the CLI |
| 2 | Set `VITE_TURNKEY_PROXY_URL` (§7) | P3 — wrong-but-working | needs the value |
| 3 | Delete the orphaned config files (§2) | P3 — tidiness | trivial |

Ranked by what is unrecoverable if it goes wrong, not by what is quickest.
