#!/usr/bin/env bash
# check-logs.sh — Check AWS CloudWatch logs for all Suwappu ECS services
# Usage: ./scripts/check-logs.sh [--since 1h] [--errors-only] [--follow]

set -euo pipefail

# Defaults
SINCE="1h"
ERRORS_ONLY=false
FOLLOW=false
TAIL_LINES=60

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

LOG_GROUPS=(
  "/ecs/suwappu-bot"
  "/ecs/suwappu"
  "/ecs/suwappu-api-ts"
  "/ecs/suwappu-bot-dev"
  "/ecs/suwappu-dev"
)

usage() {
  echo "Usage: $0 [OPTIONS]"
  echo ""
  echo "Options:"
  echo "  --since PERIOD   Time period to look back (default: 1h)"
  echo "                   Examples: 30m, 1h, 6h, 1d"
  echo "  --errors-only    Only show ERROR/WARNING/Exception lines"
  echo "  --follow         Follow logs in real-time (only suwappu-bot)"
  echo "  --lines N        Number of tail lines per group (default: 60)"
  echo "  --group NAME     Only check a specific log group (partial match)"
  echo "  -h, --help       Show this help"
  exit 0
}

# Parse args
FILTER_GROUP=""
while [[ $# -gt 0 ]]; do
  case $1 in
    --since)   SINCE="$2"; shift 2 ;;
    --errors-only) ERRORS_ONLY=true; shift ;;
    --follow)  FOLLOW=true; shift ;;
    --lines)   TAIL_LINES="$2"; shift 2 ;;
    --group)   FILTER_GROUP="$2"; shift 2 ;;
    -h|--help) usage ;;
    *) echo "Unknown option: $1"; usage ;;
  esac
done

# Check AWS auth
if ! aws sts get-caller-identity &>/dev/null; then
  echo -e "${RED}Not authenticated with AWS. Run: aws sso login${NC}"
  exit 1
fi

ACCOUNT=$(aws sts get-caller-identity --query 'Account' --output text)
echo -e "${BOLD}AWS Account: ${CYAN}${ACCOUNT}${NC}"
echo -e "${BOLD}Time range:  ${CYAN}last ${SINCE}${NC}"
echo -e "${BOLD}Date:        ${CYAN}$(date -u '+%Y-%m-%d %H:%M UTC')${NC}"
echo ""

# Follow mode — tail a single group
if $FOLLOW; then
  GROUP="${FILTER_GROUP:-/ecs/suwappu-bot}"
  # Resolve partial match
  for g in "${LOG_GROUPS[@]}"; do
    if [[ "$g" == *"$GROUP"* ]]; then
      GROUP="$g"
      break
    fi
  done
  echo -e "${BOLD}Following ${CYAN}${GROUP}${NC} (Ctrl+C to stop)..."
  aws logs tail "$GROUP" --since "$SINCE" --follow --format short
  exit 0
fi

# Check each log group
ERROR_COUNT=0
WARN_COUNT=0
EMPTY_GROUPS=()

for GROUP in "${LOG_GROUPS[@]}"; do
  # Filter if --group specified
  if [[ -n "$FILTER_GROUP" && "$GROUP" != *"$FILTER_GROUP"* ]]; then
    continue
  fi

  echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BOLD}${CYAN}${GROUP}${NC}"
  echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

  LOGS=$(aws logs tail "$GROUP" --since "$SINCE" --format short 2>&1 || true)

  if [[ -z "$LOGS" ]]; then
    echo -e "  ${YELLOW}(no logs in the last ${SINCE})${NC}"
    EMPTY_GROUPS+=("$GROUP")
    echo ""
    continue
  fi

  if $ERRORS_ONLY; then
    FILTERED=$(echo "$LOGS" | grep -iE '(error|exception|traceback|warning|fatal|critical|panic)' || true)
    if [[ -z "$FILTERED" ]]; then
      echo -e "  ${GREEN}No errors found${NC}"
    else
      echo "$FILTERED" | tail -n "$TAIL_LINES" | while IFS= read -r line; do
        if echo "$line" | grep -qiE '(error|exception|traceback|fatal|critical|panic)'; then
          echo -e "  ${RED}${line}${NC}"
        else
          echo -e "  ${YELLOW}${line}${NC}"
        fi
      done
    fi
  else
    # Show tail with error highlighting
    echo "$LOGS" | tail -n "$TAIL_LINES" | while IFS= read -r line; do
      if echo "$line" | grep -qiE '(error|exception|traceback|fatal|critical|panic)'; then
        echo -e "  ${RED}${line}${NC}"
        ((ERROR_COUNT++)) || true
      elif echo "$line" | grep -qiE 'warning'; then
        echo -e "  ${YELLOW}${line}${NC}"
        ((WARN_COUNT++)) || true
      elif echo "$line" | grep -qiE '(shutting down|restart)'; then
        echo -e "  ${YELLOW}${line}${NC}"
      elif echo "$line" | grep -qiE '(running at|started|ready)'; then
        echo -e "  ${GREEN}${line}${NC}"
      else
        echo "  $line"
      fi
    done
  fi
  echo ""
done

# Summary
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD}SUMMARY${NC}"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

if [[ ${#EMPTY_GROUPS[@]} -gt 0 ]]; then
  echo -e "${YELLOW}Inactive (no logs):${NC}"
  for g in "${EMPTY_GROUPS[@]}"; do
    echo -e "  - $g"
  done
fi

# Quick error scan across all groups
echo ""
echo -e "${BOLD}Error scan (last ${SINCE}):${NC}"
for GROUP in "${LOG_GROUPS[@]}"; do
  if [[ -n "$FILTER_GROUP" && "$GROUP" != *"$FILTER_GROUP"* ]]; then
    continue
  fi
  ERRS=$(aws logs tail "$GROUP" --since "$SINCE" --format short 2>/dev/null \
    | grep -ciE '(error|exception|traceback|fatal|critical|panic)' || true)
  if [[ "$ERRS" -gt 0 ]]; then
    echo -e "  ${RED}${GROUP}: ${ERRS} error(s)${NC}"
  else
    echo -e "  ${GREEN}${GROUP}: clean${NC}"
  fi
done
echo ""
