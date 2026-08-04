---
name: sitewide-research-section-corrections-and-metadata-improvements
description: Workflow command scaffold for sitewide-research-section-corrections-and-metadata-improvements in suwappubot.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /sitewide-research-section-corrections-and-metadata-improvements

Use this workflow when working on **sitewide-research-section-corrections-and-metadata-improvements** in `suwappubot`.

## Goal

Performs corrections to published research posts (fact, data, or attribution), updates canonical URLs and SEO metadata, and may update markdown rendering or client-side sanitization to support new content types (e.g., images/figures).

## Common Files

- `showcase/public/research/*.svg`
- `showcase/public/research/replication/papers/*.md`
- `showcase/src/content/research.ts`
- `showcase/src/app/docs/[section]/[slug]/markdown.ts`
- `showcase/src/components/docs/DocsReader.tsx`
- `showcase/src/app/layout.tsx`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Edit research post content and metadata in showcase/public/research/replication/papers/ and showcase/src/content/research.ts
- Update or correct SVG exhibits in showcase/public/research/
- Update markdown renderer or DOMPurify settings in showcase/src/app/docs/[section]/[slug]/markdown.ts and showcase/src/components/docs/DocsReader.tsx
- Update canonical URL logic and SEO metadata in showcase/src/app/layout.tsx and per-route files
- Update or add Open Graph images in showcase/src/app/research/[slug]/opengraph-image.tsx

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.