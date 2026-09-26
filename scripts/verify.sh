#!/usr/bin/env bash
set -e
MODE=${1:-all}

case "$MODE" in
  all|python|api|agent|env|health|onchain|docs) ;;
  *)
    echo "✗ Unknown verify lane: '$MODE'" >&2
    echo "  Valid lanes: all python api agent env health onchain docs" >&2
    exit 2
    ;;
esac

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

if [[ "$MODE" == "all" || "$MODE" == "api" || "$MODE" == "agent" ]]; then
  echo "=== MCP tool schema drift ==="
  if ! (cd api-ts && bun run check:mcp); then
    echo "✗ MCP tool schemas disagree with the Zod validators that actually run."
    echo "  Derive the tool's inputSchema with mcpInputSchema() in src/routes/mcpTools.ts."
    echo "  See docs/plans/mcp-unification.md."
    exit 1
  fi
  echo "✓ MCP tool schemas in sync"
fi

if [[ "$MODE" == "all" || "$MODE" == "env" ]]; then
  echo "=== Env contract drift ==="
  if ! python3 scripts/check_env_schema.py; then
    echo "✗ .env.schema is out of sync with the settings schemas."
    echo "  Run: python3 scripts/check_env_schema.py --write and commit the result."
    exit 1
  fi
  echo "✓ Env contract in sync"
fi

if [[ "$MODE" == "all" || "$MODE" == "docs" ]]; then
  echo "=== Docs drift ==="
  if ! python3 scripts/check_docs_drift.py; then
    echo "✗ Canonical docs reference paths that no longer exist."
    echo "  Update the doc alongside the rename/removal that stranded it."
    exit 1
  fi
fi

if [[ "$MODE" == "all" || "$MODE" == "health" ]]; then
  echo "=== Production health ==="
  curl -fsS https://api.suwappu.bot/health | python3 -m json.tool
  echo "✓ Python API healthy"
fi

# Cross-chain constants (CCTP contracts + domain ids, USDT0 token/OFT pairs,
# LayerZero EIDs) checked against the live chains. Deliberately NOT part of
# "all": it hits ~8 public RPC endpoints, which rate-limit and intermittently
# fail individual methods, so folding it into the general gate would make
# verify.sh flaky for reasons unrelated to the change under test. Run it
# explicitly before shipping anything that touches a bridge address, a CCTP
# domain, or a LayerZero endpoint id.
if [[ "$MODE" == "onchain" ]]; then
  echo "=== On-chain constants ==="
  python3.12 scripts/verify_onchain_constants.py
  echo "✓ On-chain constants verified"
fi

echo "All checks passed ✓"

if [[ "$MODE" == "all" ]]; then
  echo
  echo "Note: on-chain constant verification is not included in 'all'."
  echo "  Run: bash scripts/verify.sh onchain"
fi
