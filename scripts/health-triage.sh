#!/usr/bin/env bash
# Headless health triage — check prod (and optionally dev) health endpoints, and
# if anything is unhealthy, hand the logs to Claude in headless mode for a
# root-cause summary. Safe to run from a laptop, a cron, or a GitHub Action.
#
# Usage:
#   scripts/health-triage.sh            # check prod
#   scripts/health-triage.sh dev        # check dev
#   TRIAGE=0 scripts/health-triage.sh   # health-check only, skip the Claude call
#
# Requires: curl. The Claude triage step also needs the `claude` CLI on PATH.
set -uo pipefail

ENV="${1:-prod}"
if [ "$ENV" = "dev" ]; then
  HEALTH_URL="https://devapi.suwappu.bot/health"
  SERVICE="python-api"          # Railway service name for log pull
else
  HEALTH_URL="https://api.suwappu.bot/health"
  SERVICE="python-api"
fi

echo "== health-triage ($ENV) =="
echo "GET $HEALTH_URL"
CODE=$(curl -s -o /tmp/health-body.txt -w '%{http_code}' --max-time 15 "$HEALTH_URL" || echo 000)
BODY=$(cat /tmp/health-body.txt 2>/dev/null)
echo "HTTP $CODE"
echo "$BODY"

if [ "$CODE" = "200" ]; then
  echo "OK — $ENV healthy."
  exit 0
fi

echo "UNHEALTHY ($CODE). Gathering context..."

# Reminder: deploy target is Railway, NOT AWS ECS.
LOGS=""
if command -v railway >/dev/null 2>&1; then
  LOGS=$(railway logs --service "$SERVICE" 2>/dev/null | tail -n 120)
fi

if [ "${TRIAGE:-1}" = "0" ]; then
  echo "TRIAGE=0 — skipping Claude call. Logs:"
  echo "$LOGS"
  exit 1
fi

if ! command -v claude >/dev/null 2>&1; then
  echo "claude CLI not found — cannot auto-triage. Logs above." >&2
  exit 1
fi

PROMPT="The $ENV health endpoint $HEALTH_URL returned HTTP $CODE (expected 200).
Body:
$BODY

Recent Railway logs (service=$SERVICE):
$LOGS

Give a concise root-cause hypothesis and the single most likely fix. This is a
LIVE Railway production/dev service, NOT local dev and NOT AWS ECS. Detect
billing/authorization blocks explicitly and say so instead of proposing a code
fix. Keep it under 300 tokens."

echo "== Claude root-cause =="
claude -p "$PROMPT" --allowedTools "Bash,Read,Grep"
