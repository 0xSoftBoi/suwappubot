#!/usr/bin/env bash
# Suwappu verification checks — run after deployments or significant changes.
# Usage: bash scripts/verify.sh [section]
# Sections: api, agent, npm, registry, schema, workflow, all (default)
set -uo pipefail

SECTION="${1:-all}"
PASS=0; FAIL=0

check() {
  local name="$1"; shift
  if "$@" >/dev/null 2>&1; then
    echo "  PASS  $name"; PASS=$((PASS+1))
  else
    echo "  FAIL  $name"; FAIL=$((FAIL+1))
  fi
}

run_api() {
  echo "=== API-TS Health ==="
  check "Health endpoint (dev)" curl -sf https://devapi.suwappu.bot/health
  check "ECS service running" bash -c "
    aws ecs describe-services --cluster suwappu-cluster --services suwappu-api-ts-dev \
      --query 'services[0].deployments[?status==\`PRIMARY\`].runningCount' --output text | grep -q 1"
}

run_agent() {
  echo "=== Agent Card ==="
  check "Agent card returns 200" curl -sf https://devapi.suwappu.bot/.well-known/agent.json
  check "securitySchemes is dict" bash -c '
    curl -sf https://devapi.suwappu.bot/.well-known/agent.json | python3 -c "
import sys,json; d=json.load(sys.stdin); assert isinstance(d[\"securitySchemes\"],dict)"'
  check "All skills have inputModes" bash -c '
    curl -sf https://devapi.suwappu.bot/.well-known/agent.json | python3 -c "
import sys,json; d=json.load(sys.stdin)
for s in d[\"skills\"]: assert \"inputModes\" in s and \"outputModes\" in s, s[\"id\"]"'
  check "7 skills present" bash -c '
    curl -sf https://devapi.suwappu.bot/.well-known/agent.json | python3 -c "
import sys,json; assert len(json.load(sys.stdin)[\"skills\"])==7"'
}

run_npm() {
  echo "=== npm Packages ==="
  for pkg in "@suwappu/mcp-server" "@suwappu/sdk" "@suwappu/langchain-suwappu"; do
    check "$pkg" curl -sf "https://registry.npmjs.org/$pkg"
  done
}

run_registry() {
  echo "=== Registry Listings ==="
  check "a2aregistry.org" curl -sf "https://a2aregistry.org/api/agents/925fd01b-886f-4ae0-bdb8-6daab71948e3"
  check "awesome-a2a PR #36" gh pr view 36 --repo ai-boost/awesome-a2a --json state
}

run_schema() {
  echo "=== api-ts Schema & Validators ==="
  check "traderStats.ts exists" test -f api-ts/src/db/schema/traderStats.ts
  check "traderStats exported" grep -q "traderStats" api-ts/src/db/schema/index.ts
  for s in ExecuteSwapSchema SwapStatusQuerySchema WebhookEventsQuerySchema; do
    check "$s in validators" grep -q "$s" api-ts/src/routes/validators.ts
  done
}

run_workflow() {
  echo "=== Deploy Workflow ==="
  check "Defaults to dev" grep -q 'Default to development' .github/workflows/deploy-api-ts.yml
  check "smithery.yaml exists" test -f packages/mcp-server/smithery.yaml
}

case "$SECTION" in
  api)      run_api ;;
  agent)    run_agent ;;
  npm)      run_npm ;;
  registry) run_registry ;;
  schema)   run_schema ;;
  workflow) run_workflow ;;
  all)      run_api; run_agent; run_npm; run_registry; run_schema; run_workflow ;;
  *)        echo "Unknown section: $SECTION"; exit 1 ;;
esac

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
