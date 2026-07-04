# Suwappu Agent Skills

This directory contains [Agent Skills](https://agentskills.io) — portable, model-agnostic
instruction packages that teach an AI agent (Claude, or any other agent runtime that supports the
`SKILL.md` convention) how to use Suwappu's API.

## Contents

- [`suwappu/`](./suwappu/) — the primary skill. Teaches an agent to self-register for an API key,
  authenticate, get swap quotes, execute swaps (self-signed or managed), check status, handle
  `402` payment-required (x402 top-up), handle rate limits, and recover from errors. API-first
  (plain `curl`/REST) with pointers to the TypeScript/Python SDKs and MCP server for deeper
  integration. See `suwappu/SKILL.md` and `suwappu/references/endpoints.md`.

## Install

### Option A — `npx skills add` (if your skills-repo host supports monorepo paths)

The [vercel-labs/skills](https://github.com/vercel-labs/skills) installer's primary supported
pattern is one skill (or a `skills/` folder) **per dedicated repo**, referenced as
`owner/repo[/optional-subpath]`. For this monorepo, try:

```bash
npx skills add 0xSoftBoi/suwappubot --skill suwappu
```

If your installed version of the `skills` CLI doesn't resolve a `skills/` subdirectory inside a
larger repo (some versions expect the skill at the repo root), it will fail to find `suwappu`.
**Verify against your installed CLI version before relying on this in a script or CI** — behavior
here has changed across `skills` CLI releases. If it doesn't work, use the manual install below.

**Planned follow-up**: publish a standalone `suwappu/skills` (or `0xSoftBoi/suwappu-skills`) repo
that mirrors this directory at its root, so `npx skills add 0xSoftBoi/suwappu-skills` works
unconditionally regardless of installer version. Until that exists, prefer the manual install for
anything automated.

### Option B — manual install (always works)

Claude Code / Claude apps read skills from `~/.claude/skills/<skill-name>/`:

```bash
mkdir -p ~/.claude/skills
cp -r skills/suwappu ~/.claude/skills/suwappu
```

For a project-local skill instead of a global one, copy into `.claude/skills/` at the root of the
consuming project. Other agent runtimes that support the `SKILL.md` convention typically expose an
equivalent local skills directory — check that runtime's docs for the exact path, then copy
`skills/suwappu/` (including `references/`) into it the same way.

### Option C — point an agent at the raw file

Agents that can fetch URLs can be pointed directly at the raw `SKILL.md` on GitHub and told to
follow it, without any local install:

```
https://raw.githubusercontent.com/0xSoftBoi/suwappubot/main/skills/suwappu/SKILL.md
```

(This works for a quick one-off session; a real install via Option A/B is preferred so
`references/` resolves correctly and the skill persists across sessions.)

## Spec compliance

Each skill directory follows the [agentskills.io](https://agentskills.io) spec:

- `SKILL.md` with YAML frontmatter (`name` matching the directory in kebab-case, a `description`
  stating what the skill does and when to use it, and a `license`).
- Body kept under ~500 lines using **progressive disclosure** — anything long (full endpoint
  parameter tables, etc.) lives in `references/` and is linked from `SKILL.md`, not inlined.
