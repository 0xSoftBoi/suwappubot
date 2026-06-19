#!/usr/bin/env bash
set -e
MODE=${1:-all}

if [[ "$MODE" == "all" || "$MODE" == "python" ]]; then
  echo "=== Python syntax ==="
  find api bot database -name "*.py" -not -path "*/\.*" | xargs python3 -m py_compile
  echo "✓ Python OK"
fi

if [[ "$MODE" == "all" || "$MODE" == "api" ]]; then
  echo "=== TypeScript types ==="
  (cd api-ts && bun run check)
  echo "✓ TypeScript OK"
fi

if [[ "$MODE" == "all" || "$MODE" == "api" || "$MODE" == "agent" ]]; then
  echo "=== OpenAPI spec drift ==="
  if ! (cd api-ts && bun run check:openapi); then
    echo "✗ openapi-agent.json is out of sync with the Zod validators."
    echo "  Run: (cd api-ts && bun run generate:openapi) and commit the result."
    exit 1
  fi
  echo "✓ OpenAPI spec in sync"
fi

if [[ "$MODE" == "all" || "$MODE" == "health" ]]; then
  echo "=== Production health ==="
  curl -fsS https://api.suwappu.bot/health | python3 -m json.tool
  echo "✓ Python API healthy"
fi

echo "All checks passed ✓"
