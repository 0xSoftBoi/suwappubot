'use client';

import { useEffect, useRef } from 'react';

import { createFrameBudget, pauseWhenHidden } from '@/lib/frameBudget';
import { subscribeMotionPreference } from '@/lib/motionPreference';

/**
 * RouteField: the hero's generative background object.
 *
 * The reference (globalsettlement.com) uses a canvas dot-matrix globe with an
 * animated arc. Same device, honest subject: this draws chain nodes and the
 * routes that race between them, which is literally what the product does.
 *
 * Canvas, not an image: it scales to any viewport, costs ~8KB instead of a
 * 3MB webp, and tints from one accent token. Draws a single static frame
 * under prefers-reduced-motion, and stops entirely when scrolled out of view.
 *
 * Three costs are governed rather than assumed (see docs/plans/tektonic-blog-study.md,
 * W4.3-W4.5):
 *   - node count scales to a measured frame budget, so a mid-range phone renders a
 *     sparser field instead of a stuttering one;
 *   - the loop stops while the tab is hidden, not just while scrolled away;
 *   - the motion preference is live, so turning motion sensitivity on stops the
 *     animation immediately rather than at the next reload.
 */

type Node = { x: number; y: number; r: number };

const NODE_COUNT = 46;
const ARC_COUNT = 7;

export default function RouteField({ accent = '246, 169, 60' }: { accent?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let running = true;
    let onScreen = true;
    let w = 0, h = 0;
    let nodes: Node[] = [];

    // Quality multiplier on the node count. Rebuilding the layout on change is cheap
    // (a few dozen golden-angle positions) and keeps the scatter deterministic.
    const budget = createFrameBudget({ min: 0.4, max: 1, onChange: () => build() });

    const motion = subscribeMotionPreference((next) => {
      if (next) {
        cancelAnimationFrame(raf);
        draw(0);
      } else {
        resume();
      }
    });
    const reduce = () => motion.reduce;

    // Deterministic layout: no Math.random, so the field is stable across
    // resizes and does not shimmer when the user changes window size.
    const build = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = cv.clientWidth; h = cv.clientHeight;
      cv.width = Math.floor(w * dpr);
      cv.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Scaled by the measured budget: the same scatter, thinned rather than reshaped,
      // so degrading quality never changes the composition.
      const count = Math.max(12, Math.round(NODE_COUNT * budget.quality));
      nodes = [];
      for (let i = 0; i < count; i++) {
        // Golden-angle scatter, biased toward the upper band behind the headline.
        const t = i / count;
        const a = i * 2.399963;
        const rad = Math.sqrt(t);
        nodes.push({
          x: w * (0.5 + Math.cos(a) * rad * 0.46),
          y: h * (0.42 + Math.sin(a) * rad * 0.34),
          r: 1 + ((i * 7) % 3) * 0.5,
        });
      }
    };

    const arcs = Array.from({ length: ARC_COUNT }, (_, i) => ({
      from: i * 9,
      to: i * 17 + 5,
      // Stagger so they do not pulse in unison.
      offset: i / ARC_COUNT,
      speed: 0.00013 + i * 0.00002,
    }));

    function draw(time: number) {
      // Re-narrowed rather than relying on the guard above: draw and resume are
      // function declarations so they can reference each other, and a hoisted
      // declaration does not inherit the enclosing narrowing.
      if (!ctx) return;
      // A hidden tab still burns the compositor and the user's battery; one property
      // read per frame is cheaper than the frame it skips.
      if (document.hidden) return;
      budget.mark();
      ctx.clearRect(0, 0, w, h);

      // Nodes.
      for (const n of nodes) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${accent}, 0.38)`;
        ctx.fill();
      }

      // Routes: a travelling head with a fading tail, drawn along a quadratic
      // curve so it reads as a hop rather than a straight wire.
      for (const arc of arcs) {
        // Indices are modulo the CURRENT node count, which the frame budget can change
        // between frames; taking the modulo here rather than at construction keeps every
        // arc anchored to a real node after a quality step.
        const a = nodes[arc.from % nodes.length], b = nodes[arc.to % nodes.length];
        if (!a || !b) continue;
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2 - Math.abs(b.x - a.x) * 0.22;

        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo(mx, my, b.x, b.y);
        ctx.strokeStyle = `rgba(${accent}, 0.16)`;
        ctx.lineWidth = 1;
        ctx.stroke();

        const p = reduce() ? 0.62 : ((time * arc.speed + arc.offset) % 1);
        const q = (t: number) => ({
          x: (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * mx + t * t * b.x,
          y: (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * my + t * t * b.y,
        });

        const head = q(p);
        const tail = q(Math.max(0, p - 0.16));
        const g = ctx.createLinearGradient(tail.x, tail.y, head.x, head.y);
        g.addColorStop(0, `rgba(${accent}, 0)`);
        g.addColorStop(1, `rgba(${accent}, 0.75)`);
        ctx.beginPath();
        ctx.moveTo(tail.x, tail.y);
        ctx.lineTo(head.x, head.y);
        ctx.strokeStyle = g;
        ctx.lineWidth = 1.4;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(head.x, head.y, 1.9, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${accent}, 0.9)`;
        ctx.fill();
      }

      if (running && onScreen && !reduce()) raf = requestAnimationFrame(draw);
    }

    function resume() {
      if (!running || !onScreen || reduce()) return;
      // Timings spanning a pause describe the pause, not the scene.
      budget.reset();
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(draw);
    }

    build();
    draw(0);

    const ro = new ResizeObserver(() => { build(); budget.reset(); if (reduce()) draw(0); });
    ro.observe(cv);

    // Stop painting when the hero is off-screen.
    const io = new IntersectionObserver(([e]) => {
      onScreen = e.isIntersecting;
      if (onScreen) resume();
      else cancelAnimationFrame(raf);
    }, { threshold: 0 });
    io.observe(cv);

    const detachVisibility = pauseWhenHidden(resume);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      detachVisibility();
      motion.detach();
    };
  }, [accent]);

  return <canvas ref={ref} className="routefield" aria-hidden="true" />;
}
