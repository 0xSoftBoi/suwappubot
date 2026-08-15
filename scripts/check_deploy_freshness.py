#!/usr/bin/env python3
"""Fail when production is not running the code on `main`.

Why this exists
---------------
On 2026-08-15 python-worker ran three-week-old code for hours while every
signal said healthy: the Railway deploy reported SUCCESS, `/health` returned
`ready: true`, and the deployment was listed as the latest. The stale build was
only found by SSH-ing into the container and diffing file sizes by hand.

Two independent faults produced it, and either alone would have been enough:

1. `railway up` archives from the repository's MAIN checkout, not the git
   worktree it is invoked from. That checkout sat on a three-week-old WIP
   branch, so the CLI happily built and shipped it.
2. python-worker never auto-deployed from GitHub. It is the only service with
   `RAILWAY_CONFIG_FILE` set, so it is the only one that actually applies the
   `watchPatterns` in its railway.*.json — and those patterns did not match the
   merge that touched `bot/services/rpc_manager.py`. python-api has no
   `RAILWAY_CONFIG_FILE`, silently ignores its config file, and therefore
   rebuilds on every push, which is why it was never stale.

Fixing both causes is necessary but not sufficient: the next stale deploy will
have a third cause. What was actually missing is that nothing ever *compared*
what is running against what was merged.

The app already computes `_compute_source_fingerprint()` — a SHA-256 over
api/, bot/ and database/ — and publishes it on /health as `source_fingerprint`,
with the worker's own build echoed as `worker_fingerprint` via Redis. Nothing
consumed them. This script recomputes that hash from a git ref and compares.

Because it re-implements the hash, it deliberately mirrors
`api/main.py::_compute_source_fingerprint`. If that function changes, this must
change with it — `test_deploy_freshness.py` pins the two together so the pair
cannot drift silently.

Usage
-----
    python3 scripts/check_deploy_freshness.py                  # against origin/main
    python3 scripts/check_deploy_freshness.py --ref HEAD
    python3 scripts/check_deploy_freshness.py --json

Exit codes: 0 fresh, 1 stale (or unreachable), 2 usage/setup error.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
import urllib.error
import urllib.request

# Must match api/main.py::_compute_source_fingerprint.
HASHED_DIRS = ("api", "bot", "database")
FINGERPRINT_LEN = 12

DEFAULT_HEALTH_URL = "https://python-api-production-8526.up.railway.app/health"


def expected_fingerprint(ref: str) -> str:
    """Recompute the app's source fingerprint from a git ref.

    Reads blobs out of the ref rather than the working tree, so an unrelated
    local edit (or a worktree on the wrong branch — the exact trap that caused
    the incident) cannot make a stale deploy look fresh.
    """
    try:
        listing = subprocess.run(
            ["git", "ls-tree", "-r", "--name-only", ref],
            capture_output=True,
            text=True,
            check=True,
        ).stdout.splitlines()
    except subprocess.CalledProcessError as e:
        print(f"error: cannot read git ref {ref!r}: {e.stderr.strip()}", file=sys.stderr)
        raise SystemExit(2)

    paths = sorted(
        p
        for p in listing
        if p.endswith(".py")
        and p.split("/", 1)[0] in HASHED_DIRS
        and "__pycache__" not in p.split("/")
    )

    digest = hashlib.sha256()
    for path in paths:
        blob = subprocess.run(
            ["git", "show", f"{ref}:{path}"], capture_output=True, check=True
        ).stdout
        digest.update(path.encode())
        digest.update(blob)
    return digest.hexdigest()[:FINGERPRINT_LEN]


def fetch_health(url: str, timeout: int = 20) -> dict:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return json.loads(r.read().decode())
    except (urllib.error.URLError, OSError, ValueError) as e:
        print(f"error: cannot reach {url}: {type(e).__name__}", file=sys.stderr)
        raise SystemExit(1)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--ref", default="origin/main", help="git ref that SHOULD be deployed")
    ap.add_argument("--url", default=DEFAULT_HEALTH_URL, help="health endpoint to probe")
    ap.add_argument("--json", action="store_true", help="machine-readable output")
    args = ap.parse_args()

    want = expected_fingerprint(args.ref)
    health = fetch_health(args.url)

    api_fp = health.get("source_fingerprint")
    worker_fp = health.get("worker_fingerprint")

    # "unknown" means the worker has not published a build in 24h — that is a
    # missing signal, not a match, and must never be treated as fresh.
    results = {
        "expected": want,
        "ref": args.ref,
        "api": {"fingerprint": api_fp, "fresh": api_fp == want},
        "worker": {"fingerprint": worker_fp, "fresh": worker_fp == want},
    }
    stale = [name for name in ("api", "worker") if not results[name]["fresh"]]

    if args.json:
        print(json.dumps({**results, "stale": stale}, indent=2))
    else:
        print(f"expected ({args.ref}): {want}")
        for name in ("api", "worker"):
            r = results[name]
            print(f"  {name:<7} {str(r['fingerprint']):<14} {'FRESH' if r['fresh'] else 'STALE'}")

    if stale:
        print(
            f"\n✗ running code does not match {args.ref}: {', '.join(stale)}.\n"
            "  A green Railway deploy is not proof the new code is live.\n"
            "  Do NOT deploy with `railway up` from a git worktree — it archives the\n"
            "  repository's main checkout, not the worktree. Deploy from a clean\n"
            "  export instead:\n"
            "      git archive origin/main | tar -x -C /tmp/deploy\n"
            "      cd /tmp/deploy && railway up --ci --service <svc> \\\n"
            "          --project $RAILWAY_PROJECT_ID --environment $RAILWAY_ENVIRONMENT_ID",
            file=sys.stderr,
        )
        return 1

    print("\n✓ production matches", args.ref)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
