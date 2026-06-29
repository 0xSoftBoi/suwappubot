#!/usr/bin/env bash
# Suwappu production monitor — pulls health + recent Railway logs, classifies
# failures by user flow (wallet / deposit / swap / RPC), and prints a verdict.
# Designed to be run on a loop (e.g. `/loop 5m bash scripts/monitor.sh`).
#
# Exit 0 = healthy, 1 = degraded/failures found.
set -uo pipefail

STATE_DIR="${MONITOR_STATE_DIR:-/tmp/suwappu-monitor}"
mkdir -p "$STATE_DIR"
SNAP="$STATE_DIR/logs.snapshot"
LOG_SECONDS="${MONITOR_LOG_SECONDS:-20}"
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
FAIL=0

echo "════════════════════════════════════════════════════════════"
echo " SUWAPPU MONITOR  $NOW"
echo "════════════════════════════════════════════════════════════"

# ── 1. Health endpoints ───────────────────────────────────────────
check_health () {
  local name="$1" url="$2"
  local body code
  body="$(curl -s -m 10 -w '\n%{http_code}' "$url" 2>/dev/null)"
  code="$(echo "$body" | tail -1)"
  body="$(echo "$body" | sed '$d')"
  if [[ "$code" == "200" ]]; then
    echo "✓ HEALTH $name → 200  ${body:0:120}"
  else
    echo "✗ HEALTH $name → ${code:-timeout}  ${body:0:120}"
    FAIL=1
  fi
}
check_health "api.suwappu.bot/health" "https://api.suwappu.bot/health"

# ── 2. Pull a bounded snapshot of recent logs ─────────────────────
cd "$(dirname "$0")/.." || exit 2
timeout "$LOG_SECONDS" railway logs > "$SNAP" 2>/dev/null
LINES="$(wc -l < "$SNAP")"
echo "── pulled $LINES log lines (${LOG_SECONDS}s window) ──"

# ── 3. Classify by flow. Patterns -> human label ──────────────────
classify () {
  local label="$1" pattern="$2"
  local n
  n="$(grep -icE "$pattern" "$SNAP")"
  if [[ "$n" -gt 0 ]]; then
    echo "⚠  $label: $n hit(s)"
    grep -iE "$pattern" "$SNAP" | tail -3 | sed 's/^/      /'
    FAIL=1
  else
    echo "✓  $label: clean"
  fi
}

classify "WALLET/AUTH failures"  'wallet creation failed|authentication failed|auth verification error|turnkey returned empty|no turnkey wallet found|create_(evm|sol)_wallet'
classify "DEPOSIT/WITHDRAW fails" 'deposit (quote|execution|flow|failed)|withdraw(al)? failed|cctp deposit .* failed|savings (deposit|withdraw) failed'
classify "SWAP failures"          'swap execution failed|swap_confirm|quote failed|sponsored swap failed|no swap engine configured|status check failed'
classify "Unhandled exceptions"   'traceback \(most recent call last\)|critical|^.*ERROR.* (exception|unhandled)'

# ── 4. RPC circuit health (the silent swap-killer) ────────────────
RPC_OPEN="$(grep -cE 'RPC circuit OPEN' "$SNAP")"
if [[ "$RPC_OPEN" -gt 0 ]]; then
  UNIQ="$(grep -oE 'RPC circuit OPEN https://[^ ]+' "$SNAP" | sort -u | wc -l)"
  MAXF="$(grep -oE '\([0-9]+s, [0-9]+ failures\)' "$SNAP" | grep -oE '[0-9]+ failures' | grep -oE '[0-9]+' | sort -n | tail -1)"
  echo "✗  RPC CIRCUITS OPEN: $UNIQ distinct endpoints down (max ${MAXF:-?} failures)"
  FAIL=1
else
  echo "✓  RPC circuits: all closed"
fi

echo "────────────────────────────────────────────────────────────"
if [[ "$FAIL" -eq 0 ]]; then
  echo "VERDICT: ✅ HEALTHY"
else
  echo "VERDICT: 🔴 DEGRADED — see flagged items above"
fi
exit "$FAIL"
