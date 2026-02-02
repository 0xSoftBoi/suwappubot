#!/usr/bin/env bash
set -euo pipefail

# worktree-setup.sh -- Bootstrap a fresh git worktree for Suwappu development.
# Usage: scripts/worktree-setup.sh [worktree-dir]
#
# If no directory is given, the script bootstraps the current directory.
# Idempotent -- safe to run multiple times.

WORKTREE_DIR="${1:-.}"
WORKTREE_DIR="$(cd "$WORKTREE_DIR" && pwd)"

GIT_COMMON="$(git -C "$WORKTREE_DIR" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"
if [[ -z "$GIT_COMMON" ]]; then
  echo "Error: $WORKTREE_DIR is not inside a git repository." >&2
  exit 1
fi

# Detect bare repo vs regular repo for locating .env files
if git -C "$GIT_COMMON" rev-parse --is-bare-repository &>/dev/null && \
   [[ "$(git -C "$GIT_COMMON" rev-parse --is-bare-repository)" == "true" ]]; then
  # Bare repo: .env lives in the main worktree, not the bare repo itself
  MAIN_WORKTREE="$(dirname "$GIT_COMMON")/worktrees/main"
else
  # Regular repo: .env lives in the repo root
  MAIN_WORKTREE="$(echo "$GIT_COMMON" | sed 's|/\.git$||')"
fi

echo "==> Bootstrapping worktree: $WORKTREE_DIR"
echo "    Main worktree: $MAIN_WORKTREE"

# ── Python venv + deps ───────────────────────────────────────────────
if [[ -f "$WORKTREE_DIR/requirements.txt" ]]; then
  if [[ ! -d "$WORKTREE_DIR/.venv" ]]; then
    echo "==> Creating Python virtualenv..."
    python3 -m venv "$WORKTREE_DIR/.venv"
  fi
  echo "==> Installing Python dependencies..."
  "$WORKTREE_DIR/.venv/bin/pip" install -q -r "$WORKTREE_DIR/requirements.txt"
else
  echo "    (no requirements.txt -- skipping Python setup)"
fi

# ── .env file ────────────────────────────────────────────────────────
if [[ ! -f "$WORKTREE_DIR/.env" ]]; then
  if [[ -f "$MAIN_WORKTREE/.env" ]]; then
    echo "==> Copying .env from main worktree..."
    cp "$MAIN_WORKTREE/.env" "$WORKTREE_DIR/.env"
  elif [[ -f "$MAIN_WORKTREE/.env.dev" ]]; then
    echo "==> Copying .env.dev from main worktree..."
    cp "$MAIN_WORKTREE/.env.dev" "$WORKTREE_DIR/.env"
  elif [[ -f "$MAIN_WORKTREE/env.example" ]]; then
    echo "==> Copying env.example as .env (edit with real values)..."
    cp "$MAIN_WORKTREE/env.example" "$WORKTREE_DIR/.env"
  else
    echo "    (no .env or env.example found -- skipping)"
  fi
else
  echo "    (.env already exists -- skipping)"
fi

# ── Node / Bun deps ─────────────────────────────────────────────────
install_node_deps() {
  local dir="$1"
  local label="$2"
  if [[ -f "$dir/package.json" ]]; then
    echo "==> Installing $label node dependencies..."
    if command -v bun &>/dev/null; then
      (cd "$dir" && bun install --no-save 2>/dev/null) || true
    elif command -v npm &>/dev/null; then
      (cd "$dir" && npm install --no-save 2>/dev/null) || true
    fi
  fi
}

install_node_deps "$WORKTREE_DIR" "root"
install_node_deps "$WORKTREE_DIR/dashboard" "dashboard"
install_node_deps "$WORKTREE_DIR/webapp" "webapp"

# ── C++ extension build (best-effort) ───────────────────────────────
if [[ -f "$WORKTREE_DIR/setup.py" || -f "$WORKTREE_DIR/CMakeLists.txt" ]]; then
  echo "==> Attempting C++ extension build (best-effort)..."
  (cd "$WORKTREE_DIR" && "$WORKTREE_DIR/.venv/bin/python" setup.py build_ext --inplace 2>/dev/null) || echo "    (C++ build skipped or failed -- non-blocking)"
fi

echo ""
echo "Done! Worktree is ready at: $WORKTREE_DIR"
