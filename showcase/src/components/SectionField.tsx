'use client';

import { useEffect, useRef } from 'react';

/**
 * SectionField — literal, labelled diagrams of the product, drawn on canvas.
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

const ACCENT = '246, 169, 60';

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

    /* ── The quote race. Real providers, real-shaped numbers. ── */
    const race = (t: number) => {
      const cycle = 5200;
      const phase = reduce ? 1 : Math.min(1, ((t % cycle) / cycle) * 1.35);
      const rows = PROVIDERS.length;
      const gap = Math.min(26, h / (rows + 2));
      const top = h * 0.5 - (rows * gap) / 2;
      const x0 = w * 0.34, span = w * 0.38;

      ctx.font = MONO;
      ctx.textBaseline = 'middle';

      PROVIDERS.forEach(([name, pace], i) => {
        const y = top + i * gap;
        const p = Math.min(1, phase * pace);
        const x = x0 + span * p;
        const won = i === 0 && p >= 1;

        ctx.textAlign = 'right';
        ctx.fillStyle = won ? a(0.95) : dim(0.3);
        ctx.fillText(name, x0 - 10, y);

        ctx.beginPath();
        ctx.moveTo(x0, y); ctx.lineTo(x0 + span, y);
        ctx.strokeStyle = dim(0.06); ctx.lineWidth = 1; ctx.stroke();

        const g = ctx.createLinearGradient(x0, y, x, y);
        g.addColorStop(0, a(0));
        g.addColorStop(1, won ? a(0.95) : a(0.42));
        ctx.beginPath();
        ctx.moveTo(x0, y); ctx.lineTo(x, y);
        ctx.strokeStyle = g; ctx.lineWidth = won ? 2.2 : 1.4; ctx.stroke();

        // The quote each provider returned. Best is on top and wins.
        ctx.textAlign = 'left';
        ctx.fillStyle = won ? a(0.95) : dim(0.26);
        ctx.fillText((0.0517 - i * 0.00004).toFixed(5), x + 7, y);
      });

      ctx.textAlign = 'left';
      ctx.fillStyle = dim(0.22);
      ctx.fillText('best price wins', x0 - 4, top - gap);
      ctx.fillStyle = dim(0.14);
      ctx.fillText('illustrative', x0 - 4, top + rows * gap + 4);
    };

    /* ── Markets. Real perp tickers with their own series. ── */
    const markets = (t: number) => {
      const drift = reduce ? 0 : t * 0.00015;
      const band = h / (MARKETS.length + 0.6);
      ctx.font = MONO;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';

      MARKETS.forEach((m, k) => {
        const cy = band * (k + 0.8);
        const amp = band * 0.3;
        ctx.beginPath();
        for (let i = 0; i <= 80; i++) {
          const v = Math.sin(i * (0.19 + k * 0.05) + drift * (1 + k * 0.4)) * 0.6
                  + Math.sin(i * (0.071 + k * 0.02) + drift * 0.7) * 0.4;
          const x = w * 0.34 + (i / 80) * w * 0.6;
          const y = cy - v * amp;
          i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.strokeStyle = a(k === 0 ? 0.55 : 0.3);
        ctx.lineWidth = 1.3;
        ctx.stroke();

        ctx.fillStyle = dim(0.34);
        ctx.fillText(m, 4, cy);
      });
    };

    /* ── Tempo. A labelled transaction passing a labelled fee-payer. ── */
    const sponsor = (t: number) => {
      const y = h * 0.5, payer = w * 0.5;
      ctx.font = MONO;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';

      ctx.beginPath();
      ctx.moveTo(w * 0.1, y); ctx.lineTo(w * 0.9, y);
      ctx.strokeStyle = dim(0.09); ctx.lineWidth = 1; ctx.stroke();

      ctx.beginPath();
      ctx.arc(payer, y, 6, 0, 6.284);
      ctx.strokeStyle = a(0.7); ctx.lineWidth = 1.6; ctx.stroke();
      ctx.fillStyle = a(0.7);
      ctx.fillText('fee-payer 0x76', payer, y + 22);

      ctx.fillStyle = dim(0.26);
      ctx.fillText('gas owed', w * 0.22, y + 22);
      ctx.fillStyle = a(0.6);
      ctx.fillText('you paid $0.001', w * 0.8, y + 22);

      for (let k = 0; k < 4; k++) {
        const p = reduce ? 0.2 + k * 0.2 : ((t * 0.00017 + k / 4) % 1);
        const x = w * 0.1 + p * w * 0.8;
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, 6.284);
        ctx.fillStyle = a(0.85); ctx.fill();
        ctx.fillStyle = dim(0.3);
        ctx.fillText('100 USDC', x, y - 16);

        if (x < payer) {
          // Carrying the gas cost, which the payer will absorb.
          ctx.beginPath();
          ctx.arc(x, y + 9, 2, 0, 6.284);
          ctx.fillStyle = dim(0.34); ctx.fill();
        } else {
          const since = (x - payer) / (w * 0.9 - payer);
          ctx.beginPath();
          ctx.arc(payer, y, 6 + since * 26, 0, 6.284);
          ctx.strokeStyle = a(Math.max(0, 0.3 * (1 - since)));
          ctx.lineWidth = 1; ctx.stroke();
        }
      }
    };

    /* ── MCP. Real tool names called and returning. ── */
    const tools = (t: number) => {
      const cx = w * 0.5, cy = h * 0.5;
      const rx = Math.min(w * 0.3, 190), ry = Math.min(h * 0.34, 130);
      ctx.font = MONO;
      ctx.textBaseline = 'middle';

      ctx.beginPath();
      ctx.arc(cx, cy, 5, 0, 6.284);
      ctx.strokeStyle = a(0.7); ctx.lineWidth = 1.5; ctx.stroke();
      ctx.textAlign = 'center';
      ctx.fillStyle = a(0.6);
      ctx.fillText('your agent', cx, cy + 20);

      TOOLS.forEach((name, i) => {
        const ang = (i / TOOLS.length) * 6.284 - 1.57;
        const ex = cx + Math.cos(ang) * rx, ey = cy + Math.sin(ang) * ry;

        ctx.beginPath();
        ctx.moveTo(cx, cy); ctx.lineTo(ex, ey);
        ctx.strokeStyle = dim(0.05); ctx.lineWidth = 1; ctx.stroke();

        const raw = reduce ? 0.45 : ((t * 0.00019 + i / TOOLS.length) % 1);
        const out = raw < 0.5;
        const u = out ? raw * 2 : (1 - raw) * 2;
        const active = u > 0.75;

        ctx.textAlign = Math.cos(ang) < -0.2 ? 'right' : Math.cos(ang) > 0.2 ? 'left' : 'center';
        const lx = ex + (Math.cos(ang) < -0.2 ? -8 : Math.cos(ang) > 0.2 ? 8 : 0);
        ctx.fillStyle = active ? a(0.85) : dim(0.24);
        ctx.fillText(name, lx, ey);

        ctx.beginPath();
        ctx.arc(cx + (ex - cx) * u, cy + (ey - cy) * u, 2.2, 0, 6.284);
        ctx.fillStyle = out ? a(0.85) : dim(0.45);
        ctx.fill();
      });
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
