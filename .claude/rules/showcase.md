---
paths:
  - "showcase/**/*.ts"
  - "showcase/**/*.tsx"
---

# Showcase Rules (Next.js + Framer Motion + Pretext)

- Build: `cd showcase && bun run build` (runs `prebuild` to generate docs.json from gitbook)
- Animations use Framer Motion (`motion`, `useInView`, `AnimatePresence`)
- Scroll reveals: `Reveal` and `StaggerReveal` components in Overlay.tsx
- Text measurement: `@chenglou/pretext` for masonry heights and accordion/reader layouts
- Content source: `gitbook/` markdown → `scripts/build-content.ts` → `src/data/docs.json`
- Color palette: warm beige `#faf8f4`, pink accent `#f472b6`, dark `#1a1a1a`
- Fonts: Space Grotesk (display), DM Sans (body), Fira Code (mono)
- Mobile (< 768px): single-column layouts, sidebar hidden
