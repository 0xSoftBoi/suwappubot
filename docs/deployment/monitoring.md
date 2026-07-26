# Monitoring & Observability

How we find out something is broken, and what each layer can and cannot see.

## The five layers

| # | Layer | What it catches | What it CANNOT catch |
|---|---|---|---|
| 1 | `/internal/railway-webhook` | deploy FAILED / CRASHED, pushed by Railway | anything after a successful deploy |
| 2 | Uptime probe (`scripts/uptime_probe.py`) ×2 schedulers | public endpoint down or degraded | services with no public URL |
| 3 | Dead-man's switch (python-api) | **the probes themselves dying** | python-api being down (layer 2 covers that) |
| 4 | `scripts/status.py` (manual) | failed deploys + crash-looping internal services + degraded subsystems | it only runs when a human runs it |
| 5 | Sentry (optional, `SENTRY_DSN`) | unhandled exceptions with stack traces | anything that doesn't raise |

Each layer exists because the one above it has a blind spot. The ordering is
deliberate — read it as "what happens if the previous layer is lying to you".

## Layer 2: the uptime probe

`scripts/uptime_probe.py` — stdlib-only, needs nothing but python3 and network.

It runs from **two independent schedulers**:

- `.github/workflows/health-check.yml` — GitHub Actions cron, every 10 min.
- `railway.monitor.json` — a Railway **cron service**, every 10 min.

Why two: on 2026-07-25 GitHub Actions billing failed and the workflow simply
stopped starting. The job never ran, so the alert step never ran, and **nothing
reported that monitoring had died**. Eight consecutive runs were dead for ~7
hours before it was noticed by accident. One provider's billing must not be able
to blind us.

The endpoint list lives in **`monitoring/endpoints.json`** — a single source of
truth both schedulers read. Previously each tool kept its own hardcoded list,
which is how `webapp` silently went unmonitored after it was deployed as its own
service. **Add a new public service there and every probe picks it up.**

Endpoints marked `"deep": true` are not judged on HTTP 200 alone — their JSON
body is parsed for per-subsystem health (db, redis, background heartbeats).

## Layer 3: the dead-man's switch

Every probe run pings `POST /internal/monitor-heartbeat` on python-api, which is
always running. This is the layer that catches "the monitor is dead" — silence is
treated as a failure signal rather than as health.

Staleness is tracked **per source**, not globally, against the list in
`MONITOR_EXPECTED_SOURCES` (default `github-actions,railway-cron`). That
distinction matters: with a global newest-wins check, GitHub Actions could die
while the Railway cron kept reporting and nothing would fire — leaving us back on
a single scheduler, which is the exact failure this feature exists to catch.

Three independent alerts, each with its own per-source cooldown:

- **Stale** — a source hasn't reported in `MONITOR_HEARTBEAT_MAX_AGE_MINUTES`
  (default 45, comfortably above the 10-minute probe interval).
- **Never reported** — an expected source has no heartbeat at all past the
  15-minute boot grace. A probe that never starts is precisely what happened.
- **Sustained failure** — a source is alive but has been reporting `ok=false`
  continuously past the threshold. "Alive and failing" must be distinguishable
  from "dead".

Recovery messages are sent per source when heartbeats resume.

The `source` value is allow-listed before it becomes a Redis key, so a token
holder cannot mint unbounded `monitor:heartbeat:*` keys.

It cannot report on itself: if python-api is down, the switch is down — but that
is exactly the case layer 2 alerts on, from outside.

**The heartbeat token is an outage-concealment credential** — anyone holding it
can post heartbeats to keep the switch quiet. Treat it accordingly; it is not a
low-sensitivity monitoring secret.

## Layer 4: `scripts/status.py`

The rich manual check. **This is the only tool that reads Railway's control
plane**, so it is the only one that sees:

- services with no public URL (`python-worker`, `suwappu-relayer`) crash-looping
- a **failed deploy where the old container keeps serving** — health stays green
  the whole time while your new code is not actually live

```bash
python3 scripts/status.py              # full check (prod)
python3 scripts/status.py --quick      # skip log scan
python3 scripts/status.py --env dev
python3 scripts/status.py --json
python3 scripts/status.py --logs api-ts --lines 300
```

Run it after every deploy. Needs the authenticated `railway` CLI, which is why
it is not the unattended monitor. See the `/status` skill for details.

## Layer 5: Sentry

Optional and **off by default** — everything is gated on `SENTRY_DSN`. Unset (local
dev, tests, CI) means no init, no latency, no behavior change.

Set `SENTRY_DSN` on the Railway service to activate:

- **Python** (`api/` + `bot/`): `bot/services/sentry_service.py`, initialized in
  `api/main.py`'s lifespan. Covers both python-api and python-worker (same image).
- **api-ts**: `api-ts/src/lib/sentry.ts`, initialized in `src/index.ts`; Hono's
  `onError` reports unhandled/5xx only — 4xx (validation, auth, 402 billing) is
  never sent, so the quota isn't flooded with non-actionable noise.

### Security — read before changing any of this

This codebase handles wallet private keys, KMS material, mnemonics and JWTs. An
exception payload is an exfiltration path, so the scrubbing is deliberately
aggressive and **fails closed** — if redaction throws, the event is dropped.

- **Deny-by-default.** The *entire* event is walked and scrubbed. An earlier
  version enumerated specific fields (`request`, `extra`, `tags`, …), which meant
  everything else in Sentry's schema shipped raw — `user`, `server_name`,
  `transaction`, `modules`, stacktrace frame `vars`. A field nobody thought of
  must be scrubbed, not exempt.
- `send_default_pii` / `sendDefaultPii` is off; request bodies are never sent;
  headers and cookies are stripped rather than allow-listed. `request.url` and
  `request.env` are **deleted** — with the FastAPI integration the full URL
  *including the query string* lands in `url`, so redacting `query_string` alone
  left the same secret in place.
- **Credentialed RPC URLs are rewritten.** Alchemy/Helius/Infura/QuickNode put
  the API key in the URL *path*, under the innocuous key `url`, and Sentry
  records outbound requests as breadcrumbs. We keep `scheme://host` (so the error
  stays diagnosable) and drop the rest.
- **Stack-local variables are disabled outright** (`include_local_variables=False`
  in Python; the `LocalVariables`/`LocalVariablesAsync` integrations are removed
  in Node). Locals in this codebase hold decrypted key material under arbitrary
  names like `pk` or `raw` that key-based redaction cannot recognize.
- Key-based redaction covers `private_key`, `privateKey` (camelCase must be
  listed separately — we exchange camelCase JSON with api-ts and Turnkey, and it
  was silently missed), `secret`, `mnemonic`, `seed`, `password`, `passphrase`,
  `credential`, `token`, `api_key`, `authorization`, `cookie`, `session`,
  `encrypted_key`, `kms`, `dek`, `jwt`, `keystore`, `xprv`, `wif`, and more.
- **Value-level** scanning of all free text (exception messages, log messages,
  breadcrumbs) on *both* stacks, because key matching cannot catch a secret
  interpolated into a message. Patterns: hex runs of 40+ chars (deliberately not
  anchored at exactly 64 — a `\b`-anchored 64 pattern cannot match inside a
  longer run, so 128-hex ed25519 keys escaped), Solana base58 keys, JWTs,
  Telegram bot tokens, and AWS key ids.
- `bytes` and `set` values are traversed (Sentry serializes them via `repr`);
  both previously passed through untouched.
- **Breadcrumbs are scrubbed.** The Python SDK converts log records into
  breadcrumbs by default and this codebase logs heavily, so anything logged would
  otherwise ride along unredacted.

Every one of the above corresponds to a **real leak found during review**, not a
hypothetical. Tests: `tests/test_sentry_service.py`,
`api-ts/src/__tests__/sentryRedact.test.ts` — each fixed leak has a regression
test so it cannot quietly come back.

**If you change the redactors, the rule is: fail closed.** Every edge case
(depth cap exceeded, repeated reference, oversized string, redaction throwing)
must drop or redact the data, never pass it through. Two of the bugs found were
exactly this mistake — returning the raw value when the walker gave up.

**Neither integration has been verified end-to-end against a live Sentry
project** — no DSN was available. Init, no-op, and redaction logic are tested
locally. Do a one-time smoke test in dev with a real DSN before relying on it
during an incident.

## Setup checklist

Required secrets/variables (nothing here is committed):

| Where | Name | Purpose |
|---|---|---|
| GitHub secrets | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALERT_CHAT_ID` | probe alerts |
| GitHub secrets | `MONITOR_HEARTBEAT_URL`, `MONITOR_HEARTBEAT_TOKEN` | dead-man's switch — **set 2026-07-26** |
| Railway `monitor` service | same four, plus `PROBE_SOURCE` (set in config) | second scheduler |
| Railway python-api | `MONITOR_HEARTBEAT_SECRET` | validates heartbeats — **set 2026-07-26** |
| Railway python-api / api-ts | `SENTRY_DSN` (optional) | error tracking |

Optional tuning (sensible defaults, only set to override):
`MONITOR_HEARTBEAT_MAX_AGE_MINUTES` (45), `MONITOR_EXPECTED_SOURCES`
(`github-actions,railway-cron` — **must match the `PROBE_SOURCE` each scheduler
sends**, or its heartbeats are coerced to `unknown` and that source looks dead).

### The `monitor` Railway cron service

Create it from `railway.monitor.json`. That file is intentionally comment-free
(Railway parses it against its own schema, and no other `railway.*.json` here
carries extra keys), so the rationale lives here instead:

- **`cronSchedule: */10 * * * *`** — a cron service runs the start command on
  schedule and exits. It is not a long-running server, so it has no
  `healthcheckPath`.
- **`restartPolicyType: NEVER`** — a non-zero exit means "endpoints are down",
  which is the expected failure signal. Restarting on it would produce a restart
  loop that probes continuously and spams alerts.
- **Reuses `api/Dockerfile.railway`** so it needs no new build config; the probe
  itself is stdlib-only.
- **`PROBE_SOURCE=railway-cron`** is set in the start command so the dead-man's
  switch can tell the two schedulers apart. It must match an entry in
  `MONITOR_EXPECTED_SOURCES`.

## Known gaps

- **`suwappubot`** was an orphan Railway service pointed at the main repo with no
  build config, so railpack found no start command and it failed *every* build —
  paging Telegram through the deploy webhook on every push. Its repo source was
  disconnected on 2026-07-26, which stops the failures without destroying
  anything; the service shell remains and can be deleted once you're sure
  nothing depended on it. `status.py` now reports a source-less, non-running
  service as `absent` ("decommissioned") rather than DOWN, since Railway keeps
  its last FAILED deployment on record forever.
- Frontend surfaces (terminal, webapp, showcase) have **no browser-side error
  reporting**. A React crash that never touches the API is invisible.
- No metrics/tracing (`/metrics`, Prometheus, OpenTelemetry). We have health and
  errors, not trends — you cannot currently answer "is p99 latency degrading".
- Bug reports are still **user-initiated only** (`bot/services/support_notifier.py`
  → Telegram + Linear). Sentry closes the crash half of this, not the
  "it behaved wrong but didn't throw" half.
