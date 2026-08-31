'use client';

// Pure-SVG 30-day portfolio value chart — same hand-rolled approach as
// components/UsageChart.tsx (no charting library; showcase has no
// lightweight-charts dependency, that's webapp-only). Area + line with a
// hover tooltip, matching UsageChart's visual language (gradient fill, mono
// axis labels, crosshair).

import { useRef, useState, useCallback } from 'react';

export interface TreasuryPoint {
  date: string;    // ISO date
  valueUsd: number;
}

interface TreasuryChartProps {
  series: TreasuryPoint[];
}

const SVG_W  = 560;
const PLOT_H = 140;
const PAD_L  = 56;
const PAD_R  = 16;
const PAD_T  = 16;
const PAD_B  = 28;
const SVG_H  = PLOT_H + PAD_T + PAD_B;

function fmtUsdCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000)     return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

function fmtUsdFull(n: number): string {
  return n.toLocaleString(undefined, {
    style: 'currency', currency: 'USD',
    maximumFractionDigits: Math.abs(n) >= 1000 ? 0 : 2,
  });
}

function fmtDateLabel(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

export default function TreasuryChart({ series }: TreasuryChartProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const n      = series.length;
  const values = series.map((s) => s.valueUsd);
  const max    = Math.max(...values, 1);
  const min    = Math.min(...values, 0);
  const range  = Math.max(max - min, 1);

  const plotW = SVG_W - PAD_L - PAD_R;
  const xStep = n <= 1 ? 0 : plotW / (n - 1);
  const xAt   = (i: number) => PAD_L + i * xStep;
  const yAt   = (v: number) => PAD_T + PLOT_H - ((v - min) / range) * PLOT_H;

  const gridVals = [0, 0.25, 0.5, 0.75, 1].map((f) => min + f * range);

  const linePath = series.map((s, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i)} ${yAt(s.valueUsd)}`).join(' ');
  const areaPath = n > 0
    ? `${linePath} L ${xAt(n - 1)} ${PAD_T + PLOT_H} L ${xAt(0)} ${PAD_T + PLOT_H} Z`
    : '';

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!svgRef.current || n === 0) return;
      const rect = svgRef.current.getBoundingClientRect();
      const relX = ((e.clientX - rect.left) / rect.width) * SVG_W;
      const idx  = Math.round((relX - PAD_L) / (xStep || 1));
      setHoveredIdx(Math.max(0, Math.min(n - 1, idx)));
    },
    [n, xStep]
  );

  const hovered      = hoveredIdx !== null ? series[hoveredIdx] : null;
  const labelEvery   = n > 20 ? 5 : n > 10 ? 3 : 1;

  return (
    <div role="img" aria-label={`Portfolio value over the last ${n} days`} style={{ position: 'relative' }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        width="100%"
        height={SVG_H}
        style={{ display: 'block', overflow: 'visible', cursor: n > 0 ? 'crosshair' : 'default' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoveredIdx(null)}
      >
        <defs>
          <linearGradient id="tcAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="rgba(39,189,240,0.32)" />
            <stop offset="100%" stopColor="rgba(39,189,240,0)" />
          </linearGradient>
        </defs>

        {/* Grid lines + left-axis USD labels */}
        {gridVals.map((val, i) => {
          const y = yAt(val);
          return (
            <g key={i}>
              <line
                x1={PAD_L} y1={y} x2={SVG_W - PAD_R} y2={y}
                stroke="rgba(142,182,197,0.26)"
                strokeWidth={1}
                strokeDasharray={i === 0 ? 'none' : '3 5'}
              />
              <text
                x={PAD_L - 8} y={y + 4}
                textAnchor="end"
                fill="rgba(23,50,74,0.4)"
                fontSize={9}
                fontFamily="var(--font-mono, monospace)"
              >
                {fmtUsdCompact(val)}
              </text>
            </g>
          );
        })}

        {n > 0 && <path d={areaPath} fill="url(#tcAreaGrad)" />}
        {n > 0 && <path d={linePath} fill="none" stroke="#0b8bc7" strokeWidth={2} />}

        {/* X-axis date labels */}
        {n > 0 && series.map((s, i) => (
          i % labelEvery === 0 && (
            <text
              key={i}
              x={xAt(i)} y={PAD_T + PLOT_H + PAD_B - 8}
              textAnchor="middle"
              fill="rgba(23,50,74,0.44)"
              fontSize={8}
              fontFamily="var(--font-mono, monospace)"
            >
              {fmtDateLabel(s.date)}
            </text>
          )
        ))}

        {/* Hover crosshair + point */}
        {hoveredIdx !== null && (
          <>
            <line
              x1={xAt(hoveredIdx)} y1={PAD_T} x2={xAt(hoveredIdx)} y2={PAD_T + PLOT_H}
              stroke="rgba(14,149,189,0.3)"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <circle
              cx={xAt(hoveredIdx)} cy={yAt(series[hoveredIdx].valueUsd)}
              r={4} fill="#0b8bc7" stroke="#fff" strokeWidth={2}
            />
          </>
        )}

        {n === 0 && (
          <text
            x={SVG_W / 2} y={SVG_H / 2}
            textAnchor="middle"
            fill="rgba(23,50,74,0.3)"
            fontSize={12}
            fontFamily="var(--font-mono, monospace)"
          >
            No history yet
          </text>
        )}
      </svg>

      {hovered && hoveredIdx !== null && (
        <div
          style={{
            position: 'absolute',
            left: `clamp(8px, calc(${(xAt(hoveredIdx) / SVG_W) * 100}% - 70px), calc(100% - 152px))`,
            top: 0,
            pointerEvents: 'none',
            zIndex: 10,
            padding: '7px 11px',
            borderRadius: 8,
            background: 'rgba(23,50,74,0.92)',
            backdropFilter: 'blur(8px)',
            border: '1px solid rgba(14,149,189,0.3)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.22)',
            minWidth: 144,
          }}
        >
          <div style={{ color: 'rgba(255,255,255,0.55)', fontFamily: 'var(--font-mono)', fontSize: '0.66rem', marginBottom: 4 }}>
            {new Date(hovered.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
          </div>
          <div style={{ color: '#fff', fontFamily: 'var(--font-mono)', fontSize: '0.82rem', fontWeight: 700 }}>
            {fmtUsdFull(hovered.valueUsd)}
          </div>
        </div>
      )}
    </div>
  );
}
