#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERIFY_PARENT="${RUNNER_TEMP:-/tmp}"
VERIFY_TMP="$(mktemp -d "${VERIFY_PARENT%/}/suwappu-sdk-verify.XXXXXX")"

cleanup() {
  rm -rf -- "$VERIFY_TMP"
}
trap cleanup EXIT

cd "$REPO_ROOT"

# This is the single pre-publish contract for the three npm packages. CI and
# the tag/workflow release path both call this script so their gates cannot
# silently drift apart.
(
  cd packages/sdk
  bun install --frozen-lockfile
  bun run typecheck
  bun run test
  bun run build
)
SDK_TARBALL="$(cd packages/sdk && npm pack --silent --pack-destination "$VERIFY_TMP")"
mkdir -p "$VERIFY_TMP/sdk-consumer"
(
  cd "$VERIFY_TMP/sdk-consumer"
  npm init -y >/dev/null
  npm install --silent "$VERIFY_TMP/$SDK_TARBALL"
  node --input-type=module -e "import { Suwappu } from '@suwappu/sdk'; if (typeof Suwappu !== 'function') process.exit(1)"
)

(
  cd packages/openclaw
  bun install --frozen-lockfile
  bun run typecheck
  bun run test
  bun run build
)
OPENCLAW_TARBALL="$(cd packages/openclaw && npm pack --silent --pack-destination "$VERIFY_TMP")"
mkdir -p "$VERIFY_TMP/openclaw-consumer"
(
  cd "$VERIFY_TMP/openclaw-consumer"
  npm init -y >/dev/null
  npm install --silent "$VERIFY_TMP/$OPENCLAW_TARBALL"
  node --input-type=module -e "import { createClient } from '@suwappu/openclaw'; if (typeof createClient !== 'function') process.exit(1)"
)

(
  cd packages/mcp-server
  bun install --frozen-lockfile
  bun run typecheck
  bun run build
  node scripts/smoke.mjs
)
MCP_TARBALL="$(cd packages/mcp-server && npm pack --silent --pack-destination "$VERIFY_TMP")"
mkdir -p "$VERIFY_TMP/mcp-consumer"
(
  cd "$VERIFY_TMP/mcp-consumer"
  npm init -y >/dev/null
  npm install --silent "$VERIFY_TMP/$MCP_TARBALL"
  test -x node_modules/.bin/suwappu-mcp
)

echo "TypeScript package release contract passed."
