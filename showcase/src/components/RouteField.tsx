'use client';

import { useEffect, useRef } from 'react';

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

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    let running = true;
    let w = 0, h = 0;
    let nodes: Node[] = [];

    // Deterministic layout: no Math.random, so the field is stable across
    // resizes and does not shimmer when the user changes window size.
    const build = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = cv.clientWidth; h = cv.clientHeight;
      cv.width = Math.floor(w * dpr);
      cv.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      nodes = [];
      for (let i = 0; i < NODE_COUNT; i++) {
        // Golden-angle scatter, biased toward the upper band behind the headline.
        const t = i / NODE_COUNT;
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
      from: (i * 9) % NODE_COUNT,
      to: (i * 17 + 5) % NODE_COUNT,
      // Stagger so they do not pulse in unison.
      offset: i / ARC_COUNT,
      speed: 0.00013 + i * 0.00002,
    }));

    const draw = (time: number) => {
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
        const a = nodes[arc.from], b = nodes[arc.to];
        if (!a || !b) continue;
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2 - Math.abs(b.x - a.x) * 0.22;

        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo(mx, my, b.x, b.y);
        ctx.strokeStyle = `rgba(${accent}, 0.16)`;
        ctx.lineWidth = 1;
        ctx.stroke();

        const p = reduce ? 0.62 : ((time * arc.speed + arc.offset) % 1);
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

      if (running && !reduce) raf = requestAnimationFrame(draw);
    };

    build();
    draw(0);

    const ro = new ResizeObserver(() => { build(); if (reduce) draw(0); });
    ro.observe(cv);

    // Stop painting when the hero is off-screen.
    const io = new IntersectionObserver(([e]) => {
      running = e.isIntersecting;
      if (running && !reduce) raf = requestAnimationFrame(draw);
      else cancelAnimationFrame(raf);
    }, { threshold: 0 });
    io.observe(cv);

    return () => { running = false; cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); };
  }, [accent]);

  return <canvas ref={ref} className="routefield" aria-hidden="true" />;
}
