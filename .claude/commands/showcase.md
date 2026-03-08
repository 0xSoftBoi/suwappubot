---
description: "Build, dev, or check the Next.js showcase homepage"
context: fork
---

# Showcase Site Management

Build, dev, or check the Next.js showcase homepage.

## Arguments

`$ARGUMENTS` — One of: `dev`, `build`, `check`, `clean`

## Commands

### `dev` (default)
Start the showcase dev server:
```bash
cd ~/Desktop/suwappumain/worktrees/main/showcase
bun run dev
```
Report the URL when ready.

### `build`
Production build to verify no errors:
```bash
cd ~/Desktop/suwappumain/worktrees/main/showcase
bun run build
```
Report build size and any warnings.

### `check`
Verify showcase health:
1. Run `bun run build` — must compile without errors
2. Check for unused imports or dead component files
3. Verify all `gsap-panel` sections exist and are wired into `HorizontalScroll`
4. Check `package.json` doesn't have `framer-motion` (replaced with GSAP)

### `clean`
Remove build artifacts:
```bash
cd ~/Desktop/suwappumain/worktrees/main/showcase
rm -rf .next node_modules
bun install
```

## Key Files

| File | Purpose |
|------|---------|
| `src/app/page.tsx` | Main page — imports Navigation + HorizontalScroll with 5 panels |
| `src/components/HorizontalScroll.tsx` | GSAP ScrollTrigger horizontal scroll container |
| `src/components/Panel.tsx` | Panel wrapper (100vw x 100vh, flex-shrink: 0) |
| `src/components/Hero.tsx` | Panel 1 — Hero with ChatDemo |
| `src/components/Panel2HowItWorks.tsx` | Panel 2 — Steps + 6-vs-2 comparison |
| `src/components/Panel3Features.tsx` | Panel 3 — 4 feature cards |
| `src/components/PlatformDemos.tsx` | Panel 4 — Tab-based platform demos |
| `src/components/Panel5CTA.tsx` | Panel 5 — CTA + compact footer |
| `src/components/Navigation.tsx` | Fixed nav with ScrollToPlugin + progress bar |

## Architecture

- **Desktop**: 5 panels scroll horizontally via GSAP ScrollTrigger (pin + scrub: 2 + snap)
- **Mobile (< 768px)**: Panels stack vertically, no pin
- **Animations**: All GSAP — `useGSAP` hook, `containerAnimation` for scroll-linked entrance
- **No Framer Motion**: Fully replaced with GSAP + @gsap/react
