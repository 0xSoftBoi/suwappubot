---
description: "Orchestrate N parallel agents for a feature. Args: <count> <task description>"
---

# Team Build — Modular Multi-Agent Orchestration

Spin up 1–6+ agents with automatic role assignment, file boundaries, and dependency ordering.

## Input Format

The user provides: `<count> <task description>`

Examples:
- `/team-build 3 add limit orders feature`
- `/team-build 1 fix the token search bug`
- `/team-build 5 implement portfolio analytics with charts, export, alerts, caching, and tests`
- `/team-build 6 full rewrite of swap flow end to end`

If no count is given, analyze the task and pick the right number.

## Agent Roster

Pick agents from this roster based on count and task needs. **Order matters — earlier agents are higher priority.**

| Slot | Role | Owns | Must NOT touch |
|------|------|------|----------------|
| 1 | **backend** | `api-ts/src/services/`, `api-ts/src/db/`, `api-ts/src/config/`, `api-ts/src/lib/` | `routes/`, `middleware/`, `webapp/` |
| 2 | **routes** | `api-ts/src/routes/`, `api-ts/src/middleware/` | `services/`, `db/`, `webapp/` |
| 3 | **frontend** | `webapp/src/` | `api-ts/` |
| 4 | **shared-types** | `packages/shared/src/`, `webapp/src/types/` | Application logic |
| 5 | **bot** | `bot/`, `api/`, `database/` | `api-ts/`, `webapp/` |
| 6 | **infra** | `infra/`, `.github/`, `Dockerfile`, `docker-compose*.yml` | Application code |
| 7 | **showcase** | `showcase/` | Everything else |
| 8 | **tests** | `tests/`, `api-ts/src/__tests__/`, `webapp/src/**/*.test.*` | Non-test source files |
| 9 | **docs** | `docs/`, `README.md`, `CHANGELOG.md` | Source code |

## Auto-Assignment Rules

Based on the count, pick the most relevant roles for the task:

### 1 agent
Assign the single most relevant role. No worktree needed — work directly on main.

### 2 agents
Pick the two most relevant. Common combos:
- **backend + frontend** (API change + UI)
- **backend + routes** (service + endpoint)
- **bot + infra** (Python feature + deploy)

### 3 agents (most common)
Standard full-stack:
- **backend → routes → frontend**
- Dependencies: routes blocked by backend, frontend blocked by routes

### 4 agents
Full-stack + types:
- **shared-types → backend → routes → frontend**
- shared-types runs first (alone), then backend+routes parallel, then frontend

### 5 agents
Full-stack + testing + one specialist:
- **shared-types → backend + routes (parallel) → frontend → tests**
- Or swap tests for bot/infra/showcase depending on task

### 6+ agents
All hands. Assign from roster based on what the task touches. Maximize parallelism by grouping independent domains:
- **Wave 1** (no deps): shared-types, bot, infra, showcase, docs
- **Wave 2** (after types): backend, routes
- **Wave 3** (after routes): frontend, tests

## Dependency Graph

```
shared-types ─────────────────────┐
    ↓                             ↓
backend ──→ routes ──→ frontend   │
    ↓          ↓          ↓       │
    └──────────┴──────────┴──→ tests

bot ────┐
infra ──┤  (independent — run in any wave)
showcase┤
docs ───┘
```

Rules:
- **routes** always depends on **backend** (needs service interfaces)
- **frontend** always depends on **routes** (needs API contract)
- **tests** depends on whatever it's testing
- **bot**, **infra**, **showcase**, **docs** are independent — run in parallel with anything

## Execution Steps

For the orchestrator (you):

### Step 1: Parse and plan
```
Count: {N from user input}
Task: {description}
Selected roles: {pick N roles from roster}
Dependencies: {which blocks which}
```

Present this plan and get user approval before spawning.

### Step 2: Spawn the team
For each agent, use worktree isolation:

```
Create an agent team called "{task-slug}" with {N} teammates:

{For each selected role:}
- **{role}** (worktree isolation)
  - Owns: {directories from roster}
  - Must NOT touch: {exclusions from roster}
  - Blocked by: {dependency list, or "none"}
  - Task: {specific task for this role}
  - Require plan approval
```

### Step 3: Approve plans
Review each agent's plan before they start coding. Check for:
- File boundary violations
- Shared type consistency
- Missing imports/exports at integration points

### Step 4: Monitor
- Watch for idle notifications
- Check task completion
- Redirect agents that drift outside their boundaries

### Step 5: Merge
Merge worktree branches in dependency order:
1. shared-types (if present)
2. backend
3. routes
4. frontend
5. tests, bot, infra, etc.

Run after each merge:
```bash
cd api-ts && bun run check
cd webapp && npx tsc --noEmit
bash .claude/scripts/verify-shared-types.sh
```

## Critical Shared Files

These files sit at integration boundaries. If multiple agents need them, assign ONE owner and have others depend on that task:

| File | Default owner | Why |
|------|--------------|-----|
| `packages/shared/src/types/*.ts` | shared-types (or backend if no types agent) | Source of truth for all TS packages |
| `webapp/src/types/*.ts` | frontend (must mirror shared) | Consumed by webapp |
| `api-ts/src/routes/index.ts` | routes | Barrel file for route exports |
| `api-ts/src/app.ts` | routes | Route mounting |
| `api-ts/src/middleware/index.ts` | routes | Middleware exports |

## Quick Reference

| Count | Typical pattern | Parallelism |
|-------|----------------|-------------|
| 1 | Solo agent, no worktree | None |
| 2 | Two specialists, parallel | Full parallel |
| 3 | backend → routes → frontend | Sequential chain |
| 4 | types first, then 3-chain | 1 + chain |
| 5 | types → backend+routes parallel → frontend → tests | Waves |
| 6+ | Full roster, max parallelism | 3 waves |
