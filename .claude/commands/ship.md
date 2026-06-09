---
description: "Ship the current changes end-to-end: branch → commit → PR → wait for CI green → merge → verify the bot actually boots. Usage: /ship [PR title]"
---

# Ship Skill

Runs the full ship loop that's otherwise done by hand every time. **Do NOT merge while CI is red, and do NOT declare success until the bot is verified booting in production** (CI green ≠ bot starts — see `bot-boots-not-just-ci`).

Optional arg: a PR title. If omitted, infer a concise conventional-commit title from the diff.

## Step 0 — Pre-flight (CLAUDE.md mandatory checklist)
```bash
cd /Users/toma/suwappubot
git rev-parse --abbrev-ref HEAD              # branch
git rev-parse --git-common-dir              # worktree? (if a worktree, NEVER rebase)
ls .git/*.lock 2>/dev/null || echo "no locks"
git status --short                           # uncommitted work + stray artifacts
git status --short | grep -iE "node_modules|\.next/|dist/" && echo "ARTIFACTS — stop, gitignore first" || true
```
If on `main`, create a feature branch first (never commit straight to main):
```bash
git checkout -b feat/<short-slug>
```

## Step 1 — Format + parse-check the changed files (CI gates on these)
```bash
PYF=$(git status --short | awk '{print $2}' | grep '\.py$')
# Python files must parse and be black-clean (CI runs: black --check --line-length=100 bot/ api/ tests/)
[ -n "$PYF" ] && python3 -c "import ast,sys; [ast.parse(open(f).read()) for f in '''$PYF'''.split()]; print('parse ok')"
[ -n "$PYF" ] && .venv/bin/python -m black --line-length=100 $PYF
# If TS in api-ts changed: cd api-ts && bun run check
```
If anything fails to parse, fix it before continuing.

## Step 2 — Commit + push
```bash
HUSKY=0 git add -A
HUSKY=0 git commit -q -m "<conventional title>

<short body: what + why>"
# NO Co-Authored-By lines (CLAUDE.md). Use HUSKY=0 to avoid hook hangs.
HUSKY=0 git push -u origin HEAD 2>&1 | tail -2
```

## Step 3 — Open the PR
```bash
gh pr create --title "<title>" --body "<what / why / verification>" 2>&1 | tail -1
```

## Step 4 — Wait for CI GREEN (do not skip)
```bash
sleep 25
RUN=$(gh run list --branch "$(git branch --show-current)" --workflow "Tests & Quality Gates" --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch "$RUN" --exit-status >/dev/null 2>&1; echo "exit=$?"
gh run view "$RUN" --json conclusion,jobs --jq '{conclusion, jobs: [.jobs[] | "\(.conclusion)  \(.name)"]}'
```
**If red:** pull the failing logs (`gh run view $RUN --log-failed`), report them, and STOP. Do not merge.

## Step 5 — Merge + sync main
```bash
gh pr merge <PR#> --merge 2>&1 | tail -1
git checkout main && HUSKY=0 git pull --no-rebase origin main 2>&1 | tail -1
```

## Step 6 — Verify the bot BOOTS (the real check)
```bash
export PATH="/Users/toma/.local/node/bin:$PATH"
until [ "$(curl -s -o /dev/null -w '%{http_code}' https://api.suwappu.bot/health 2>/dev/null)" = "200" ]; do sleep 10; done
sleep 80   # let the new build roll past the old instance
railway logs --service python-api 2>/dev/null | tail -150 | grep -iE "Application startup complete|ImportError|ModuleNotFound|cannot import" | tail -5
railway logs --service python-api 2>/dev/null | tail -200 | grep -iE "ImportError|ModuleNotFoundError|cannot import name" | tail -2 || echo "✓ no import errors"
curl -s -o /dev/null -w "health=%{http_code}\n" https://api.suwappu.bot/health
```
`telegram getUpdates 200 OK` lines and a transient `Conflict` during rollover are normal/self-healing. An `ImportError`/`ModuleNotFound` is NOT — that means the bot didn't start; investigate before declaring done.

## Step 7 — Report
PR#, CI result, merge, and the boot verdict (health 200 + zero import errors). If the change is an integration that *sends* or *moves money*, note whether a real end-to-end test was done (see `verify-functionally-not-just-structurally`).
