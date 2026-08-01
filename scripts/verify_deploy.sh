#!/usr/bin/env bash
# Verify that a deployed service is running the code in the working tree.
#
# A green Railway deploy is NOT proof the new code is live — an older
# container can keep serving, and `railway redeploy` re-deploys a PREVIOUS
# image rather than current source. This compares the source fingerprint the
# running app computes for itself against the same hash computed locally.
#
#   ./scripts/verify_deploy.sh https://python-api-production-8526.up.railway.app
#
# Exit 0 = deployed code matches the working tree. Exit 1 = it does not.
set -euo pipefail

# Which service to check. api-ts reports its fingerprint from /health;
# python-api from /health/live. Both hash their own sources the same way, so
# one script covers either.
SERVICE="${1:-python-api}"
case "$SERVICE" in
  python-api) URL="https://python-api-production-8526.up.railway.app"; PATH_="/health/live"; DIRS="api bot database"; ROOT="." ;;
  api-ts)     URL="https://api.suwappu.bot";                            PATH_="/health";      DIRS="src";              ROOT="api-ts" ;;
  http*)      URL="$SERVICE";                                           PATH_="/health/live"; DIRS="api bot database"; ROOT="." ;;
  *) echo "usage: $0 [python-api|api-ts|<url>]"; exit 2 ;;
esac
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

local_fp="$(cd "$REPO_ROOT/$ROOT" && DIRS="$DIRS" python3 - <<'PY'
import hashlib, os, pathlib
root = pathlib.Path.cwd()
d = hashlib.sha256()
suffixes = (".ts", ".tsx") if os.environ["DIRS"] == "src" else (".py",)
for sub in os.environ["DIRS"].split():
    base = root / sub
    if not base.is_dir():
        continue
    for path in sorted(p for p in base.rglob("*") if p.suffix in suffixes and p.is_file()):
        # Filter on the RELATIVE path. Testing path.parts on the absolute path
        # excluded everything when the checkout lives under a dot-directory
        # (e.g. .claude/worktrees/...), silently hashing zero files and
        # producing sha256("") for every service.
        rel = path.relative_to(root)
        if "__pycache__" in rel.parts or "node_modules" in rel.parts:
            continue
        if any(part.startswith(".") for part in rel.parts):
            continue
        d.update(rel.as_posix().encode())
        d.update(path.read_bytes())
print(d.hexdigest()[:12])
PY
)"

remote_fp="$(curl -fsS --max-time 20 "$URL$PATH_" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin).get("source_fingerprint","missing"))')"

echo "service: $SERVICE"
echo "local:  $local_fp"
echo "remote: $remote_fp"

if [ "$local_fp" = "$remote_fp" ]; then
  echo "MATCH — deployed code is the working tree"
  exit 0
fi
if [ "$remote_fp" = "missing" ]; then
  echo "STALE — remote has no fingerprint field, so it predates this check"
  exit 1
fi
echo "MISMATCH — the deploy did not land; the running build is different code"
exit 1
