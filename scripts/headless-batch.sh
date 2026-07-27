#!/usr/bin/env bash
# Bounded headless Claude runs — one invocation per unit of work, results on disk.
#
# Why: interactive audits and dependency sweeps repeatedly died at a spend limit
# mid-session, losing everything. Each headless run here is small and writes its
# own output file, so an interruption costs one unit, not the whole batch.
#
# Usage:
#   scripts/headless-batch.sh audit 'api-ts/src/routes/*.ts'
#   scripts/headless-batch.sh deps
set -uo pipefail

MODE="${1:-}"
OUT_DIR="${OUT_DIR:-.audit}"

case "$MODE" in
  audit)
    PATTERN="${2:?usage: headless-batch.sh audit '<git-ls-files pattern>'}"
    mkdir -p "$OUT_DIR/findings"
    # Deliberately NOT parallel: concurrent headless sessions have exhausted RAM
    # on this machine before. Serial and resumable beats fast and dead.
    for f in $(git ls-files "$PATTERN"); do
      dest="$OUT_DIR/findings/$(echo "$f" | tr '/' '_').jsonl"
      [ -s "$dest" ] && { echo "skip (done): $f"; continue; }   # resumable
      echo "audit: $f"
      claude -p "/audit $f" --allowedTools "Read,Grep,Glob,Write" > "$dest" || {
        echo "WARN: run failed for $f — leaving $dest for retry" >&2
      }
    done
    echo "findings in $OUT_DIR/findings/"
    ;;

  deps)
    claude -p "Check all open Dependabot PRs. Merge the green ones. For the failing ones, actually fix CI rather than reporting them as blocked — only stop if a fix needs a product decision or a secret you don't have. Report per-PR: merged / fixed-then-merged / blocked-with-reason." \
      --allowedTools "Bash,Read,Edit,Grep,Glob"
    ;;

  *)
    echo "usage: $0 {audit <pattern>|deps}" >&2
    exit 2
    ;;
esac
