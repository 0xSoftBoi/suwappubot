'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import './charts.css';

/**
 * DailyChart: a small, dependency-free time-series chart (area or bars).
 * Signed scale (values below zero are drawn below the baseline), gridlines with
 * axis labels, crosshair + tooltip on hover/touch, arrow-key navigation, draw-in
 * on first paint (off under reduced motion). Presentation only: callers pass
 * the real series and a formatter. Theme through --ch-* variables.
 */
export type ChartPoint = { label: string; value: number };

export default function DailyChart({
  title, points, format, formatAxis, mode = 'area', height = 190, unit,
}: {
  title: string;
  points: ChartPoint[];
  format: (n: number) => string;
  formatAxis?: (n: number) => string;
  mode?: 'area' | 'bars';
  height?: number;
  /** e.g. ['visitor','visitors'] for the screen-reader summary. */
  unit?: [string, string];
}) {
  const uid = useId().replace(/:/g, '');
  const wrap = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(640);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = points.length;
  const vals = points.map((p) => p.value);
  const top = Math.max(0, ...vals);
  const bottom = Math.min(0, ...vals);
  const span = top - bottom || 1;
  const total = vals.reduce((a, b) => a + b, 0);
  const L = 44, R = 8, T = 10, B = 24;
  const plotW = w - L - R, plotH = height - T - B;
  const y = (v: number) => T + ((top - v) / span) * plotH;
  const zeroY = y(0);
  const slot = plotW / Math.max(1, n);
  const x = (i: number) => (mode === 'bars' ? L + slot * i + slot / 2 : L + (n > 1 ? (plotW * i) / (n - 1) : plotW / 2));
  const axis = formatAxis ?? format;
  const ticks = bottom < 0 ? [top, 0, bottom] : [top, top / 2, 0];
  const tickEvery = Math.max(1, Math.ceil(n / (w < 420 ? 4 : 7)));
  const u = (v: number) => (unit ? ` ${v === 1 ? unit[0] : unit[1]}` : '');

  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const area = n ? `${line} L${x(n - 1).toFixed(1)},${zeroY.toFixed(1)} L${x(0).toFixed(1)},${zeroY.toFixed(1)} Z` : '';

  const fromEvent = useCallback((clientX: number) => {
    const r = wrap.current?.getBoundingClientRect();
    if (!r || !n) return;
    const rel = clientX - r.left - L;
    const i = mode === 'bars' ? Math.floor(rel / slot) : Math.round((rel / plotW) * (n - 1));
    setActive(Math.min(n - 1, Math.max(0, i)));
  }, [n, mode, slot, plotW]);

  const onKey = (e: React.KeyboardEvent) => {
    const cur = active ?? n - 1;
    const map: Record<string, number> = { ArrowRight: cur + 1, ArrowLeft: cur - 1, Home: 0, End: n - 1 };
    if (e.key in map) { e.preventDefault(); setActive(Math.min(n - 1, Math.max(0, map[e.key]))); }
    if (e.key === 'Escape') setActive(null);
  };

  if (!n || vals.every((v) => v === 0)) {
    return <div className="ch-empty" style={{ minHeight: height }}><span>Nothing recorded in this period yet.</span></div>;
  }

  const a = active ?? null;
  const tipRight = a !== null && x(a) > w * 0.62;
  return (
    <div className="ch" ref={wrap} style={{ height }} tabIndex={0} role="group"
      aria-label={`${title}: ${format(total)}${u(total)} in total. Use the left and right arrow keys to read each day.`}
      onPointerMove={(e) => fromEvent(e.clientX)} onPointerDown={(e) => fromEvent(e.clientX)}
      onPointerLeave={() => setActive(null)} onKeyDown={onKey} onBlur={() => setActive(null)}>
      <svg width={w} height={height} viewBox={`0 0 ${w} ${height}`} aria-hidden="true" className="ch__svg">
        <defs>
          <linearGradient id={`g${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--ch-accent)" stopOpacity="0.32" />
            <stop offset="1" stopColor="var(--ch-accent)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={L} x2={w - R} y1={y(t)} y2={y(t)} className={t === 0 ? 'ch__zero' : 'ch__grid'} />
            <text x={L - 8} y={y(t) + 4} textAnchor="end" className="ch__tick">{axis(t)}</text>
          </g>
        ))}
        {mode === 'area' ? (
          <>
            <path d={area} fill={`url(#g${uid})`} className="ch__area" />
            <path d={line} pathLength={1} className="ch__line" />
          </>
        ) : (
          points.map((p, i) => {
            const bw = Math.max(2, slot - Math.min(4, slot * 0.3));
            const h = p.value === 0 ? 0 : Math.max(2, (Math.abs(p.value) / span) * plotH);
            return (
              <rect key={p.label} x={x(i) - bw / 2} y={p.value >= 0 ? zeroY - h : zeroY} width={bw} height={h}
                rx={Math.min(3, bw / 2)} style={{ animationDelay: `${Math.min(i * 12, 500)}ms` }}
                className={`ch__bar${p.value < 0 ? ' ch__bar--neg' : ''}${a === i ? ' ch__bar--on' : ''}`} />
            );
          })
        )}
        {points.map((p, i) => i % tickEvery === 0 && (
          <text key={p.label} x={x(i)} y={height - 6} textAnchor="middle" className="ch__tick">{fmtDay(p.label)}</text>
        ))}
        {a !== null && (
          <g pointerEvents="none">
            <line x1={x(a)} x2={x(a)} y1={T} y2={T + plotH} className="ch__cross" />
            {mode === 'area' && <circle cx={x(a)} cy={y(points[a].value)} r={4.5} className="ch__dot" />}
          </g>
        )}
      </svg>
      {a !== null && (
        <div className={`ch__tip${tipRight ? ' ch__tip--left' : ''}`} style={{ left: x(a), top: T }} aria-hidden="true">
          <span className="ch__tip-date">{fmtDay(points[a].label, true)}</span>
          <span className="ch__tip-val">{format(points[a].value)}</span>
        </div>
      )}
      <span className="ch__sr" aria-live="polite">
        {a !== null ? `${fmtDay(points[a].label, true)}: ${format(points[a].value)}${u(points[a].value)}` : ''}
      </span>
    </div>
  );
}

function fmtDay(iso: string, long = false) {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, long
    ? { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }
    : { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
