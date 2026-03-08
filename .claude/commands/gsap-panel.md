# Add a New GSAP Panel to Showcase

Scaffold a new horizontal scroll panel for the showcase homepage.

## Arguments

`$ARGUMENTS` — Panel name and description (e.g., "Panel6Pricing - pricing table with toggle")

## Instructions

### 1. Create the panel component

Create `showcase/src/components/<PanelName>.tsx` following this template:

```tsx
'use client';

import { useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import Panel from './Panel';
import { useScrollContext } from './HorizontalScroll';

gsap.registerPlugin(ScrollTrigger);

export default function PanelName() {
  const panelRef = useRef<HTMLElement>(null);
  const { scrollTween } = useScrollContext();

  useGSAP(() => {
    if (!panelRef.current) return;

    const items = panelRef.current.querySelectorAll('.panel-stagger');
    const triggerConfig = scrollTween
      ? { containerAnimation: scrollTween, trigger: panelRef.current, start: 'left 60%' }
      : { trigger: panelRef.current, start: 'top 70%' };

    gsap.from(items, {
      y: 24,
      opacity: 0,
      stagger: 0.1,
      duration: 0.55,
      ease: 'expo.out',
      scrollTrigger: triggerConfig,
    });
  }, { scope: panelRef, dependencies: [scrollTween] });

  return (
    <Panel ref={panelRef} id="panel-id" className="flex items-center bg-suwappu-dark-bg relative">
      <div className="max-w-5xl mx-auto px-6 w-full">
        {/* Content here — add .panel-stagger to animated elements */}
      </div>
    </Panel>
  );
}
```

### 2. Wire into page.tsx

Add import and insert inside `<HorizontalScroll>` in the correct position.

### 3. Update Navigation

If the panel should be nav-linked, add entry to `NAV_LINKS` in `Navigation.tsx` with the correct panel index.

### 4. Update HorizontalScroll snap

The snap calculation `1/(n-1)` auto-adjusts since it reads panel count from DOM. No manual change needed.

### 5. Verify

```bash
cd showcase && bun run build
```

## Key Patterns

- Use `useScrollContext()` to get `scrollTween` for `containerAnimation`
- Use `.panel-stagger` class on elements that should animate on scroll
- Desktop: `containerAnimation` links to horizontal scroll
- Mobile: Falls back to `trigger/start` vertical scroll
- Always `useGSAP` with `scope` and `dependencies: [scrollTween]`
