'use client';

import { useEffect, useRef } from 'react';

/**
 * SectionField: literal, labelled diagrams of the product, drawn on canvas.
 *
 * The reference (globalsettlement.com) works because its globe is a
 * recognisable object: real continent shapes in dot-matrix, arcs between real
 * places. You know what it is at a glance. Abstract particles and sine waves
 * would have read as decoration for any company.
 *
 * So every motif here is built from Suwappu's actual named entities: real
 * chain names, the real routing providers from stats.generated.json, real
 * market tickers, real MCP tool names. The labels are the point. Without them
 * this is wallpaper.
 *
 * Shared behaviour: deterministic layout (no Math.random, so nothing shimmers
 * on resize), DPR-aware sizing, one static frame under prefers-reduced-motion,
 * and painting stops entirely when the section leaves the viewport.
 */

export { JOURNEYS };

export type Motif = 'chains' | 'race' | 'markets' | 'sponsor' | 'tools';

import productStats from '@/data/stats.generated.json';

const ACCENT = '246, 169, 60';
const productStatsRouterCount = productStats.routerCount;

/** Real chains, from bot/config/chains.py. Positions are hand-placed so the
 *  graph is stable and legible rather than a random scatter. */
const CHAINS: Array<[string, number, number]> = [
  ['Ethereum', 0.50, 0.16],
  ['Base', 0.28, 0.30],
  ['Arbitrum', 0.72, 0.29],
  ['Optimism', 0.16, 0.52],
  ['Solana', 0.84, 0.52],
  ['Polygon', 0.30, 0.74],
  ['BSC', 0.70, 0.75],
  ['Avalanche', 0.50, 0.88],
  ['Tron', 0.06, 0.76],
  ['Starknet', 0.94, 0.76],
  ['HyperEVM', 0.10, 0.14],
  ['Tempo', 0.90, 0.13],
];

/** Multi-stage journeys. Cross-chain is never one hop: the source asset is
 *  swapped on its own chain, bridged, then swapped again on the destination.
 *  Bridges named here are real providers from stats.generated.json. */
export type Leg = { kind: 'swap' | 'bridge'; venue: string; note: string };
export type Journey = {
  fromChain: string; fromToken: string;
  toChain: string;   toToken: string;
  legs: [Leg, Leg, Leg];
};

const JOURNEYS: Journey[] = [
  {
    fromChain: 'Base', fromToken: 'USDC', toChain: 'Tron', toToken: 'USDT',
    legs: [
      { kind: 'swap',   venue: 'Base DEX',  note: 'USDC to bridge asset' },
      { kind: 'bridge', venue: 'best bridge', note: 'Base to Tron' },
      { kind: 'swap',   venue: 'SunSwap',   note: 'to USDT on Tron' },
    ],
  },
  {
    fromChain: 'Base', fromToken: 'USDC', toChain: 'Solana', toToken: 'SOL',
    legs: [
      { kind: 'swap',   venue: 'Base DEX',  note: 'USDC to bridge asset' },
      { kind: 'bridge', venue: 'best bridge', note: 'Base to Solana' },
      { kind: 'swap',   venue: 'Jupiter',   note: 'to SOL on Solana' },
    ],
  },
  {
    fromChain: 'Tron', fromToken: 'USDT', toChain: 'Solana', toToken: 'USDC',
    legs: [
      { kind: 'swap',   venue: 'SunSwap',   note: 'USDT to bridge asset' },
      { kind: 'bridge', venue: 'best bridge', note: 'Tron to Solana' },
      { kind: 'swap',   venue: 'Jupiter',   note: 'to USDC on Solana' },
    ],
  },
];

/** Real providers from stats.generated.json, with plausible relative quotes. */
const PROVIDERS: Array<[string, number]> = [
  ['Li.Fi', 1.0],
  ['CoW', 0.94],
  ['OKX', 0.9],
  ['1inch', 0.86],
  ['KyberSwap', 0.83],
  ['Jupiter', 0.79],
  ['Across', 0.75],
  ['Wormhole', 0.71],
];

const MARKETS = ['BTC-PERP', 'ETH-PERP', 'SOL-PERP'];

/** Real tool names from api-ts/src/routes/mcp.ts. */
const TOOLS = [
  'get_quote', 'execute_swap', 'get_portfolio', 'perps_quote',
  'predict_markets', 'lend_markets', 'list_chains', 'get_prices',
];

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
    let raf = 0, running = false, w = 0, h = 0;

    const a = (o: number) => `rgba(${accent}, ${o})`;
    const dim = (o: number) => `rgba(255, 255, 255, ${o})`;
    const MONO = '11px ui-monospace, SFMono-Regular, Menlo, monospace';

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = cv.clientWidth; h = cv.clientHeight;
      if (!w || !h) return;
      cv.width = Math.floor(w * dpr);
      cv.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    /* ── The chain sphere ────────────────────────────────────────
       A dense dot-matrix sphere, hand-projected: ~1100 points on a Fibonacci
       lattice, rotated, perspective-projected and depth-shaded, with the real
       chain names pinned to fixed coordinates and great-circle routes lifting
       off the surface. Same device as the reference globe, but the body is the
       multichain surface rather than Earth, so it depicts what we actually do.
       Hand-rolled rather than pulling in three.js: this is ~10KB, not 500KB. */
    const DOTS = 3600;
    const GOLDEN = Math.PI * (3 - Math.sqrt(5));

    // Fixed lattice, built once per resize.
    let lattice: Array<{ x: number; y: number; z: number }> = [];
    const buildLattice = () => {
      lattice = [];
      for (let i = 0; i < DOTS; i++) {
        const y = 1 - (i / (DOTS - 1)) * 2;
        const r = Math.sqrt(Math.max(0, 1 - y * y));
        const th = i * GOLDEN;
        lattice.push({ x: Math.cos(th) * r, y, z: Math.sin(th) * r });
      }
    };
    buildLattice();

    // Chain anchors as (lat, lon) in degrees, spread so labels do not stack.
    const ANCHORS: Array<[string, number, number]> = [
      ['Ethereum', 34, 12], ['Base', 12, 58], ['Arbitrum', -8, 104],
      ['Optimism', 26, 150], ['Solana', -30, 196], ['Polygon', 8, 242],
      ['BSC', -18, 288], ['Avalanche', 40, 322], ['Tron', -44, 68],
      ['Starknet', 52, 200], ['HyperEVM', -12, 340], ['Tempo', 20, 262],
    ];
    const toVec = (lat: number, lon: number) => {
      const a1 = (lat * Math.PI) / 180, a2 = (lon * Math.PI) / 180;
      return { x: Math.cos(a1) * Math.cos(a2), y: Math.sin(a1), z: Math.cos(a1) * Math.sin(a2) };
    };
    const ANCHOR_V = ANCHORS.map(([n, la, lo]) => ({ n, ...toVec(la, lo) }));

    const sphere = (t: number) => {
      const R = Math.min(w, h) * 0.355;
      const cx = w * 0.5, cy = h * 0.5;
      const spin = reduce ? 0.6 : t * 0.00009;
      const FOV = 3.2;

      const rot = (v: { x: number; y: number; z: number }) => {
        const c = Math.cos(spin), s2 = Math.sin(spin);
        const x = v.x * c + v.z * s2;
        const z = -v.x * s2 + v.z * c;
        // Slight tilt so it reads as a sphere, not a disc.
        const y = v.y * 0.94 - z * 0.12;
        return { x, y, z: z * 0.94 + v.y * 0.12 };
      };
      const proj = (v: { x: number; y: number; z: number }) => {
        const k = FOV / (FOV - v.z);
        return { x: cx + v.x * R * k, y: cy + v.y * R * k, k, z: v.z };
      };

      // Solid body first: occludes the page grid and gives the dots a surface
      // to sit on. Lit from the same up-left key as the dots below.
      const bg = ctx.createRadialGradient(
        cx - R * 0.32, cy - R * 0.34, R * 0.05, cx, cy, R
      );
      bg.addColorStop(0, 'rgba(46, 32, 18, 0.95)');
      bg.addColorStop(0.55, 'rgba(24, 18, 12, 0.95)');
      bg.addColorStop(1, 'rgba(11, 9, 8, 0.95)');
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.284);
      ctx.fillStyle = bg; ctx.fill();

      // A crisp terminator edge reads as a sphere silhouette.
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.284);
      ctx.strokeStyle = a(0.16); ctx.lineWidth = 1; ctx.stroke();

      // Limb glow, so the body reads as volume.
      const lg = ctx.createRadialGradient(cx, cy, R * 0.72, cx, cy, R * 1.16);
      lg.addColorStop(0, a(0));
      lg.addColorStop(0.6, a(0.09));
      lg.addColorStop(1, a(0));
      ctx.beginPath(); ctx.arc(cx, cy, R * 1.16, 0, 6.284);
      ctx.fillStyle = lg; ctx.fill();

      // The surface. Back hemisphere first so the front overlays it.
      ctx.save();
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.284); ctx.clip();
      for (let li = 0; li < lattice.length; li++) {
        const v = rot(lattice[li]);
        if (v.z <= 0.04) continue; // only the face we can see
        const s3 = proj(v);
        // Lambert-ish term against a fixed up-left key light.
        const lam = Math.max(0, v.x * -0.42 + v.y * 0.44 + v.z * 0.79);
        ctx.beginPath();
        ctx.arc(s3.x, s3.y, 0.85 * s3.k * 0.6, 0, 6.284);
        ctx.fillStyle = a(0.10 + lam * 0.92);
        ctx.fill();
      }
      ctx.restore();

      ctx.font = MONO;
      ctx.textBaseline = 'middle';

      // ── The multi-stage journey ─────────────────────────────
      // Three legs, in sequence: swap on the source chain, bridge across,
      // swap again on the destination. The stage that is currently executing
      // is the one that lights up.
      const per = 7200;
      const jIdx = reduce ? 0 : Math.floor(t / per) % JOURNEYS.length;
      const jp = reduce ? 0.5 : ((t % per) / per);
      const J = JOURNEYS[jIdx];

      const byName = (n: string) =>
        ANCHOR_V.find((v) => v.n === n) ?? ANCHOR_V[0];
      const A = byName(J.fromChain), B = byName(J.toChain);

      // Legs occupy 0-0.28 (swap), 0.28-0.72 (bridge), 0.72-1 (swap).
      const stage = jp < 0.28 ? 0 : jp < 0.72 ? 1 : 2;
      const bridgeU = Math.max(0, Math.min(1, (jp - 0.28) / 0.44));

      const dot2 = Math.max(-1, Math.min(1, A.x * B.x + A.y * B.y + A.z * B.z));
      const omega = Math.acos(dot2) || 0.0001;
      const arcPt = (u: number) => {
        const s1 = Math.sin((1 - u) * omega) / Math.sin(omega);
        const s2 = Math.sin(u * omega) / Math.sin(omega);
        const lift = 1 + 0.24 * Math.sin(Math.PI * u);
        return rot({
          x: (A.x * s1 + B.x * s2) * lift,
          y: (A.y * s1 + B.y * s2) * lift,
          z: (A.z * s1 + B.z * s2) * lift,
        });
      };

      // Whole path, faint.
      ctx.beginPath();
      for (let i = 0; i <= 56; i++) {
        const q = proj(arcPt(i / 56));
        i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y);
      }
      ctx.strokeStyle = a(0.28); ctx.lineWidth = 1; ctx.stroke();

      // Travelled portion.
      if (stage >= 1) {
        ctx.beginPath();
        for (let i = 0; i <= 40; i++) {
          const q = proj(arcPt((i / 40) * bridgeU));
          i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y);
        }
        ctx.strokeStyle = a(0.85); ctx.lineWidth = 1.9; ctx.stroke();
        const head = proj(arcPt(bridgeU));
        ctx.beginPath(); ctx.arc(head.x, head.y, 3.2, 0, 6.284);
        ctx.fillStyle = a(1); ctx.fill();
      }

      // Endpoint pulses while its swap leg runs.
      const pulse = (v: typeof A, on: boolean) => {
        const q = proj(rot(v));
        ctx.beginPath(); ctx.arc(q.x, q.y, on ? 9 : 5.5, 0, 6.284);
        ctx.strokeStyle = a(on ? 0.75 : 0.3);
        ctx.lineWidth = on ? 1.8 : 1; ctx.stroke();
      };
      pulse(A, stage === 0);
      pulse(B, stage === 2);

      // Chain anchors, drawn front-to-back so labels never sit behind the body.
      const anchors = ANCHOR_V.map((v) => {
        const r2 = rot(v); return { n: v.n, ...proj(r2), zz: r2.z };
      }).sort((p1, p2) => p1.zz - p2.zz);

      const placed: Array<{ x: number; y: number }> = [];
      for (const p2 of anchors) {
        const front = p2.zz > 0;
        if (!front) continue;
        const fade = Math.min(1, p2.zz * 2.2);
        ctx.beginPath(); ctx.arc(p2.x, p2.y, 2.8 * p2.k * 0.8, 0, 6.284);
        ctx.fillStyle = a(0.55 * fade + 0.25); ctx.fill();
        ctx.beginPath(); ctx.arc(p2.x, p2.y, 5.5 * p2.k * 0.8, 0, 6.284);
        ctx.strokeStyle = a(0.22 * fade); ctx.lineWidth = 1; ctx.stroke();
        // Two anchors near the limb can project on top of each other.
        const clash = placed.some((q) => Math.abs(q.x - p2.x) < 62 && Math.abs(q.y - p2.y) < 14);
        if (!clash) {
          placed.push({ x: p2.x, y: p2.y - 12 });
          ctx.textAlign = 'center';
          ctx.fillStyle = dim(0.16 + 0.30 * fade);
          ctx.fillText(p2.n, p2.x, p2.y - 12);
        }
      }
    };

    /* ── The quote race, in 3D ───────────────────────────────────
       Every provider that supports the route quotes it at once. This is that
       race as a braid: one source node, one destination node, and a bundle of
       paths bowing through 3D space between them, one per provider. Each
       packet travels at its provider's pace; the winner arrives first and its
       path stays lit while the rest fade back.
       Same hand-rolled projection as the sphere, so the two objects share a
       camera and read as one family. */
    const race = (t: number) => {
      const cx = w * 0.5, cy = h * 0.5;
      // Separate axes: the braid is naturally wide, so it fills the band
      // horizontally while the bow stays proportional to the height.
      ctx.font = MONO;
      const narrow = w < 560;
      // Reserve room for the end labels so they can never run off an edge.
      const endPad = Math.max(ctx.measureText('your order').width,
                              ctx.measureText('best fill').width) + 18;
      const SX = Math.max(60, (w / 2) - endPad) * 0.98;
      const SY = Math.min(h * 0.36, w * 0.12);
      const spin = reduce ? 0.55 : t * 0.00007;
      const FOV = 3.4;

      const rot3 = (x: number, y: number, z: number) => {
        const c = Math.cos(spin), sn = Math.sin(spin);
        const rx = x * c + z * sn;
        const rz = -x * sn + z * c;
        return { x: rx, y: y * 0.92 - rz * 0.1, z: rz };
      };
      const proj3 = (x: number, y: number, z: number) => {
        const v = rot3(x, y, z);
        const k = FOV / (FOV - v.z * 0.6);
        return { x: cx + v.x * SX * k, y: cy + v.y * SY * k, k, z: v.z };
      };

      const cycle = 6000;
      const phase = reduce ? 1 : Math.min(1.12, ((t % cycle) / cycle) * 1.28);
      const N = PROVIDERS.length;

      // Source and destination anchors, on the axis.
      const A = proj3(-1, 0, 0), B = proj3(1, 0, 0);

      ctx.font = MONO;
      ctx.textBaseline = 'middle';

      // Depth-sort the strands so nearer ones overlay farther ones.
      const strands = PROVIDERS.map(([name, pace], i) => {
        const ang = (i / N) * 6.284;
        return { name, pace, ang, i, depth: Math.cos(ang) };
      }).sort((p, q) => p.depth - q.depth);

      for (const st of strands) {
        // Each strand bows out on its own plane around the source-destination
        // axis, so the bundle reads as a braid rather than a flat fan.
        const bow = 0.5 + (st.i % 3) * 0.1;
        const pt = (u: number) => {
          const swell = Math.sin(Math.PI * u) * bow;
          return proj3(
            -1 + 2 * u,
            Math.sin(st.ang) * swell,
            Math.cos(st.ang) * swell
          );
        };

        const near = st.depth > 0;
        const p = Math.min(1, phase * st.pace);
        const won = st.i === 0 && p >= 1;

        // The full strand.
        ctx.beginPath();
        for (let k = 0; k <= 26; k++) {
          const q = pt(k / 26);
          k ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y);
        }
        ctx.strokeStyle = won ? a(0.5) : dim(near ? 0.07 : 0.04);
        ctx.lineWidth = won ? 1.6 : 1;
        ctx.stroke();

        // The travelled head.
        ctx.beginPath();
        const from = Math.max(0, p - 0.3);
        for (let k = 0; k <= 16; k++) {
          const q = pt(from + (p - from) * (k / 16));
          k ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y);
        }
        ctx.strokeStyle = won ? a(0.95) : a(near ? 0.4 : 0.2);
        ctx.lineWidth = won ? 2.2 : 1.3;
        ctx.stroke();

        const head = pt(p);
        ctx.beginPath();
        ctx.arc(head.x, head.y, (won ? 3.2 : 2) * head.k * 0.85, 0, 6.284);
        ctx.fillStyle = won ? a(1) : a(near ? 0.7 : 0.35);
        ctx.fill();

        // Only near strands label, and only once clear of the start, or the
        // names pile up on top of each other at the source node.
        if ((won || (!narrow && near)) && p > 0.18) {
          ctx.textAlign = 'center';
          ctx.fillStyle = won ? a(0.95) : dim(0.28);
          ctx.fillText(st.name, head.x, head.y - 11);
        }
      }

      // Endpoints.
      for (const [q, label, align] of [
        [A, 'your order', 'right'],
        [B, 'best fill', 'left'],
      ] as const) {
        ctx.beginPath();
        ctx.arc(q.x, q.y, 5, 0, 6.284);
        ctx.strokeStyle = a(0.75); ctx.lineWidth = 1.6; ctx.stroke();
        ctx.textAlign = align;
        ctx.fillStyle = a(0.65);
        ctx.fillText(label, q.x + (align === 'right' ? -12 : 12), q.y);
      }

      ctx.textAlign = 'center';
      ctx.fillStyle = dim(0.2);
      ctx.fillText(`${productStatsRouterCount} providers quote at once`, cx, h - 14);
    };

    /* ── Perp markets, in 3D ─────────────────────────────────────
       Three real perp markets as price ribbons receding into depth, with a
       live order-book ladder standing at the near edge: bids below the mid,
       asks above, rung length by size. The front market carries a position
       marker on its entry. Same projection and camera as the other objects.
       The series are deterministic layered sines, not live data, so the
       object is labelled as an illustration. */
    const markets = (t: number) => {
      const cx = w * 0.5, cy = h * 0.5;
      const SX = w * 0.4, SY = Math.min(h * 0.42, w * 0.14);
      const drift = reduce ? 0 : t * 0.00016;
      // At phone widths three ribbons plus a book ladder do not fit: the
      // tickers clipped at the left edge and the position marker collided
      // with the book label. Narrow shows one market and no ladder.
      const narrow = w < 520;

      const proj3 = (x: number, y: number, z: number) => {
        const yaw = 0.72, pitch = 0.3, FOV = 3.6;
        const x1 = x * Math.cos(yaw) + z * Math.sin(yaw);
        const z1 = -x * Math.sin(yaw) + z * Math.cos(yaw);
        const y1 = y * Math.cos(pitch) - z1 * Math.sin(pitch);
        const z2 = y * Math.sin(pitch) + z1 * Math.cos(pitch);
        const k = FOV / (FOV - z2 * 0.5);
        return { x: cx + x1 * SX * k, y: cy + y1 * SY * k, k, z: z2 };
      };

      ctx.font = MONO;
      ctx.textBaseline = 'middle';

      const series = (i: number, k: number) =>
        Math.sin(i * (0.2 + k * 0.05) + drift * (1 + k * 0.35)) * 0.55 +
        Math.sin(i * (0.073 + k * 0.02) + drift * 0.7) * 0.34;

      // Labels are measured, so the ribbon always starts clear of the edge.
      const pad = 8;
      const widest = Math.max(...MARKETS.map((m) => ctx.measureText(m).width));
      const x0 = narrow ? -0.42 : -0.62;

      const lanes = narrow ? [0] : [2, 1, 0];
      for (const k of lanes) {
        const z = narrow ? 0 : -0.55 + k * 0.55;
        const near = k === 0;

        ctx.beginPath();
        for (let i = 0; i <= 64; i++) {
          const q = proj3(x0 + (i / 64) * (narrow ? 1.0 : 1.3), series(i, k) * 0.26, z);
          i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y);
        }
        ctx.strokeStyle = near ? a(0.85) : a(0.3 - k * 0.08);
        ctx.lineWidth = near ? 1.9 : 1.2;
        ctx.stroke();

        const head = proj3(x0, series(0, k) * 0.26, z);
        ctx.textAlign = 'left';
        ctx.fillStyle = near ? a(0.9) : dim(0.26);
        // Clamp so the ticker can never run past the left edge.
        ctx.fillText(MARKETS[k], Math.max(pad, head.x - widest - 6), head.y);

        if (near) {
          ctx.beginPath();
          const e0 = proj3(x0, 0, z), e1 = proj3(x0 + (narrow ? 1.0 : 1.3), 0, z);
          ctx.moveTo(e0.x, e0.y); ctx.lineTo(e1.x, e1.y);
          ctx.setLineDash([3, 5]);
          ctx.strokeStyle = dim(0.14); ctx.lineWidth = 1; ctx.stroke();
          ctx.setLineDash([]);

          const now = proj3(x0 + (narrow ? 1.0 : 1.3), series(64, k) * 0.26, z);
          ctx.beginPath(); ctx.arc(now.x, now.y, 3.2, 0, 6.284);
          ctx.fillStyle = a(1); ctx.fill();
          const lbl = 'long 20x';
          const lw = ctx.measureText(lbl).width;
          ctx.textAlign = 'left';
          ctx.fillStyle = a(0.9);
          ctx.fillText(lbl, Math.min(now.x + 8, w - lw - pad), now.y);
        }
      }

      if (!narrow) {
        const LEVELS = 9;
        for (let i = 0; i < LEVELS; i++) {
          const f = (i - (LEVELS - 1) / 2) / LEVELS;
          const y = f * 0.44;
          const size = 0.1 + ((i * 7) % 5) * 0.052;
          const bid = f < 0;
          const r0 = proj3(0.76, y, 0.55);
          const r1 = proj3(0.76, y, 0.55 - size);
          ctx.beginPath();
          ctx.moveTo(r0.x, r0.y); ctx.lineTo(r1.x, r1.y);
          ctx.strokeStyle = bid ? a(0.55) : dim(0.16);
          ctx.lineWidth = 2.4;
          ctx.stroke();
        }
        const bookTop = proj3(0.76, 0.32, 0.55);
        ctx.textAlign = 'right';
        ctx.fillStyle = dim(0.26);
        ctx.fillText('order book', bookTop.x - 6, bookTop.y);
      }

      ctx.textAlign = 'left';
      ctx.fillStyle = dim(0.16);
      ctx.fillText('illustrative', pad, 10);
    };

    /* ── Tempo sponsorship, in 3D ────────────────────────────────
       The mechanic drawn literally: transactions fly down a lane toward
       settlement, each carrying the gas it owes. At the midpoint sits the
       fee-payer, a ring seen in perspective. Crossing it, the gas detaches
       and is pulled into the fee-payer, which counter-signs (type 0x76), and
       the transaction continues and settles having paid a tenth of a cent.
       Same projection and camera as the sphere and the braid. */
    const sponsor = (t: number) => {
      const cx = w * 0.5, cy = h * 0.5;
      const SX = w * 0.46, SY = Math.min(h * 0.4, w * 0.1);
      const spin = reduce ? 0.4 : t * 0.00013;
      const FOV = 3.6;

      // The lane runs along x; the gate is a ring in the y/z plane at x = 0.
      const proj3 = (x: number, y: number, z: number) => {
        // Fixed three-quarter camera so the ring reads as a circle in space.
        const yaw = 0.62, pitch = 0.26;
        const x1 = x * Math.cos(yaw) + z * Math.sin(yaw);
        const z1 = -x * Math.sin(yaw) + z * Math.cos(yaw);
        const y1 = y * Math.cos(pitch) - z1 * Math.sin(pitch);
        const z2 = y * Math.sin(pitch) + z1 * Math.cos(pitch);
        const k = FOV / (FOV - z2 * 0.5);
        return { x: cx + x1 * SX * k, y: cy + y1 * SY * k, k, z: z2 };
      };

      ctx.font = MONO;
      ctx.textBaseline = 'middle';

      // The lane itself.
      const laneA = proj3(-0.82, 0, 0), laneB = proj3(0.82, 0, 0);
      ctx.beginPath();
      ctx.moveTo(laneA.x, laneA.y); ctx.lineTo(laneB.x, laneB.y);
      ctx.strokeStyle = dim(0.08); ctx.lineWidth = 1; ctx.stroke();

      // Packets, staggered so one is always at the gate.
      const LANES = 4;
      const packets = Array.from({ length: LANES }, (_, i) => {
        const u = reduce ? 0.28 + i * 0.2 : ((t * 0.00013 + i / LANES) % 1);
        const off = (i - (LANES - 1) / 2) * 0.09;
        return { u, x: -0.82 + 1.64 * u, y: off * 0.5, z: off, i };
      });

      // Label only the packet closest to the gate.
      let leadIdx = 0, leadD = 9;
      for (const pk of packets) {
        const d = Math.abs(pk.x);
        if (d < leadD) { leadD = d; leadIdx = pk.i; }
      }

      // Behind-the-gate packets first.
      const drawPacket = (pk: typeof packets[number]) => {
        const q = proj3(pk.x, pk.y, pk.z);
        ctx.beginPath();
        ctx.arc(q.x, q.y, 3.4 * q.k * 0.7, 0, 6.284);
        ctx.fillStyle = a(0.9); ctx.fill();
        if (pk.i === leadIdx) {
          ctx.textAlign = 'center';
          ctx.fillStyle = dim(0.32);
          ctx.fillText('100 USDC', q.x, q.y - 14);
        }

        if (pk.x < 0) {
          // Still carrying the gas it owes.
          const g = proj3(pk.x, pk.y + 0.16, pk.z);
          ctx.beginPath();
          ctx.arc(g.x, g.y, 2.2 * g.k * 0.7, 0, 6.284);
          ctx.fillStyle = dim(0.42); ctx.fill();
        } else {
          // Released at the gate and drawn into the fee-payer.
          const pull = Math.min(1, pk.x * 3.2);
          const gx = pk.x * (1 - pull), gy = (pk.y + 0.16) * (1 - pull) + 0.16 * pull;
          const g = proj3(gx, gy, pk.z * (1 - pull));
          ctx.beginPath();
          ctx.arc(g.x, g.y, 2.2 * g.k * 0.7 * (1 - pull), 0, 6.284);
          ctx.fillStyle = `rgba(255,255,255,${0.42 * (1 - pull)})`;
          ctx.fill();
        }
      };

      packets.filter((pk) => pk.x <= 0).forEach(drawPacket);

      // The fee-payer gate: a ring of dots in the y/z plane, slowly turning.
      const RING = 76;
      let crossing = 0;
      for (const pk of packets) if (Math.abs(pk.x) < 0.12) crossing = 1 - Math.abs(pk.x) / 0.12;
      for (let i = 0; i < RING; i++) {
        const ang = (i / RING) * 6.284 + spin;
        const q = proj3(0, Math.sin(ang) * 0.34, Math.cos(ang) * 0.34);
        ctx.beginPath();
        ctx.arc(q.x, q.y, (1.5 + crossing * 1.1) * q.k * 0.72, 0, 6.284);
        ctx.fillStyle = a(0.5 + crossing * 0.45);
        ctx.fill();
      }
      // Counter-sign pulse as a packet passes through.
      if (crossing > 0.02) {
        for (let i = 0; i < RING; i += 2) {
          const ang = (i / RING) * 6.284 + spin;
          const rr = 0.34 + (1 - crossing) * 0.3;
          const q = proj3(0, Math.sin(ang) * rr, Math.cos(ang) * rr);
          ctx.beginPath();
          ctx.arc(q.x, q.y, 1.1 * q.k * 0.7, 0, 6.284);
          ctx.fillStyle = a(0.3 * crossing);
          ctx.fill();
        }
      }

      packets.filter((pk) => pk.x > 0).forEach(drawPacket);

      // Endpoint and gate labels.
      const gate = proj3(0, -0.44, 0);
      ctx.textAlign = 'center';
      ctx.fillStyle = a(0.75);
      ctx.fillText('fee-payer counter-signs 0x76', gate.x, gate.y);

      ctx.textAlign = 'center';
      ctx.fillStyle = dim(0.3);
      ctx.fillText('gas owed', laneA.x, laneA.y + 20);
      ctx.fillStyle = a(0.75);
      ctx.fillText('you paid $0.001', laneB.x, laneB.y + 20);
    };

    /* ── MCP tool calls, in 3D ───────────────────────────────────
       The agent sits at the centre of a ring of its tools, tilted and turning
       so the ring reads as an orbit rather than a flat wheel. Calls travel out
       along a spoke and return along it, and each tool lights while its call
       is in flight. Depth-sorted so the far side passes behind the agent.
       Tool names are the real registry from api-ts/src/routes/mcp.ts. */
    const tools = (t: number) => {
      const cx = w * 0.5, cy = h * 0.52;
      // Longest name is ~15 chars at 11px mono, about 92px, plus a 9px gap.
      const S = Math.min(w * 0.5 - 104, h * 0.46);
      const spin = reduce ? 0.5 : t * 0.00009;
      const TILT = 0.42;

      const proj3 = (x: number, y: number, z: number) => {
        const c = Math.cos(spin), sn = Math.sin(spin);
        const x1 = x * c + z * sn;
        const z1 = -x * sn + z * c;
        const y1 = y * Math.cos(TILT) - z1 * Math.sin(TILT);
        const z2 = y * Math.sin(TILT) + z1 * Math.cos(TILT);
        const FOV = 3.4;
        const k = FOV / (FOV - z2 * 0.55);
        return { x: cx + x1 * S * k, y: cy + y1 * S * k, k, z: z2 };
      };

      ctx.font = MONO;
      ctx.textBaseline = 'middle';

      // The orbit path itself.
      ctx.beginPath();
      for (let i = 0; i <= 72; i++) {
        const a2 = (i / 72) * 6.284;
        const q = proj3(Math.cos(a2), 0, Math.sin(a2));
        i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y);
      }
      ctx.strokeStyle = dim(0.06); ctx.lineWidth = 1; ctx.stroke();

      const nodes = TOOLS.map((name, i) => {
        const a2 = (i / TOOLS.length) * 6.284;
        const v = proj3(Math.cos(a2), 0, Math.sin(a2));
        const raw = reduce ? 0.45 : ((t * 0.00017 + i / TOOLS.length) % 1);
        return { name, ...v, raw, i };
      }).sort((p1, p2) => p1.z - p2.z);

      const agent = proj3(0, 0, 0);

      // Far half first, then the agent, then the near half, so the ring
      // genuinely passes behind the centre.
      const draw = (n: typeof nodes[number]) => {
        const near = n.z > 0;
        ctx.beginPath();
        ctx.moveTo(agent.x, agent.y); ctx.lineTo(n.x, n.y);
        ctx.strokeStyle = dim(near ? 0.07 : 0.035); ctx.lineWidth = 1; ctx.stroke();

        const out = n.raw < 0.5;
        const u = out ? n.raw * 2 : (1 - n.raw) * 2;
        const live = u > 0.55;

        ctx.beginPath();
        ctx.arc(n.x, n.y, (live ? 3 : 2) * n.k * 0.8, 0, 6.284);
        ctx.fillStyle = live ? a(0.9) : a(near ? 0.4 : 0.2);
        ctx.fill();

        // Labels sit outside the ring, clear of the agent.
        const dirx = n.x - agent.x;
        ctx.textAlign = dirx < -6 ? 'right' : dirx > 6 ? 'left' : 'center';
        const lx = n.x + (dirx < -6 ? -9 : dirx > 6 ? 9 : 0);
        const ly = n.y + (Math.abs(dirx) <= 6 ? (n.y < agent.y ? -11 : 11) : 0);
        ctx.fillStyle = live ? a(0.9) : dim(near ? 0.3 : 0.15);
        ctx.fillText(n.name, lx, ly);

        // The call in flight.
        const px = agent.x + (n.x - agent.x) * u;
        const py = agent.y + (n.y - agent.y) * u;
        ctx.beginPath();
        ctx.arc(px, py, 2 * n.k * 0.8, 0, 6.284);
        ctx.fillStyle = out ? a(0.85) : dim(0.5);
        ctx.fill();
      };

      nodes.filter((n) => n.z <= 0).forEach(draw);

      ctx.beginPath();
      ctx.arc(agent.x, agent.y, 5.5, 0, 6.284);
      ctx.strokeStyle = a(0.8); ctx.lineWidth = 1.7; ctx.stroke();
      ctx.textAlign = 'center';
      ctx.fillStyle = a(0.7);
      ctx.fillText('your agent', agent.x, agent.y + 18);

      nodes.filter((n) => n.z > 0).forEach(draw);
    };

    const MOTIFS = { chains: sphere, race, markets, sponsor, tools };

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
