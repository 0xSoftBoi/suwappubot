#!/bin/bash
# Hook script: type-check TypeScript projects after agent work
# Exit 0 = pass, Exit 2 = fail (sends feedback to agent, keeps it working)

set -e

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
ERRORS=""

# Check api-ts types
if [ -d "$REPO_ROOT/api-ts" ]; then
  echo "Type-checking api-ts..."
  cd "$REPO_ROOT/api-ts"
  if ! bunx tsc --noEmit 2>&1; then
    ERRORS="$ERRORS\n- api-ts has type errors"
  fi
fi

# Check webapp types
if [ -d "$REPO_ROOT/webapp" ]; then
  echo "Type-checking webapp..."
  cd "$REPO_ROOT/webapp"
  if ! npx tsc --noEmit 2>&1; then
    ERRORS="$ERRORS\n- webapp has type errors"
  fi
fi

if [ -n "$ERRORS" ]; then
  echo ""
  echo "TYPE CHECK FAILED:$ERRORS"
  echo "Fix these type errors before marking the task complete."
  exit 2
fi

echo "All type checks passed."
exit 0
