---
description: "Ship the current changes end-to-end: branch → commit → PR → CI green → merge → verify EVERY service actually deployed and booted → read logs → fix what broke. Usage: /ship [PR title]"
---

# Ship Skill

Runs the full ship loop. Two rules that outrank everything below:

1. **Do NOT merge while CI is red.**
2. **Shipping does not end at "merged."** It ends when the deployed system is
   verified running the code you merged, and its logs are clean. Steps 6-8 are
   not optional epilogue — they are where every failure this repo has actually
   hit gets caught.

Optional arg: a PR title. If omitted, infer a concise conventional-commit title
from the diff.

## Why this skill is shaped like this

Every cheap gate proves something NARROWER than what we want to conclude:

| Gate | Reads as | Actually proves |
|------|----------|-----------------|
| Railway deploy SUCCESS | the code works | a container built and started |
| A green deploy with a loose install | deps are correct | drift is *undetectable* here |
| CI green on your branch | main is green | nothing about main |
| Service status SUCCESS | running current code | some build, of some commit, sometime |
| `/health` 200 | the bot booted | *that* host answered |
| No ImportError in logs | nothing is wrong | no ImportError |

So verify the specific thing, per service, and then read the logs. Never
generalise one green signal into a claim about a different component.

## Step 0 — Pre-flight (CLAUDE.md mandatory checklist)
```bash
REPO=$(git rev-parse --show-toplevel); cd "$REPO"
git rev-parse --abbrev-ref HEAD
git rev-parse --git-common-dir              # a worktree? then NEVER rebase
ls .git/*.lock 2>/dev/null || echo "no locks"
git stash list | head
git status --short
git status --short | grep -iE "node_modules|\.next/|dist/" && echo "ARTIFACTS — gitignore first, stop" || true
git fetch origin main -q && git rev-list --left-right --count origin/main...HEAD
```
If on `main`, branch first — never commit straight to main.

## Step 1 — Format, parse, and LOCKFILE check (CI gates on all three)
```bash
PYF=$(git status --short | awk '{print $2}' | grep '\.py$')
[ -n "$PYF" ] && python3 -c "import ast; [ast.parse(open(f).read()) for f in '''$PYF'''.split()]; print('parse ok')"
[ -n "$PYF" ] && black --line-length=100 $PYF
```
**If you changed ANY `package.json`, you must regenerate its lockfile** — CI runs
`bun install --frozen-lockfile` in `showcase/`, `terminal/`, `webapp/`, `api-ts/`
and mobile. A missing lockfile update fails CI even when every deploy is green.
Use the bun version CI pins (see `.github/workflows/test.yml`) — a lockfile
written by a different bun can fail the frozen check on its own:
```bash
BUN_PIN=$(grep -m1 'bun-version:' .github/workflows/test.yml | awk '{print $2}')
npm i --no-save bun@"$BUN_PIN" >/dev/null 2>&1
for d in showcase terminal webapp api-ts; do
  [ -f "$d/bun.lock" ] || continue
  (cd "$d" && ../node_modules/.bin/bun install --frozen-lockfile >/dev/null 2>&1) \
    && echo "$d lockfile OK" || echo "$d LOCKFILE DRIFT — run: (cd $d && bun install) and commit"
done
```

## Step 2 — Commit + push
```bash
HUSKY=0 git add -A
HUSKY=0 git commit -q -m "<conventional title>

<what + why>"
# NO Co-Authored-By lines (CLAUDE.md). HUSKY=0 avoids hook hangs.
HUSKY=0 git push -u origin HEAD 2>&1 | tail -2
```

## Step 3 — Open the PR
```bash
gh pr create --title "<title>" --body "<what / why / verification>" 2>&1 | tail -1
```

## Step 4 — Wait for CI GREEN
```bash
RUN=$(gh run list --branch "$(git branch --show-current)" --workflow "Tests & Quality Gates" --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch "$RUN" --exit-status >/dev/null 2>&1; echo "exit=$?"
gh run view "$RUN" --json conclusion,jobs --jq '{conclusion, jobs: [.jobs[] | "\(.conclusion)  \(.name)"]}'
```
**If red:** `gh run view $RUN --log-failed`, report, STOP. Do not merge.

Some failures in this repo are known and pre-existing (aegis / nl_intent /
llm_budget). Prove it rather than assuming it: check whether the SAME job is
red on an unrelated recent branch. If it is only red on yours, it is yours.

## Step 5 — Merge, sync, and RE-CHECK CI ON MAIN
```bash
gh pr merge <PR#> --merge 2>&1 | tail -1
git checkout main && HUSKY=0 git pull --no-rebase origin main 2>&1 | tail -1
```
Branch-green does not imply main-green — the merge commit is a state CI has
never run against. Watch the run on `main` too, and treat red there exactly like
Step 4: report and fix. Do not walk away at the merge.

## Step 6 — Verify each service DEPLOYED THE COMMIT YOU MERGED
Use the Railway MCP (`list-deployments` / `get-status`) or the CLI. For **every**
service the change could touch — `python-api`, `python-worker`, `api-ts`,
`showcase`, `terminal`, `webapp` — confirm all three, per service:

1. **A new deployment exists** whose `commitHash` is the SHA you just merged.
   A service showing SUCCESS from an old commit is NOT deployed. `python-worker`
   sat 10 days behind because its GitHub source had no branch binding: no push
   ever triggered it, and its last-good deploy read as healthy the whole time.
   A build that never ran looks identical to success unless you check the SHA.
2. **Status is SUCCESS**, not FAILED/SKIPPED/CRASHED. SKIPPED is correct when
   watch patterns exclude the change — confirm that is why, don't assume.
3. **If FAILED, read the BUILD logs**, not just deploy logs. Build failures
   (lockfile drift, missing context, bad Dockerfile path) never reach deploy logs
   at all.

Then check health — note the host per service:
```bash
# The Python BOT (has no custom prod domain). api.suwappu.bot is api-ts, NOT the bot.
curl -s https://python-api-production-8526.up.railway.app/health | python3 -m json.tool
curl -s https://api.suwappu.bot/health          # api-ts
```
Assert on the payload, not just the 200:
- `source_fingerprint` **changed** from its pre-deploy value (proves new code).
- `worker_fingerprint` matches `source_fingerprint` (proves api and worker agree).
- `degraded` is `[]`.
- every entry in `background_services` is `alive` — not `unknown`, `dead`, or
  `starting`. Capture the pre-deploy values first so you can tell "changed" from
  "was always like that."

## Step 7 — READ THE LOGS, then DEBUG and FIX
Green status is not clean logs. Pull logs for each deployed service and triage —
this step is mandatory even when everything above is green.

```bash
# Railway MCP get-logs, or:
railway logs --service python-api  | tail -300
railway logs --service python-worker | tail -300
```
Grep at minimum for: `ImportError|ModuleNotFound|cannot import|Traceback|CRITICAL|FAILED`.
Then actually READ a sample — the fatal-error grep is the floor, not the ceiling.

Triage what you find into three buckets and act on each:

- **Fatal** — `ImportError`, `ModuleNotFound`, `cannot import name`, crashloop,
  unhandled `Traceback` at startup. The service did not start. Fix now or revert.
- **Storm** — the same warning repeating many times per minute (rate limits,
  circuit trips, retries). Not fatal, and easy to scroll past, but it is burning
  quota or wedging a background loop. Two real ones: a quota error classified as
  transient re-probed forever; a contract revert classified as an endpoint
  failure knocked healthy RPCs offline. Ask which component logs it — a fix in
  `rpc_manager` does nothing for a path in `wallet.py` that never calls it.
- **Benign** — `telegram getUpdates 200 OK`, a transient `Conflict` during
  rollover. Say why it is benign; do not silently drop it.

**Then fix.** A finding you only report is not shipped. For anything you caused,
fix it in this same session and re-run from Step 1. Bound the loop: after two
failed fix attempts on the same failure, STOP and ask (CLAUDE.md).

Compare against the PREVIOUS deployment's logs where you can. "Is this new?" is
usually faster to answer than "is this bad?", and it tells you whether you caused it.

## Step 8 — Report honestly
State, per service: deployed SHA, status, health payload deltas
(`source_fingerprint`, `worker_fingerprint`, `degraded`, background services),
and the log verdict. Then:

- Anything you found and did NOT fix — name it and say why.
- Pre-existing problems the logs surfaced — list them; they are findings, not noise.
- If the change moves money or sends messages, say whether a real end-to-end test
  ran. If it did not: **"code-complete, not functionally verified — needs X."**
  Never report "deployed" from a status page alone.
