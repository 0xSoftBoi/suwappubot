#!/usr/bin/env bash
# Fail when the checked-in generated docs data is stale against gitbook/.
#
# showcase/src/data/docs.json and showcase/public/llms*.txt are generated from
# the gitbook/ tree, but `regen-docs.mjs` is NOT part of showcase's prebuild:
# prebuild runs build-content.ts and gen-llms.mjs only. So the live docs site
# serves whatever docs.json happens to be committed. Editing gitbook/ without
# regenerating ships the change as source-only, and customers keep reading the
# old prose.
#
# Run: bash scripts/check_generated_docs.sh
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

GENERATED=(showcase/src/data/docs.json showcase/public/llms.txt showcase/public/llms-full.txt)

# Refuse to run over uncommitted edits to the generated files: we could not then
# tell a stale artifact from work in progress.
if ! git diff --quiet -- "${GENERATED[@]}"; then
  echo "• Generated docs data has uncommitted changes; skipping staleness check."
  echo "  Commit or revert ${GENERATED[*]} and re-run."
  exit 0
fi

if ! (cd showcase && node scripts/regen-docs.mjs >/dev/null 2>&1); then
  echo "✗ regen-docs.mjs failed. The gitbook tree does not build."
  exit 1
fi
if ! (cd showcase && node scripts/gen-llms.mjs >/dev/null 2>&1); then
  echo "✗ gen-llms.mjs failed."
  git checkout -- "${GENERATED[@]}" 2>/dev/null
  exit 1
fi

if git diff --quiet -- "${GENERATED[@]}"; then
  echo "✓ Generated docs data matches gitbook/"
  exit 0
fi

echo "✗ Generated docs data is stale against gitbook/:"
git diff --stat -- "${GENERATED[@]}" | sed 's/^/    /'
echo "  The live docs site reads these files, not gitbook/ directly."
echo "  Run: cd showcase && bun run docs:generate   then commit the result."
git checkout -- "${GENERATED[@]}" 2>/dev/null
exit 1
