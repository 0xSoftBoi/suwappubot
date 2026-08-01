#!/usr/bin/env bash
# Refuse to deploy a working tree that would REGRESS production.
#
# Written after doing exactly that: a feature branch cut early in a long
# session was deployed to prod while missing EIGHT merged PRs, including the
# fix that made route capture work at all. Nothing warned. The deploy reported
# SUCCESS. Only luck — the build not landing — prevented a silent rollback of
# a week's work.
#
# verify_deploy.sh answers "did my code reach production?". This answers the
# question that comes BEFORE it: "should this code go to production at all?"
# They are different failures and the second one is the dangerous one, because
# a successful deploy of stale code looks exactly like a successful deploy.
#
#   ./scripts/preflight_deploy.sh          # check, exit 1 if unsafe
#
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

fail=0
note() { printf '  %s\n' "$1"; }

echo "preflight:"

# 1. Is the tree behind origin/main?
git fetch origin --quiet 2>/dev/null || note "WARN: could not fetch origin"
behind=$(git rev-list --count HEAD..origin/main 2>/dev/null || echo "?")
if [ "$behind" = "0" ]; then
  note "OK    contains all of origin/main"
else
  note "FAIL  missing $behind commit(s) from origin/main — deploying would regress:"
  git log --oneline HEAD..origin/main 2>/dev/null | head -10 | sed 's/^/          /'
  note "      fix: git merge origin/main   (never rebase — this is a worktree)"
  fail=1
fi

# 2. Uncommitted changes silently ship with `railway up` (it uploads the
#    working directory, not the commit), so what is deployed may not exist in
#    any commit and cannot be reproduced or reverted.
if [ -n "$(git status --porcelain)" ]; then
  note "WARN  uncommitted changes WILL be uploaded by 'railway up':"
  git status --porcelain | head -8 | sed 's/^/          /'
fi

# 3. Build artifacts must never enter the image.
if git status --porcelain | grep -qE 'node_modules|\.next/|/dist/'; then
  note "FAIL  build artifacts in the tree"
  fail=1
fi

if [ "$fail" -eq 0 ]; then
  echo "preflight: SAFE TO DEPLOY"
else
  echo "preflight: DO NOT DEPLOY"
fi
exit "$fail"
