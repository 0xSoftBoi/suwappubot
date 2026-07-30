'use client';

import { useEffect, useRef } from 'react';

/**
 * SectionField — one canvas, six motifs, each depicting the thing its section
 * actually sells.
 *
 * The point is that the motion is informational, not decorative: the engine
 * section shows providers racing to a winning quote, the perps section shows a
 * market, the Tempo section shows a fee-payer absorbing gas, and so on. A
 * single generic particle field behind everything would be wallpaper.
 *
 * Shared scaffolding for all motifs: deterministic layout (no Math.random, so
 * nothing shimmers on resize), DPR-aware sizing, one static frame under
 * prefers-reduced-motion, and painting stops entirely when the section is
 * scrolled out of view.
 */

export type Motif = 'routes' | 'race' | 'book' | 'sponsor' | 'calls' | 'converge';

const ACCENT = '246, 169, 60';

export default function SectionField({
  motif,
  accent = ACCENT,
  className = '',
}: {
  motif: Motif;
  accent?: string;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    let running = false;
    let w = 0, h = 0;

    const a = (o: number) => `rgba(${accent}, ${o})`;
    const dim = (o: number) => `rgba(255, 255, 255, ${o})`;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = cv.clientWidth; h = cv.clientHeight;
      if (!w || !h) return;
      cv.width = Math.floor(w * dpr);
      cv.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    /* ── Motifs ──────────────────────────────────────────────── */

    // Chain nodes with routes hopping between them.
    const routes = (t: number) => {
      const N = 46, ARCS = 7;
      const pts = Array.from({ length: N }, (_, i) => {
        const f = i / N, ang = i * 2.399963, rad = Math.sqrt(f);
        return { x: w * (0.5 + Math.cos(ang) * rad * 0.46), y: h * (0.42 + Math.sin(ang) * rad * 0.34) };
      });
      for (const p of pts) {
        ctx.beginPath(); ctx.arc(p.x, p.y, 1.4, 0, 6.284);
        ctx.fillStyle = a(0.38); ctx.fill();
      }
      for (let i = 0; i < ARCS; i++) {
        const p0 = pts[(i * 9) % N], p1 = pts[(i * 17 + 5) % N];
        const mx = (p0.x + p1.x) / 2, my = (p0.y + p1.y) / 2 - Math.abs(p1.x - p0.x) * 0.22;
        ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.quadraticCurveTo(mx, my, p1.x, p1.y);
        ctx.strokeStyle = a(0.16); ctx.lineWidth = 1; ctx.stroke();
        const prog = reduce ? 0.62 : ((t * (0.00013 + i * 0.00002) + i / ARCS) % 1);
        const q = (u: number) => ({
          x: (1 - u) * (1 - u) * p0.x + 2 * (1 - u) * u * mx + u * u * p1.x,
          y: (1 - u) * (1 - u) * p0.y + 2 * (1 - u) * u * my + u * u * p1.y,
        });
        const head = q(prog), tail = q(Math.max(0, prog - 0.16));
        const g = ctx.createLinearGradient(tail.x, tail.y, head.x, head.y);
        g.addColorStop(0, a(0)); g.addColorStop(1, a(0.75));
        ctx.beginPath(); ctx.moveTo(tail.x, tail.y); ctx.lineTo(head.x, head.y);
        ctx.strokeStyle = g; ctx.lineWidth = 1.4; ctx.stroke();
        ctx.beginPath(); ctx.arc(head.x, head.y, 1.9, 0, 6.284); ctx.fillStyle = a(0.9); ctx.fill();
      }
    };

    // Engine: providers racing to quote. One crosses first and locks in.
    const race = (t: number) => {
      const LANES = 9;
      const cycle = 5200;
      const phase = reduce ? 0.82 : ((t % cycle) / cycle);
      const pad = w * 0.12, span = w * 0.76;
      const gap = h / (LANES + 1);
      // Deterministic per-lane pace; lane 3 is always the winner.
      const pace = [0.86, 0.79, 0.94, 1.0, 0.83, 0.9, 0.75, 0.88, 0.81];
      for (let i = 0; i < LANES; i++) {
        const y = gap * (i + 1);
        ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(pad + span, y);
        ctx.strokeStyle = dim(0.09); ctx.lineWidth = 1; ctx.stroke();
        const p = Math.min(1, phase * pace[i] * 1.18);
        const x = pad + span * p;
        const won = pace[i] === 1.0 && p >= 1;
        const g = ctx.createLinearGradient(pad, y, x, y);
        g.addColorStop(0, a(0)); g.addColorStop(1, won ? a(0.95) : a(0.5));
        ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(x, y);
        ctx.strokeStyle = g; ctx.lineWidth = won ? 2.4 : 1.5; ctx.stroke();
        ctx.beginPath(); ctx.arc(x, y, won ? 2.6 : 1.6, 0, 6.284);
        ctx.fillStyle = won ? a(1) : a(0.6); ctx.fill();
      }
      // The finish line the winner crosses.
      ctx.beginPath(); ctx.moveTo(pad + span, gap * 0.5); ctx.lineTo(pad + span, h - gap * 0.5);
      ctx.strokeStyle = dim(0.09); ctx.lineWidth = 1; ctx.stroke();
    };

    // Perps: a market. Drifting price line with a position band.
    const book = (t: number) => {
      const step = w / 90;
      const drift = reduce ? 0 : t * 0.00016;
      ctx.beginPath();
      for (let i = 0; i <= 90; i++) {
        // Layered sines: deterministic, reads as a price series.
        const v = Math.sin(i * 0.21 + drift) * 0.5
                + Math.sin(i * 0.077 + drift * 0.6) * 0.32
                + Math.sin(i * 0.41 + drift * 1.7) * 0.13;
        const x = i * step, y = h * 0.5 - v * h * 0.24;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.strokeStyle = a(0.5); ctx.lineWidth = 1.4; ctx.stroke();
      // Entry band.
      ctx.beginPath(); ctx.moveTo(0, h * 0.5); ctx.lineTo(w, h * 0.5);
      ctx.strokeStyle = dim(0.07); ctx.setLineDash([4, 6]); ctx.lineWidth = 1; ctx.stroke();
      ctx.setLineDash([]);
      // Depth ticks either side, like a ladder.
      for (let i = 0; i < 14; i++) {
        const y = h * 0.5 + (i - 7) * (h * 0.055);
        const len = 10 + ((i * 13) % 5) * 7;
        ctx.beginPath(); ctx.moveTo(w - 24 - len, y); ctx.lineTo(w - 24, y);
        ctx.strokeStyle = i < 7 ? a(0.16) : dim(0.06); ctx.lineWidth = 2; ctx.stroke();
      }
    };

    // Tempo: a fee-payer absorbs the gas so the user's tx passes free.
    const sponsor = (t: number) => {
      const y = h * 0.5, payer = w * 0.5;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y);
      ctx.strokeStyle = dim(0.10); ctx.lineWidth = 1; ctx.stroke();
      // The fee-payer node.
      ctx.beginPath(); ctx.arc(payer, y, 5, 0, 6.284);
      ctx.strokeStyle = a(0.7); ctx.lineWidth = 1.6; ctx.stroke();
      for (let k = 0; k < 6; k++) {
        const p = reduce ? 0.16 + k * 0.14 : ((t * 0.00019 + k / 6) % 1);
        const x = p * w;
        // Before the payer the tx carries a gas dot; after, it does not.
        ctx.beginPath(); ctx.arc(x, y, 2.4, 0, 6.284);
        ctx.fillStyle = a(0.8); ctx.fill();
        if (x < payer) {
          ctx.beginPath(); ctx.arc(x, y - 9, 1.6, 0, 6.284);
          ctx.fillStyle = dim(0.34); ctx.fill();
        } else {
          // The payer pulses as it counter-signs.
          const since = (x - payer) / (w - payer);
          ctx.beginPath(); ctx.arc(payer, y, 5 + since * 22, 0, 6.284);
          ctx.strokeStyle = a(Math.max(0, 0.32 * (1 - since))); ctx.lineWidth = 1; ctx.stroke();
        }
      }
    };

    // Agents: tool calls leaving one agent and returning.
    const calls = (t: number) => {
      const cx = w * 0.5, cy = h * 0.5, R = Math.min(w, h) * 0.38;
      const SPOKES = 10;
      ctx.beginPath(); ctx.arc(cx, cy, 4, 0, 6.284);
      ctx.strokeStyle = a(0.6); ctx.lineWidth = 1.4; ctx.stroke();
      for (let i = 0; i < SPOKES; i++) {
        const ang = (i / SPOKES) * 6.284 - 1.57;
        const ex = cx + Math.cos(ang) * R * (w > h ? 1.7 : 1);
        const ey = cy + Math.sin(ang) * R;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(ex, ey);
        ctx.strokeStyle = dim(0.05); ctx.lineWidth = 1; ctx.stroke();
        ctx.beginPath(); ctx.arc(ex, ey, 2, 0, 6.284); ctx.fillStyle = a(0.3); ctx.fill();
        // Out on the first half of the cycle, back on the second.
        const raw = reduce ? 0.5 : ((t * 0.00021 + i / SPOKES) % 1);
        const out = raw < 0.5;
        const u = out ? raw * 2 : (1 - raw) * 2;
        const px = cx + (ex - cx) * u, py = cy + (ey - cy) * u;
        ctx.beginPath(); ctx.arc(px, py, 2.2, 0, 6.284);
        ctx.fillStyle = out ? a(0.85) : dim(0.5); ctx.fill();
      }
    };

    // Surfaces: three streams merging into one engine.
    const converge = (t: number) => {
      const mergeX = w * 0.62, outY = h * 0.5;
      const lanes = [h * 0.28, h * 0.5, h * 0.72];
      for (const ly of lanes) {
        ctx.beginPath(); ctx.moveTo(0, ly);
        ctx.quadraticCurveTo(mergeX * 0.7, ly, mergeX, outY);
        ctx.strokeStyle = dim(0.06); ctx.lineWidth = 1; ctx.stroke();
      }
      ctx.beginPath(); ctx.moveTo(mergeX, outY); ctx.lineTo(w, outY);
      ctx.strokeStyle = a(0.22); ctx.lineWidth = 1.4; ctx.stroke();
      lanes.forEach((ly, i) => {
        const p = reduce ? 0.55 : ((t * 0.00022 + i / 3) % 1);
        let x: number, y: number;
        if (p < 0.62) {
          const u = p / 0.62;
          x = (1 - u) * (1 - u) * 0 + 2 * (1 - u) * u * (mergeX * 0.7) + u * u * mergeX;
          y = (1 - u) * (1 - u) * ly + 2 * (1 - u) * u * ly + u * u * outY;
        } else {
          const u = (p - 0.62) / 0.38;
          x = mergeX + (w - mergeX) * u; y = outY;
        }
        ctx.beginPath(); ctx.arc(x, y, 2.2, 0, 6.284);
        ctx.fillStyle = a(p < 0.62 ? 0.6 : 0.9); ctx.fill();
      });
      ctx.beginPath(); ctx.arc(mergeX, outY, 4.5, 0, 6.284);
      ctx.strokeStyle = a(0.45); ctx.lineWidth = 1.3; ctx.stroke();
    };

    const MOTIFS = { routes, race, book, sponsor, calls, converge };

    const draw = (t: number) => {
      if (!w || !h) return;
      ctx.clearRect(0, 0, w, h);
      MOTIFS[motif](t);
      if (running && !reduce) raf = requestAnimationFrame(draw);
    };

    resize();
    draw(0);

    const ro = new ResizeObserver(() => { resize(); draw(performance.now()); });
    ro.observe(cv);

    const io = new IntersectionObserver(([e]) => {
      running = e.isIntersecting;
      cancelAnimationFrame(raf);
      if (running && !reduce) raf = requestAnimationFrame(draw);
    }, { threshold: 0 });
    io.observe(cv);

    return () => { running = false; cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); };
  }, [motif, accent]);

  return <canvas ref={ref} className={`sectionfield ${className}`} aria-hidden="true" />;
}
