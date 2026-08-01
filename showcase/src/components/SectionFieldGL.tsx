'use client';

import { useEffect, useRef } from 'react';
import { initPoints, PointBatch, LineBatch, type GLPoints } from './glkit';
import productStats from '@/data/stats.generated.json';

/**
 * SectionFieldGL — the four section objects, on the GPU.
 *
 * Moving these was not a performance decision: at dozens of primitives canvas
 * 2D was never the bottleneck. It is a fidelity decision. Additive blending
 * gives real glow, and one draw call per frame means these can carry thousands
 * of primitives instead of dozens, so the strands, ribbons and trails are
 * genuinely dense rather than sketched.
 *
 * Same two-layer structure as the hero sphere: WebGL for the marks, a 2D
 * overlay for text. If WebGL2 is missing the overlay still renders labels, so
 * a section degrades to a quieter diagram rather than a blank box.
 */

export type MotifGL = 'race' | 'markets' | 'sponsor' | 'tools';

const ACCENT: [number, number, number] = [0.965, 0.663, 0.235];
const MONO = '11px ui-monospace, SFMono-Regular, Menlo, monospace';

const PROVIDERS: Array<[string, number]> = [
  ['Li.Fi', 1.0], ['CoW', 0.94], ['OKX', 0.9], ['1inch', 0.86],
  ['KyberSwap', 0.83], ['Jupiter', 0.79], ['Across', 0.75], ['Wormhole', 0.71],
];
const MARKETS = ['BTC-PERP', 'ETH-PERP', 'SOL-PERP'];
const TOOLS = [
  'get_quote', 'execute_swap', 'get_portfolio', 'perps_quote',
  'predict_markets', 'lend_markets', 'list_chains', 'get_prices',
];

export default function SectionFieldGL({
  motif,
  className = '',
}: {
  motif: MotifGL;
  className?: string;
}) {
  const glRef = useRef<HTMLCanvasElement>(null);
  const ovRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const glc = glRef.current, ovc = ovRef.current;
    if (!glc || !ovc) return;
    const ctx = ovc.getContext('2d');
    if (!ctx) return;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0, running = false, w = 0, h = 0, dpr = 1;

    const MAX = 24000;
    const points: GLPoints | null = initPoints(glc, ACCENT, MAX);
    const batch = new PointBatch(MAX);
    const lines = new LineBatch(MAX);

    const A = (o: number) => `rgba(246,169,60,${o})`;
    const D = (o: number) => `rgba(255,255,255,${o})`;

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = glc.clientWidth; h = glc.clientHeight;
      if (!w || !h) return;
      for (const c of [glc, ovc]) {
        c.width = Math.floor(w * dpr);
        c.height = Math.floor(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    /* ── The quote race, as a dense braid ───────────────────── */
    const race = (t: number) => {
      const cx = w * 0.5, cy = h * 0.5;
      ctx.font = MONO;
      const narrow = w < 560;
      const endPad = Math.max(ctx.measureText('your order').width,
                              ctx.measureText('best fill').width) + 18;
      const SX = Math.max(60, w / 2 - endPad) * 0.98;
      const SY = Math.min(h * 0.36, w * 0.12);
      const spin = reduce ? 0.55 : t * 0.00007;
      const cycle = 6000;
      const phase = reduce ? 1 : Math.min(1.12, ((t % cycle) / cycle) * 1.28);

      const proj = (x: number, y: number, z: number) => {
        const c = Math.cos(spin), s = Math.sin(spin);
        const rx = x * c + z * s, rz = -x * s + z * c;
        const yy = y * 0.92 - rz * 0.1, zz = y * 0.1 + rz * 0.92;
        const k = 3.4 / (3.4 - zz * 0.6);
        return { x: cx + rx * SX * k, y: cy + yy * SY * k, k, z: zz };
      };

      const strands = PROVIDERS.map(([name, pace], i) => {
        const ang = (i / PROVIDERS.length) * 6.284;
        return { name, pace, ang, i, depth: Math.cos(ang) };
      }).sort((a, b) => a.depth - b.depth);

      for (const st of strands) {
        const bow = 0.5 + (st.i % 3) * 0.1;
        const pt = (u: number) => {
          const sw = Math.sin(Math.PI * u) * bow;
          return proj(-1 + 2 * u, Math.sin(st.ang) * sw, Math.cos(st.ang) * sw);
        };
        const near = st.depth > 0;
        const p = Math.min(1, phase * st.pace);
        const won = st.i === 0 && p >= 1;

        // The whole strand as a polyline: continuous by construction.
        const SEG = 80;
        const whole = [];
        for (let k = 0; k <= SEG; k++) whole.push(pt(k / SEG));
        lines.path(whole, won ? 0.5 : near ? 0.16 : 0.07);

        // The travelled head, brighter, with a tail that fades in.
        const from = Math.max(0, p - 0.3);
        const tail = [];
        for (let k = 0; k <= 40; k++) tail.push(pt(from + (p - from) * (k / 40)));
        lines.path(tail, 0.02, won ? 1.0 : near ? 0.75 : 0.4);
        // A soft point run over the tail turns the line into a glow.
        for (let k = 0; k <= 40; k++) {
          const q = tail[k], fade = k / 40;
          batch.push(q.x, q.y, (won ? 7 : 5) * q.k, (won ? 0.34 : 0.2) * fade);
        }
        const head = pt(p);
        for (let g = 0; g < 5; g++) {
          batch.push(head.x, head.y, (won ? 9 : 6) - g, (won ? 0.9 : 0.55));
        }
        if ((won || (!narrow && near)) && p > 0.18) {
          ctx.textAlign = 'center';
          ctx.fillStyle = won ? A(0.95) : D(0.28);
          ctx.fillText(st.name, head.x, head.y - 11);
        }
      }

      const A0 = proj(-1, 0, 0), B0 = proj(1, 0, 0);
      for (const [q, label, align] of [
        [A0, 'your order', 'right'], [B0, 'best fill', 'left'],
      ] as const) {
        for (let g = 0; g < 6; g++) batch.push(q.x, q.y, 11 - g, 0.5);
        ctx.textAlign = align;
        ctx.fillStyle = A(0.7);
        ctx.fillText(label, q.x + (align === 'right' ? -12 : 12), q.y);
      }
      ctx.textAlign = 'center';
      ctx.fillStyle = D(0.2);
      ctx.fillText(`${productStats.routerCount} providers quote at once`, cx, h - 12);
    };

    /* ── Market ribbons ─────────────────────────────────────── */
    const markets = (t: number) => {
      const cx = w * 0.5, cy = h * 0.5;
      const SX = w * 0.4, SY = Math.min(h * 0.42, w * 0.14);
      const drift = reduce ? 0 : t * 0.00016;
      const narrow = w < 520;
      ctx.font = MONO;
      ctx.textBaseline = 'middle';

      const proj = (x: number, y: number, z: number) => {
        const yaw = 0.72, pitch = 0.3;
        const x1 = x * Math.cos(yaw) + z * Math.sin(yaw);
        const z1 = -x * Math.sin(yaw) + z * Math.cos(yaw);
        const y1 = y * Math.cos(pitch) - z1 * Math.sin(pitch);
        const z2 = y * Math.sin(pitch) + z1 * Math.cos(pitch);
        const k = 3.6 / (3.6 - z2 * 0.5);
        return { x: cx + x1 * SX * k, y: cy + y1 * SY * k, k };
      };
      const series = (i: number, k: number) =>
        Math.sin(i * (0.2 + k * 0.05) + drift * (1 + k * 0.35)) * 0.55 +
        Math.sin(i * (0.073 + k * 0.02) + drift * 0.7) * 0.34;

      const pad = 8;
      const widest = Math.max(...MARKETS.map((m) => ctx.measureText(m).width));
      const x0 = narrow ? -0.42 : -0.62;
      const span = narrow ? 1.0 : 1.3;
      const lanes = narrow ? [0] : [2, 1, 0];

      for (const k of lanes) {
        const z = narrow ? 0 : -0.55 + k * 0.55;
        const near = k === 0;
        const SEG = 120;
        const ribbon = [];
        for (let i = 0; i <= SEG; i++) {
          const u = i / SEG;
          ribbon.push(proj(x0 + u * span, series(u * 64, k) * 0.26, z));
        }
        lines.path(ribbon, near ? 0.62 : 0.2);
        if (near) for (const q of ribbon) batch.push(q.x, q.y, 6 * q.k, 0.12);
        const head = proj(x0, series(0, k) * 0.26, z);
        ctx.textAlign = 'left';
        ctx.fillStyle = near ? A(0.9) : D(0.26);
        ctx.fillText(MARKETS[k], Math.max(pad, head.x - widest - 6), head.y);

        if (near) {
          const now = proj(x0 + span, series(64, k) * 0.26, z);
          for (let g = 0; g < 6; g++) batch.push(now.x, now.y, 11 - g, 0.7);
          const lbl = 'long 20x';
          const lw = ctx.measureText(lbl).width;
          ctx.textAlign = 'left';
          ctx.fillStyle = A(0.9);
          ctx.fillText(lbl, Math.min(now.x + 8, w - lw - pad), now.y);
        }
      }

      if (!narrow) {
        for (let i = 0; i < 9; i++) {
          const f = (i - 4) / 9;
          const size = 0.1 + ((i * 7) % 5) * 0.052;
          const r0 = proj(0.76, f * 0.44, 0.55);
          const r1 = proj(0.76, f * 0.44, 0.55 - size);
          lines.seg(r0.x, r0.y, r1.x, r1.y, f < 0 ? 0.6 : 0.2);
          batch.push((r0.x+r1.x)/2, (r0.y+r1.y)/2, 7, f < 0 ? 0.14 : 0.05);
        }
        const bt = proj(0.76, 0.32, 0.55);
        ctx.textAlign = 'right';
        ctx.fillStyle = D(0.26);
        ctx.fillText('order book', bt.x - 6, bt.y);
      }
      ctx.textAlign = 'left';
      ctx.fillStyle = D(0.16);
      ctx.fillText('illustrative', pad, 10);
    };

    /* ── Tempo: the fee-payer gate ──────────────────────────── */
    const sponsor = (t: number) => {
      const cx = w * 0.5, cy = h * 0.5;
      const SX = w * 0.46, SY = Math.min(h * 0.4, w * 0.1);
      const spin = reduce ? 0.4 : t * 0.00013;
      ctx.font = MONO;
      ctx.textBaseline = 'middle';

      const proj = (x: number, y: number, z: number) => {
        const yaw = 0.62, pitch = 0.26;
        const x1 = x * Math.cos(yaw) + z * Math.sin(yaw);
        const z1 = -x * Math.sin(yaw) + z * Math.cos(yaw);
        const y1 = y * Math.cos(pitch) - z1 * Math.sin(pitch);
        const z2 = y * Math.sin(pitch) + z1 * Math.cos(pitch);
        const k = 3.6 / (3.6 - z2 * 0.5);
        return { x: cx + x1 * SX * k, y: cy + y1 * SY * k, k };
      };

      const a0 = proj(-0.82, 0, 0), b0 = proj(0.82, 0, 0);
      lines.seg(a0.x, a0.y, b0.x, b0.y, 0.1);

      // Gate: a dense ring, brighter while a transaction crosses.
      const packets = Array.from({ length: 6 }, (_, i) => {
        const u = reduce ? 0.16 + i * 0.14 : ((t * 0.00019 + i / 6) % 1);
        const off = (i - 2.5) * 0.09;
        return { u, x: -0.82 + 1.64 * u, y: off * 0.5, z: off, i };
      });
      let crossing = 0;
      for (const pk of packets) if (Math.abs(pk.x) < 0.12) crossing = 1 - Math.abs(pk.x) / 0.12;

      for (let i = 0; i < 520; i++) {
        const ang = (i / 520) * 6.284 + spin;
        const q = proj(0, Math.sin(ang) * 0.34, Math.cos(ang) * 0.34);
        batch.push(q.x, q.y, (3.6 + crossing * 2.2) * q.k, 0.45 + crossing * 0.5);
      }
      if (crossing > 0.02) {
        for (let i = 0; i < 120; i++) {
          const ang = (i / 120) * 6.284 + spin;
          const rr = 0.34 + (1 - crossing) * 0.34;
          const q = proj(0, Math.sin(ang) * rr, Math.cos(ang) * rr);
          batch.push(q.x, q.y, 1.6 * q.k, 0.5 * crossing);
        }
      }

      let lead = 0, ld = 9;
      for (const pk of packets) { const d = Math.abs(pk.x); if (d < ld) { ld = d; lead = pk.i; } }

      for (const pk of packets) {
        const q = proj(pk.x, pk.y, pk.z);
        for (let g = 0; g < 5; g++) batch.push(q.x, q.y, 8 - g, 0.7);
        // Trail behind each transaction.
        const trail = [];
        for (let s2 = 0; s2 <= 26; s2++) {
          trail.push(proj(Math.max(-0.82, pk.x - s2 * 0.009), pk.y, pk.z));
        }
        lines.path(trail, 0.55, 0.0);
        for (let s2 = 0; s2 <= 26; s2++) {
          batch.push(trail[s2].x, trail[s2].y, 5 * trail[s2].k, 0.24 * (1 - s2 / 26));
        }
        if (pk.i === lead) {
          ctx.textAlign = 'center';
          ctx.fillStyle = D(0.32);
          ctx.fillText('100 USDC', q.x, q.y - 14);
        }
        if (pk.x < 0) {
          const g2 = proj(pk.x, pk.y + 0.16, pk.z);
          batch.push(g2.x, g2.y, 3.4 * g2.k, 0.4);
        } else {
          const since = (pk.x - 0) / 0.82;
          const g2 = proj(pk.x * (1 - Math.min(1, since * 3)), pk.y + 0.16, pk.z);
          batch.push(g2.x, g2.y, 3.4 * g2.k, 0.4 * (1 - Math.min(1, since * 3)));
        }
      }

      const gate = proj(0, -0.44, 0);
      ctx.textAlign = 'center';
      ctx.fillStyle = A(0.75);
      ctx.fillText('fee-payer counter-signs 0x76', gate.x, gate.y);
      ctx.fillStyle = D(0.3);
      ctx.fillText('gas owed', a0.x, a0.y + 20);
      ctx.fillStyle = A(0.75);
      ctx.fillText('you paid $0.001', b0.x, b0.y + 20);
    };

    /* ── MCP tool orbit ─────────────────────────────────────── */
    const tools = (t: number) => {
      const cx = w * 0.5, cy = h * 0.52;
      ctx.font = MONO;
      ctx.textBaseline = 'middle';
      const S = Math.min(w * 0.5 - 104, h * 0.46);
      const spin = reduce ? 0.5 : t * 0.00009;
      const TILT = 0.42;

      const proj = (x: number, y: number, z: number) => {
        const c = Math.cos(spin), s = Math.sin(spin);
        const x1 = x * c + z * s, z1 = -x * s + z * c;
        const y1 = y * Math.cos(TILT) - z1 * Math.sin(TILT);
        const z2 = y * Math.sin(TILT) + z1 * Math.cos(TILT);
        const k = 3.4 / (3.4 - z2 * 0.55);
        return { x: cx + x1 * S * k, y: cy + y1 * S * k, k, z: z2 };
      };

      // Dense orbit path.
      const orbit = [];
      for (let i = 0; i <= 120; i++) {
        const a2 = (i / 120) * 6.284;
        orbit.push(proj(Math.cos(a2), 0, Math.sin(a2)));
      }
      lines.path(orbit, 0.12);

      const agent = proj(0, 0, 0);
      const nodes = TOOLS.map((name, i) => {
        const a2 = (i / TOOLS.length) * 6.284;
        const v = proj(Math.cos(a2), 0, Math.sin(a2));
        const raw = reduce ? 0.45 : ((t * 0.00017 + i / TOOLS.length) % 1);
        return { name, ...v, raw, i };
      }).sort((a, b) => a.z - b.z);

      for (const n of nodes) {
        const near = n.z > 0;
        lines.seg(agent.x, agent.y, n.x, n.y, near ? 0.16 : 0.07);
        const out = n.raw < 0.5;
        const u = out ? n.raw * 2 : (1 - n.raw) * 2;
        const live = u > 0.55;
        for (let g = 0; g < 4; g++) batch.push(n.x, n.y, (live ? 8 : 5) - g, live ? 0.85 : near ? 0.45 : 0.2);
        // Comet trail on the call.
        const ct = [];
        for (let s2 = 0; s2 <= 22; s2++) {
          const uu = Math.max(0, u - s2 * 0.014);
          ct.push({ x: agent.x + (n.x - agent.x) * uu, y: agent.y + (n.y - agent.y) * uu });
        }
        lines.path(ct, 0.7, 0.0);
        for (let s2 = 0; s2 <= 22; s2++) batch.push(ct[s2].x, ct[s2].y, 5, 0.22 * (1 - s2 / 22));
        const dirx = n.x - agent.x;
        ctx.textAlign = dirx < -6 ? 'right' : dirx > 6 ? 'left' : 'center';
        const lx = n.x + (dirx < -6 ? -9 : dirx > 6 ? 9 : 0);
        const ly = n.y + (Math.abs(dirx) <= 6 ? (n.y < agent.y ? -11 : 11) : 0);
        ctx.fillStyle = live ? A(0.9) : D(near ? 0.3 : 0.15);
        ctx.fillText(n.name, lx, ly);
      }

      for (let g = 0; g < 7; g++) batch.push(agent.x, agent.y, 13 - g, 0.5);
      ctx.textAlign = 'center';
      ctx.fillStyle = A(0.7);
      ctx.fillText('your agent', agent.x, agent.y + 20);
    };

    const MOTIFS = { race, markets, sponsor, tools };

    const draw = (t: number) => {
      if (!w || !h) return;
      batch.reset();
      lines.reset();
      ctx.clearRect(0, 0, w, h);
      MOTIFS[motif](t);
      // Lines first (structure), then points on top (glow and packets).
      points?.draw(batch, glc.width, glc.height, dpr);
      points?.drawLines(lines, glc.width, glc.height, dpr);
      if (running && !reduce) raf = requestAnimationFrame(draw);
    };

    resize();
    draw(0);

    const ro = new ResizeObserver(() => { resize(); draw(performance.now()); });
    ro.observe(glc);
    const io = new IntersectionObserver(([e]) => {
      running = e.isIntersecting;
      cancelAnimationFrame(raf);
      if (running && !reduce) raf = requestAnimationFrame(draw);
    }, { threshold: 0 });
    io.observe(glc);
    const onVis = () => {
      if (document.hidden) cancelAnimationFrame(raf);
      else if (running && !reduce) raf = requestAnimationFrame(draw);
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect(); io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      points?.dispose();
    };
  }, [motif]);

  return (
    <div className={`csgl ${className}`} aria-hidden="true">
      <canvas ref={glRef} className="csgl__gl" />
      <canvas ref={ovRef} className="csgl__overlay" />
    </div>
  );
}
