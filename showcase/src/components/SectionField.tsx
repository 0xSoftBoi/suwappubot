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

/** Routes actually worth showing, with the provider that would carry them. */
const HOPS: Array<[number, number, string]> = [
  [1, 2, 'Li.Fi'],
  [0, 4, 'Jupiter'],
  [3, 6, 'OKX'],
  [5, 7, '1inch'],
  [2, 9, 'CoW'],
  [10, 11, 'Across'],
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

    /* ── The chain graph. Named nodes on a ring, real routes across it. ── */
    const chains = (t: number) => {
      // A ring, not a scatter: it frames the copy instead of sitting under it,
      // so no chain label ever collides with the headline.
      const cx = w * 0.5, cy = h * 0.48;
      const rx = w * 0.42, ry = h * 0.36;
      const N = CHAINS.length;
      const P = CHAINS.map(([n], i) => {
        const ang = ((i + 0.5) / N) * 6.284 - 1.57;
        return { n, x: cx + Math.cos(ang) * rx, y: cy + Math.sin(ang) * ry, ang };
      });

      ctx.font = MONO;
      ctx.textBaseline = 'middle';

      // The ring itself, barely there.
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, 6.284);
      ctx.strokeStyle = dim(0.04);
      ctx.lineWidth = 1;
      ctx.stroke();

      for (const p of P) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.6, 0, 6.284);
        ctx.fillStyle = a(0.5);
        ctx.fill();
        // Labels sit outside the ring, pushed along their own radius.
        const lx = p.x + Math.cos(p.ang) * 12;
        const ly = p.y + Math.sin(p.ang) * 12;
        ctx.textAlign = Math.cos(p.ang) < -0.25 ? 'right' : Math.cos(p.ang) > 0.25 ? 'left' : 'center';
        ctx.fillStyle = dim(0.3);
        ctx.fillText(p.n, lx, ly);
      }

      // One route at a time crosses the ring, carrying the provider that won it.
      const per = 3400;
      const idx = reduce ? 0 : Math.floor(t / per) % HOPS.length;
      const prog = reduce ? 0.55 : ((t % per) / per);
      const [fi, ti, prov] = HOPS[idx];
      const A = P[fi % N], B = P[ti % N];

      ctx.beginPath();
      ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y);
      ctx.strokeStyle = a(0.22); ctx.lineWidth = 1.2; ctx.stroke();

      const e = prog < 0.5 ? 2 * prog * prog : 1 - Math.pow(-2 * prog + 2, 2) / 2;
      const hx = A.x + (B.x - A.x) * e, hy = A.y + (B.y - A.y) * e;

      const g = ctx.createLinearGradient(A.x, A.y, hx, hy);
      g.addColorStop(0, a(0)); g.addColorStop(1, a(0.85));
      ctx.beginPath();
      ctx.moveTo(A.x, A.y); ctx.lineTo(hx, hy);
      ctx.strokeStyle = g; ctx.lineWidth = 1.8; ctx.stroke();

      ctx.beginPath();
      ctx.arc(hx, hy, 3, 0, 6.284);
      ctx.fillStyle = a(1); ctx.fill();

      ctx.textAlign = 'center';
      ctx.fillStyle = a(0.8);
      ctx.fillText(prov, hx, hy - 13);

      for (const p of [A, B]) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 5.5, 0, 6.284);
        ctx.strokeStyle = a(0.4); ctx.lineWidth = 1; ctx.stroke();
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

    const MOTIFS = { chains, race, markets, sponsor, tools };

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
