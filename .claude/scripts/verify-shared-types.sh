#!/bin/bash
# Hook script: verify shared types are in sync between packages/shared and webapp
# Exit 0 = pass, Exit 2 = fail (sends feedback to agent)

set -e

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
SHARED="$REPO_ROOT/packages/shared/src/types/swap.ts"
WEBAPP="$REPO_ROOT/webapp/src/types/swap.ts"

if [ ! -f "$SHARED" ] || [ ! -f "$WEBAPP" ]; then
  echo "Shared type files not found, skipping sync check."
  exit 0
fi

# Extract interfaces (strip comments and trailing whitespace) and compare
SHARED_IFACES=$(grep -E "^export interface|^\s+\w+[\?:]" "$SHARED" | sed 's/\/\/.*//' | sed 's/[[:space:]]*$//' | tr -s ' ')
WEBAPP_IFACES=$(grep -E "^export interface|^\s+\w+[\?:]" "$WEBAPP" | sed 's/\/\/.*//' | sed 's/[[:space:]]*$//' | tr -s ' ')

if [ "$SHARED_IFACES" != "$WEBAPP_IFACES" ]; then
  echo "SHARED TYPES OUT OF SYNC"
  echo ""
  echo "packages/shared/src/types/swap.ts and webapp/src/types/swap.ts have diverged."
  echo "Ensure both files define the same interfaces with the same fields."
  echo ""
  diff <(echo "$SHARED_IFACES") <(echo "$WEBAPP_IFACES") || true
  exit 2
fi

echo "Shared types are in sync."
exit 0
