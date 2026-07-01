#!/usr/bin/env bash
# Suwappu self-healing deployment harness for a Railway service.
#
# This is the SAFE, read-mostly scaffolding for the heal loop. It never pushes
# a production deploy on its own: the `deploy` subcommand is gated behind an
# explicit confirmation, and every other subcommand is read-only. A human (or
# an agent operating under "STOP and ask before any prod deploy") drives it.
#
# The loop it implements:
#   1. watch     — poll the linked service's deploy status until terminal
#   2. diagnose  — on FAILURE, pull build+runtime logs, rank root-cause
#                  hypotheses by signature match (highest-confidence first),
#                  and hard-STOP on any billing/spend-limit block
#   3. (human applies the top-ranked fix in source — no throwaway hacks)
#   4. deploy    — GATED redeploy (needs SELF_HEAL_CONFIRM=1)
#   5. verify    — hit the live healthcheck + a real user-facing route
#   repeat until `verify` is green.
#
# Every hypothesis/action/outcome is appended to the run log for auditability.
#
# Usage:
#   scripts/self_heal_deploy.sh watch        # poll deploy status to terminal
#   scripts/self_heal_deploy.sh diagnose     # pull logs, rank causes, flag billing
#   scripts/self_heal_deploy.sh verify       # health + user-facing route
#   scripts/self_heal_deploy.sh loop         # watch -> diagnose|verify (no deploy)
#   SELF_HEAL_CONFIRM=1 scripts/self_heal_deploy.sh deploy   # gated redeploy
set -uo pipefail

# ── Config ─────────────────────────────────────────────────────────
SERVICE="${SELF_HEAL_SERVICE:-python-api}"
HEALTH_URL="${SELF_HEAL_HEALTH_URL:-https://api.suwappu.bot/health}"
ROUTE_URL="${SELF_HEAL_ROUTE_URL:-https://terminal-production-7906.up.railway.app/}"
LOG_SECONDS="${SELF_HEAL_LOG_SECONDS:-25}"
POLL_SECONDS="${SELF_HEAL_POLL_SECONDS:-15}"
POLL_MAX="${SELF_HEAL_POLL_MAX:-40}"          # ~10min at 15s
STATE_DIR="${SELF_HEAL_STATE_DIR:-/tmp/suwappu-self-heal}"
mkdir -p "$STATE_DIR"
BUILD_LOG="$STATE_DIR/build.log"
RUN_LOG="$STATE_DIR/runtime.log"
AUDIT="$STATE_DIR/audit.log"

log_audit () { echo "[$(date -u +%FT%TZ)] $*" | tee -a "$AUDIT"; }
cd "$(dirname "$0")/.." || exit 2

# ── Billing / spend-limit guard (highest priority — never loop on it) ─
BILLING_RE='exceeded (the )?(monthly )?(usage|spend|resource) limit|spending limit|payment (failed|required|method)|billing|out of credits|plan limit reached|resource provision.*limit|account (is )?(suspended|limited)'

flag_billing () {
  local file="$1"
  if grep -iqE "$BILLING_RE" "$file" 2>/dev/null; then
    echo "🛑 BILLING / SPEND-LIMIT BLOCK DETECTED — halting the heal loop."
    grep -iE "$BILLING_RE" "$file" | tail -5 | sed 's/^/     /'
    log_audit "HALT billing/spend block detected in $file"
    echo
    echo "   This is NOT a code fault. Do not redeploy — resolve billing in the"
    echo "   Railway dashboard (or escalate to the account owner) first."
    return 0
  fi
  return 1
}

# ── Ranked root-cause hypothesis table ─────────────────────────────
# Each entry: confidence|label|regex|first-thing-to-check
HYPOTHESES=(
  "0.97|Boot import error (bad import / missing module)|ImportError|ModuleNotFoundError|cannot import name|no module named|Verify the import chain in bot/main.py; a bad import passes CI but crashes boot"
  "0.95|Dependency/version incompatibility at construction|unexpected keyword argument|incompatible|version conflict|no matching distribution|could not find a version|Check requirements pins (e.g. the openai/httpx proxies bug PR #566); reproduce client construction locally"
  "0.93|Syntax / async-sync mismatch|SyntaxError|IndentationError|'await' outside async|await.*outside function|Run: python3 -c 'import ast; ast.parse(...)' on changed files; check def-vs-async-def on the call chain"
  "0.90|Healthcheck timeout (app never bound port)|healthcheck failed|health check.*(timeout|failed)|service unavailable|1/1 replicas never|Confirm the process binds \$PORT and startup completes; check for a blocking call before uvicorn"
  "0.88|Missing/blank required env var|KeyError|environment variable|validationerror|field required|settings.*missing|Confirm every env var referenced in code exists in Railway service vars (settings.py pydantic)"
  "0.85|DB / migration failure at startup|could not connect|connection refused.*5432|_ensure_schema|relation .* does not exist|operationalerror|Check Postgres online + additive/idempotent migration in database/db.py"
  "0.80|Build step failed (Docker / nixpacks / bun)|failed to build|build failed|npm ERR|bun.*error|docker build|nixpacks|Read the BUILD log section; reproduce the build command locally"
  "0.70|OOM / resource kill during boot|out of memory|oom|killed|signal 9|sigkill|Check service memory limit; look for an eager load (model/cache) at import time"
)

rank_causes () {
  local file="$1"
  echo "── Ranked root-cause hypotheses (highest confidence first) ──"
  local any=0
  for entry in "${HYPOTHESES[@]}"; do
    local conf label regex hint
    conf="$(cut -d'|' -f1 <<<"$entry")"
    label="$(cut -d'|' -f2 <<<"$entry")"
    regex="$(cut -d'|' -f3 <<<"$entry")"
    hint="$(cut -d'|' -f4 <<<"$entry")"
    local n
    n="$(grep -icE "$regex" "$file" 2>/dev/null)"
    if [[ "$n" -gt 0 ]]; then
      any=1
      printf "  [conf %s] %s  (%s hit(s))\n" "$conf" "$label" "$n"
      printf "      first check: %s\n" "$hint"
      grep -iE "$regex" "$file" | tail -2 | sed 's/^/      | /'
      log_audit "HYPOTHESIS conf=$conf label=\"$label\" hits=$n"
    fi
  done
  if [[ "$any" -eq 0 ]]; then
    echo "  (no known signature matched — inspect logs manually below)"
    log_audit "HYPOTHESIS none matched — manual triage required"
    tail -20 "$file" | sed 's/^/      | /'
  fi
  echo "  → Test the TOP hypothesis FIRST. Fix at the source (no throwaway hacks)."
}

# ── Subcommands ────────────────────────────────────────────────────
cmd_status () {
  timeout 20 railway status 2>&1
}

cmd_watch () {
  log_audit "WATCH start service=$SERVICE"
  local i=0
  while (( i < POLL_MAX )); do
    local out state
    out="$(timeout 20 railway status 2>&1)"
    # Pull the linked-service status line.
    state="$(echo "$out" | grep -iE 'status:' | head -1 | sed 's/.*status:\s*//')"
    echo "[$(date -u +%T)Z] deploy state: ${state:-unknown}"
    if echo "$out" | grep -iqE 'FAILED|CRASHED|ERROR'; then
      echo "🔴 Deploy FAILED."
      log_audit "WATCH result=FAILED"
      return 1
    fi
    if echo "$state" | grep -iqE 'Online|SUCCESS|Deployed'; then
      echo "✅ Deploy Online."
      log_audit "WATCH result=ONLINE"
      return 0
    fi
    ((i++)); sleep "$POLL_SECONDS"
  done
  echo "⏱  watch timed out after $((POLL_MAX*POLL_SECONDS))s — deploy still not terminal."
  log_audit "WATCH result=TIMEOUT"
  return 2
}

cmd_diagnose () {
  log_audit "DIAGNOSE start service=$SERVICE"
  echo "── Pulling ${LOG_SECONDS}s of build + runtime logs for $SERVICE ──"
  timeout "$LOG_SECONDS" railway logs --build > "$BUILD_LOG" 2>/dev/null || \
    timeout "$LOG_SECONDS" railway logs > "$BUILD_LOG" 2>/dev/null
  timeout "$LOG_SECONDS" railway logs > "$RUN_LOG" 2>/dev/null
  echo "   build log: $(wc -l < "$BUILD_LOG") lines | runtime log: $(wc -l < "$RUN_LOG") lines"

  # Billing block takes priority over everything else.
  if flag_billing "$BUILD_LOG" || flag_billing "$RUN_LOG"; then
    return 3
  fi

  echo; echo "== BUILD phase =="
  rank_causes "$BUILD_LOG"
  echo; echo "== RUNTIME phase =="
  rank_causes "$RUN_LOG"
}

cmd_verify () {
  log_audit "VERIFY start"
  local ok=0
  hc () {
    local name="$1" url="$2"
    local body code
    body="$(curl -s -m 12 -w '\n%{http_code}' "$url" 2>/dev/null)"
    code="$(echo "$body" | tail -1)"
    body="$(echo "$body" | sed '$d')"
    if [[ "$code" == "200" ]]; then
      echo "✓ $name → 200  ${body:0:100}"
    else
      echo "✗ $name → ${code:-timeout}"
      ok=1
    fi
  }
  hc "healthcheck   ($HEALTH_URL)" "$HEALTH_URL"
  hc "user route    ($ROUTE_URL)" "$ROUTE_URL"
  if [[ "$ok" -eq 0 ]]; then
    echo "VERDICT: ✅ PRODUCTION VERIFIED GREEN"
    log_audit "VERIFY result=GREEN"
  else
    echo "VERDICT: 🔴 still failing — re-diagnose"
    log_audit "VERIFY result=FAILING"
  fi
  return "$ok"
}

cmd_deploy () {
  if [[ "${SELF_HEAL_CONFIRM:-0}" != "1" ]]; then
    echo "🛑 REFUSING to deploy: this is a PRODUCTION deploy and requires explicit"
    echo "   confirmation. Re-run with SELF_HEAL_CONFIRM=1 once a human has approved."
    log_audit "DEPLOY refused (no confirmation)"
    return 1
  fi
  echo "⚠  Approved production deploy of '$SERVICE' via 'railway up'."
  log_audit "DEPLOY start service=$SERVICE (confirmed)"
  railway up --service "$SERVICE"
  local rc=$?
  log_audit "DEPLOY railway-up exit=$rc"
  return "$rc"
}

# Convenience: full read-only loop (never deploys).
cmd_loop () {
  cmd_status
  if cmd_watch; then
    cmd_verify
  else
    cmd_diagnose
    echo
    echo "Next: apply the TOP-ranked source fix, get human approval, then:"
    echo "  SELF_HEAL_CONFIRM=1 $0 deploy && $0 watch && $0 verify"
  fi
}

case "${1:-loop}" in
  status)   cmd_status ;;
  watch)    cmd_watch ;;
  diagnose) cmd_diagnose ;;
  verify)   cmd_verify ;;
  deploy)   cmd_deploy ;;
  loop)     cmd_loop ;;
  *) echo "usage: $0 {status|watch|diagnose|verify|deploy|loop}"; exit 64 ;;
esac
