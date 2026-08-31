---
name: enterprise-parity
description: One iteration of the enterprise-dashboard parity loop — read the parity graph, pick the highest-priority READY node, implement it end-to-end (no tests), verify build, mark the node done, commit and push. Run via /loop for continuous execution toward enterprise parity, or invoke once as /enterprise-parity [node-id].
---

# Enterprise Parity Loop

Drive the enterprise dashboard to feature parity with trusted compliant crypto
platforms (Fireblocks, Coinbase Prime, Anchorage, BitGo, Chainalysis — see
`docs/plans/enterprise-dashboard.md`). Each invocation completes exactly ONE
graph node.

## State

- **Graph**: `docs/plans/enterprise-parity-graph.json` — nodes with
  `id`, `title`, `category`, `priority` (1 = highest), `deps` (node ids),
  `surface` (`api-ts` | `webapp` | `both`), `status`
  (`todo` | `in_progress` | `done` | `blocked:<reason>`), `notes`.
- **Plan**: `docs/plans/enterprise-dashboard.md` — the research + architecture
  the graph was derived from. Read it before your first node.

## Iteration protocol

1. **Load the graph.** A node is READY when `status == "todo"` and every dep
   is `done`. If an argument names a node id, use that node (deps permitting).
2. **Pick** the READY node with the lowest `priority` number. If none are
   READY, report the blocked frontier and stop the loop
   (`ScheduleWakeup stop` if running under /loop dynamic mode).
3. **Mark it** `in_progress` in the graph file and commit nothing yet.
4. **Implement** the node end-to-end per its `notes` and the plan doc.
   Route per CLAUDE.md conductor table: api-ts work → `api-ts-dev`,
   webapp work → `webapp-dev`; trivial edits directly. NO tests — this loop
   executes, it does not write test suites.
5. **Verify build only** (not tests):
   - api-ts touched → `cd api-ts && bun run check`
   - webapp touched → `cd webapp && npm run build`
   - Python touched → `python3 -c "import ast; ast.parse(open(f).read())"` per file
6. **Mark done** (or `blocked:<reason>` with what's needed), update `notes`
   with what was built and key file paths.
7. **Commit + push**: one commit per node,
   `feat(enterprise): <node-id> — <title>`, push with
   `git push -u origin claude/enterprise-dashboards-crypto-1f97xj`.
   Never rebase; merge only. No Co-Authored-By lines.
8. **Report** in ≤5 lines: node done, files touched, next READY node.

## Hard rules

- One node per iteration. Do not batch nodes even if they look small.
- A node whose deps are not `done` is never picked, whatever its priority.
- If the same node fails twice, mark it `blocked` with the reason and move on.
- MONEY-PATH nodes (anything touching wallets/keys/fees/withdrawals) get a
  `money-path-reviewer` pass before commit.
- Keep the graph file valid JSON — it is the loop's single source of truth.
