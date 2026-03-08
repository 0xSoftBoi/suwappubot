#!/bin/bash
#
# Health Check Script for Suwappu API Instances
# Usage: ./health-check.sh [--watch] [--dns] [--verbose]
#
# Options:
#   --watch, -w    Continuously monitor (every 10s)
#   --dns, -d      Include DNS resolution check
#   --verbose, -v  Show detailed error info
#

# API endpoints to check
ENDPOINTS=(
  "https://api.suwappu.bot/health"
  "https://devapi.suwappu.bot/health"
  "https://app.suwappu.bot/health"
  "https://devfront.suwappu.bot/health"
)

# Hostnames for DNS checks
HOSTNAMES=(
  "api.suwappu.bot"
  "devapi.suwappu.bot"
  "app.suwappu.bot"
  "devfront.suwappu.bot"
)

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color
BOLD='\033[1m'

check_health() {
  local url=$1
  local start_time=$(date +%s%3N)

  # Make request with timeout
  response=$(curl -s -w "\n%{http_code}" --connect-timeout 5 --max-time 10 "$url" 2>/dev/null)
  local exit_code=$?

  local end_time=$(date +%s%3N)
  local duration=$((end_time - start_time))

  # Extract status code (last line) and body (everything else)
  local http_code=$(echo "$response" | tail -n1)
  local body=$(echo "$response" | sed '$d')

  # Parse JSON response
  local status=""
  local service=""
  if [ -n "$body" ]; then
    status=$(echo "$body" | grep -o '"status"[[:space:]]*:[[:space:]]*"[^"]*"' | cut -d'"' -f4)
    service=$(echo "$body" | grep -o '"service"[[:space:]]*:[[:space:]]*"[^"]*"' | cut -d'"' -f4)
  fi

  # Determine status display
  local status_icon
  local status_color

  if [ $exit_code -ne 0 ]; then
    status_icon="✗"
    status_color=$RED
    status="unreachable"
  elif [ "$http_code" = "200" ] && [ "$status" = "ok" ]; then
    status_icon="✓"
    status_color=$GREEN
  elif [ "$http_code" = "200" ]; then
    status_icon="!"
    status_color=$YELLOW
    status=${status:-"unknown"}
  else
    status_icon="✗"
    status_color=$RED
    status="error (HTTP $http_code)"
  fi

  # Print result
  printf "${status_color}${status_icon}${NC} "
  printf "${BOLD}%-35s${NC} " "$url"
  printf "${status_color}%-12s${NC} " "$status"
  printf "${BLUE}%4dms${NC}" "$duration"
  if [ -n "$service" ]; then
    printf "  ${YELLOW}%s${NC}" "$service"
  fi
  printf "\n"
}

print_header() {
  echo ""
  printf "${BOLD}%-2s %-35s %-12s %6s  %s${NC}\n" "" "ENDPOINT" "STATUS" "LATENCY" "SERVICE"
  echo "─────────────────────────────────────────────────────────────────────────"
}

run_checks() {
  print_header
  for endpoint in "${ENDPOINTS[@]}"; do
    check_health "$endpoint"
  done
  echo ""
}

# DNS resolution check
check_dns() {
  local hostname=$1
  local resolved=$(dig +short "$hostname" | head -1)

  if [ -z "$resolved" ]; then
    printf "${RED}✗${NC} "
    printf "${BOLD}%-35s${NC} " "$hostname"
    printf "${RED}%-20s${NC}\n" "DNS not resolved"
  else
    printf "${GREEN}✓${NC} "
    printf "${BOLD}%-35s${NC} " "$hostname"
    printf "${GREEN}%-20s${NC}\n" "$resolved"
  fi
}

print_dns_header() {
  echo ""
  printf "${BOLD}%-2s %-35s %-20s${NC}\n" "" "HOSTNAME" "RESOLVES TO"
  echo "───────────────────────────────────────────────────────────"
}

run_dns_checks() {
  print_dns_header
  for hostname in "${HOSTNAMES[@]}"; do
    check_dns "$hostname"
  done
  echo ""
}

# Parse arguments
WATCH_MODE=false
DNS_CHECK=false
VERBOSE=false

for arg in "$@"; do
  case $arg in
    --watch|-w)
      WATCH_MODE=true
      ;;
    --dns|-d)
      DNS_CHECK=true
      ;;
    --verbose|-v)
      VERBOSE=true
      ;;
  esac
done

# Main
echo ""
echo "${BOLD}🏥 Suwappu API Health Check${NC}"
echo "   $(date '+%Y-%m-%d %H:%M:%S')"

if [ "$DNS_CHECK" = true ]; then
  echo ""
  echo "${BOLD}📡 DNS Resolution${NC}"
  run_dns_checks
fi

if [ "$WATCH_MODE" = true ]; then
  echo "   ${YELLOW}Watch mode (Ctrl+C to exit)${NC}"
  while true; do
    echo "${BOLD}🔌 API Health${NC}"
    run_checks
    if [ "$DNS_CHECK" = true ]; then
      echo "${BOLD}📡 DNS Resolution${NC}"
      run_dns_checks
    fi
    sleep 10
  done
else
  echo ""
  echo "${BOLD}🔌 API Health${NC}"
  run_checks
fi
