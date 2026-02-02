#!/usr/bin/env bash
set -euo pipefail

# migrate-to-bare.sh -- One-time migration from regular clone to bare clone workflow.
#
# Before:
#   ~/Desktop/suwappumain/suwappubot/       (regular clone, main branch)
#   ~/Desktop/suwappumain/worktrees/<name>/ (feature worktrees)
#
# After:
#   ~/Desktop/suwappumain/suwappubot.git/   (bare clone, no working files)
#   ~/Desktop/suwappumain/worktrees/main/   (main branch worktree)
#   ~/Desktop/suwappumain/worktrees/<name>/ (feature worktrees)

OLD_REPO="$HOME/Desktop/suwappumain/suwappubot"
BARE_REPO="$HOME/Desktop/suwappumain/suwappubot.git"
WORKTREE_BASE="$HOME/Desktop/suwappumain/worktrees"

# ── Pre-flight checks ────────────────────────────────────────────────

if [[ ! -d "$OLD_REPO/.git" ]]; then
  echo "Error: $OLD_REPO is not a regular git repository." >&2
  exit 1
fi

if [[ -d "$BARE_REPO" ]]; then
  echo "Error: $BARE_REPO already exists. Remove it first if you want to re-run migration." >&2
  exit 1
fi

if [[ -d "$WORKTREE_BASE/main" ]]; then
  echo "Error: $WORKTREE_BASE/main already exists. Remove it first if you want to re-run migration." >&2
  exit 1
fi

# Check for uncommitted changes in old repo
if [[ -n "$(git -C "$OLD_REPO" status --porcelain 2>/dev/null | grep -v '^??' || true)" ]]; then
  echo "Warning: You have uncommitted changes in $OLD_REPO."
  echo "These will NOT be carried over to the bare clone."
  read -r -p "Continue anyway? [y/N] " answer
  if [[ ! "$answer" =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 1
  fi
fi

# Get the remote URL from the old repo
REMOTE_URL="$(git -C "$OLD_REPO" remote get-url origin 2>/dev/null || true)"
if [[ -z "$REMOTE_URL" ]]; then
  echo "Error: No 'origin' remote found in $OLD_REPO." >&2
  exit 1
fi

echo "==> Migration: regular clone -> bare clone"
echo "    Old repo:     $OLD_REPO"
echo "    Remote:       $REMOTE_URL"
echo "    Bare clone:   $BARE_REPO"
echo "    Main worktree: $WORKTREE_BASE/main"
echo ""

# ── Step 1: Create bare clone ────────────────────────────────────────

echo "==> Step 1: Creating bare clone from remote..."
git clone --bare "$REMOTE_URL" "$BARE_REPO"

# Configure the bare repo to fetch all branches properly
git -C "$BARE_REPO" config remote.origin.fetch "+refs/heads/*:refs/remotes/origin/*"

# Fetch to populate remote tracking refs
echo "==> Fetching remote branches..."
git -C "$BARE_REPO" fetch origin

echo "    Bare clone created at $BARE_REPO"

# ── Step 2: Create main worktree ─────────────────────────────────────

echo "==> Step 2: Creating main worktree..."
mkdir -p "$WORKTREE_BASE"
git -C "$BARE_REPO" worktree add "$WORKTREE_BASE/main" main

echo "    Main worktree created at $WORKTREE_BASE/main"

# ── Step 3: Copy non-tracked files ───────────────────────────────────

echo "==> Step 3: Copying non-tracked files from old repo..."

for envfile in .env .env.dev .env.local .env.production; do
  if [[ -f "$OLD_REPO/$envfile" ]]; then
    cp "$OLD_REPO/$envfile" "$WORKTREE_BASE/main/$envfile"
    echo "    Copied $envfile"
  fi
done

# ── Step 4: Bootstrap main worktree ──────────────────────────────────

echo "==> Step 4: Bootstrapping main worktree..."
BOOTSTRAP="$WORKTREE_BASE/main/scripts/worktree-setup.sh"
if [[ -f "$BOOTSTRAP" ]]; then
  bash "$BOOTSTRAP" "$WORKTREE_BASE/main"
else
  echo "    (bootstrap script not found -- skipping)"
fi

# ── Step 5: Re-add existing feature worktrees ────────────────────────

echo "==> Step 5: Checking for existing feature worktrees to re-register..."

# List worktrees from old repo (skip the main repo entry itself)
while IFS= read -r line; do
  wt_path=$(echo "$line" | awk '{print $1}')
  branch=$(echo "$line" | sed -n 's/.*\[//;s/\].*//p')

  # Skip the old main repo entry and any bare entries
  [[ "$wt_path" == "$OLD_REPO" ]] && continue
  [[ -z "$branch" ]] && continue
  [[ "$branch" == "main" ]] && continue

  # If this worktree still exists in WORKTREE_BASE, re-register it
  if [[ -d "$wt_path" && "$wt_path" == "$WORKTREE_BASE/"* ]]; then
    echo "    Found existing worktree: $branch at $wt_path"
    echo "    Note: You'll need to re-create this worktree with 'sw new $branch' after migration."
  fi
done < <(git -C "$OLD_REPO" worktree list 2>/dev/null || true)

# ── Done ──────────────────────────────────────────────────────────────

echo ""
echo "============================================"
echo "  Migration complete!"
echo "============================================"
echo ""
echo "Next steps:"
echo ""
echo "  1. Reload your shell (or run: source ~/.zshrc)"
echo ""
echo "  2. Verify everything works:"
echo "       cd $WORKTREE_BASE/main"
echo "       sw ls"
echo "       sw new test-bare"
echo "       sw rm test-bare"
echo ""
echo "  3. Once you're satisfied, remove the old repo:"
echo "       rm -rf $OLD_REPO"
echo ""
echo "  4. If you had feature worktrees, re-create them:"
echo "       sw new <branch-name>"
echo ""
