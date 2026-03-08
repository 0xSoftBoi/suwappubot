---
paths:
  - "showcase/**/*.ts"
  - "showcase/**/*.tsx"
---

# Showcase Rules (Next.js + GSAP)

- Build: `cd showcase && bun run build`
- All animations use GSAP (no Framer Motion)
- Horizontal scroll: `useScrollContext()` for `containerAnimation`
- Use `.panel-stagger` class for scroll-linked entrance animations
- Desktop: horizontal scroll via GSAP ScrollTrigger (pin + scrub)
- Mobile (< 768px): panels stack vertically, no pin
- Always `useGSAP` with `scope` and `dependencies: [scrollTween]`
