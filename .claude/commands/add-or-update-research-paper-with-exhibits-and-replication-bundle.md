---
name: add-or-update-research-paper-with-exhibits-and-replication-bundle
description: Workflow command scaffold for add-or-update-research-paper-with-exhibits-and-replication-bundle in suwappubot.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /add-or-update-research-paper-with-exhibits-and-replication-bundle

Use this workflow when working on **add-or-update-research-paper-with-exhibits-and-replication-bundle** in `suwappubot`.

## Goal

Publishes a new research paper (or updates an existing one) to the /research section, including SVG exhibits, per-paper metadata, and optionally a full replication bundle with code, data, and working paper. Updates site routes, content index, and ensures figures render and are downloadable.

## Common Files

- `showcase/public/research/*.svg`
- `showcase/public/research/replication/papers/*.md`
- `showcase/public/research/replication/code/*.py`
- `showcase/public/research/replication/data/**/*.json`
- `showcase/public/research/replication/data/**/*.csv`
- `showcase/src/content/research.ts`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Add or update SVG exhibit(s) in showcase/public/research/
- Add or update research post markdown and metadata in showcase/public/research/replication/papers/
- Add or update code and data for replication in showcase/public/research/replication/code/ and showcase/public/research/replication/data/
- Update research index/content in showcase/src/content/research.ts
- Update or create route files for the paper in showcase/src/app/research/[slug]/page.tsx and/or showcase/src/app/research/replication/page.tsx

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.