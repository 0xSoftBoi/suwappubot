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

URL="${1:-https://python-api-production-8526.up.railway.app}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

local_fp="$(cd "$REPO_ROOT" && python3 - <<'PY'
import hashlib, pathlib
root = pathlib.Path.cwd()
d = hashlib.sha256()
for sub in ("api", "bot", "database"):
    base = root / sub
    if not base.is_dir():
        continue
    for path in sorted(base.rglob("*.py")):
        if "__pycache__" in path.parts:
            continue
        d.update(path.relative_to(root).as_posix().encode())
        d.update(path.read_bytes())
print(d.hexdigest()[:12])
PY
)"

remote_fp="$(curl -fsS --max-time 20 "$URL/health/live" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin).get("source_fingerprint","missing"))')"

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
