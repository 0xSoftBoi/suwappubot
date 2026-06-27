'use client';

// Pure-SVG API usage chart — no charting library.
// Supports period switching (7D / 30D), error rate overlay, rate-limit
// hit markers, and a hover tooltip.

import { useState, useRef, useCallback } from 'react';

export interface DailyBucket {
  date: string;   // ISO date string e.g. "2026-06-20"
  count: number;
  // Per-day error / rate-limit data is not yet returned by the API —
  // we fall back to displaying the period-level averages.
}

interface UsageChartProps {
  daily: DailyBucket[];
  // Period-level aggregates for overlays
  errorRate: number;       // 0–100
  rateLimitHits: number;
  avgDurationMs: number;
  period: '7d' | '30d';
  onPeriodChange: (p: '7d' | '30d') => void;
}

// ── Layout constants ──────────────────────────────────────────────────────────
const SVG_W      = 560;
const PLOT_H     = 130;
const PAD_L      = 42;
const PAD_R      = 48;  // room for right-axis labels
const PAD_T      = 16;
const PAD_B      = 32;
const BAR_RADIUS = 3;
const SVG_H      = PLOT_H + PAD_T + PAD_B;

function fmtK(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

function fmtDateLabel(iso: string, barCount: number): string {
  try {
    const d = new Date(iso);
    if (barCount <= 10) {
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }
    // For 30-day view, only show every ~5th label — caller handles filtering
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

export default function UsageChart({
  daily,
  errorRate,
  rateLimitHits,
  period,
  onPeriodChange,
}: UsageChartProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Build display buckets
  const buckets = daily.length > 0 ? daily : [];
  const max     = Math.max(...buckets.map((b) => b.count), 1);

  const plotW  = SVG_W - PAD_L - PAD_R;
  const n      = buckets.length;
  const gap    = n <= 1 ? 0 : Math.min(4, plotW / n / 4);
  const barW   = n <= 1 ? plotW * 0.3 : (plotW - gap * (n - 1)) / n;

  // Grid lines (left axis, call counts)
  const gridVals = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * max));

  // Error rate axis: 0–max(errorRate * 2, 5) so the line sits mid-chart
  const errAxisMax = Math.max(errorRate * 2, 5, 1);
  // Y position of the error-rate flat line
  const errLineY = PAD_T + PLOT_H - (errorRate / errAxisMax) * PLOT_H;

  const barX = (i: number) => PAD_L + i * (barW + gap);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!svgRef.current || n === 0) return;
      const rect  = svgRef.current.getBoundingClientRect();
      const relX  = ((e.clientX - rect.left) / rect.width) * SVG_W - PAD_L;
      const idx   = Math.round(relX / (barW + gap));
      if (idx >= 0 && idx < n) setHoveredIdx(idx);
      else setHoveredIdx(null);
    },
    [n, barW, gap]
  );

  const hovered = hoveredIdx !== null ? buckets[hoveredIdx] : null;

  // Label every Nth bar to avoid crowding
  const labelEvery = n > 20 ? 5 : n > 10 ? 3 : 1;

  return (
    <div>
      {/* ── Period tabs ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
        {(['7d', '30d'] as const).map((p) => (
          <button
            key={p}
            onClick={() => onPeriodChange(p)}
            style={{
              minHeight: 28,
              padding: '0 12px',
              borderRadius: 6,
              border: period === p
                ? '1px solid rgba(14,149,189,0.5)'
                : '1px solid rgba(207,227,234,0.8)',
              background: period === p
                ? 'rgba(14,149,189,0.1)'
                : 'rgba(255,255,255,0.6)',
              color: period === p ? '#0b789a' : 'rgba(23,50,74,0.5)',
              fontFamily: 'var(--font-mono, monospace)',
              fontSize: '0.68rem',
              fontWeight: 800,
              letterSpacing: '0.04em',
              textTransform: 'uppercase' as const,
              cursor: 'pointer',
              transition: 'all 0.12s ease',
            }}
            aria-pressed={period === p}
          >
            {p === '7d' ? '7D' : '30D'}
          </button>
        ))}

        {/* Rate limit badge */}
        {rateLimitHits > 0 && (
          <span style={{
            marginLeft: 'auto',
            padding: '3px 9px',
            borderRadius: 999,
            background: 'rgba(212,72,63,0.1)',
            border: '1px solid rgba(212,72,63,0.3)',
            color: '#c0392b',
            fontFamily: 'var(--font-mono, monospace)',
            fontSize: '0.62rem',
            fontWeight: 800,
            letterSpacing: '0.04em',
          }}>
            {fmtK(rateLimitHits)} rate limit hits
          </span>
        )}
      </div>

      {/* ── SVG chart ── */}
      <div role="img" aria-label={`API usage chart — last ${period === '7d' ? '7' : '30'} days`}
           style={{ position: 'relative' }}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${SVG_W} ${SVG_H}`}
          width="100%"
          height={SVG_H}
          style={{ display: 'block', overflow: 'visible', cursor: 'crosshair' }}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoveredIdx(null)}
        >
          <defs>
            <linearGradient id="ucBarGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="#27bdf0" />
              <stop offset="100%" stopColor="#0b8bc7" />
            </linearGradient>
            <linearGradient id="ucBarHighlight" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%"   stopColor="rgba(255,255,255,0.22)" />
              <stop offset="100%" stopColor="rgba(255,255,255,0)" />
            </linearGradient>
            <linearGradient id="ucBarHover" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="#5dd0f7" />
              <stop offset="100%" stopColor="#1aa3db" />
            </linearGradient>
          </defs>

          {/* Left-axis grid lines */}
          {gridVals.map((val, i) => {
            const y = PAD_T + PLOT_H - (val / max) * PLOT_H;
            return (
              <g key={i}>
                <line
                  x1={PAD_L} y1={y} x2={SVG_W - PAD_R} y2={y}
                  stroke="rgba(142,182,197,0.26)"
                  strokeWidth={1}
                  strokeDasharray={i === 0 ? 'none' : '3 5'}
                />
                <text
                  x={PAD_L - 6} y={y + 4}
                  textAnchor="end"
                  fill="rgba(23,50,74,0.4)"
                  fontSize={9}
                  fontFamily="var(--font-mono, monospace)"
                >
                  {fmtK(val)}
                </text>
              </g>
            );
          })}

          {/* Error rate flat overlay line (right axis) */}
          {errorRate > 0 && (
            <>
              <line
                x1={PAD_L} y1={errLineY} x2={SVG_W - PAD_R} y2={errLineY}
                stroke="rgba(212,72,63,0.55)"
                strokeWidth={1.5}
                strokeDasharray="5 4"
              />
              {/* Right-axis label */}
              <text
                x={SVG_W - PAD_R + 6} y={errLineY + 4}
                textAnchor="start"
                fill="rgba(192,57,43,0.75)"
                fontSize={9}
                fontFamily="var(--font-mono, monospace)"
                fontWeight={700}
              >
                {errorRate.toFixed(2)}%
              </text>
              {/* Right-axis title */}
              <text
                x={SVG_W - PAD_R + 6} y={PAD_T + 10}
                textAnchor="start"
                fill="rgba(192,57,43,0.5)"
                fontSize={8}
                fontFamily="var(--font-mono, monospace)"
              >
                err%
              </text>
            </>
          )}

          {/* Bars */}
          {buckets.map((b, i) => {
            const barH  = Math.max(2, (b.count / max) * PLOT_H);
            const x     = barX(i);
            const y     = PAD_T + PLOT_H - barH;
            const isHov = hoveredIdx === i;

            return (
              <g key={i}>
                <rect
                  x={x} y={y} width={barW} height={barH}
                  rx={BAR_RADIUS} ry={BAR_RADIUS}
                  fill={isHov ? 'url(#ucBarHover)' : 'url(#ucBarGrad)'}
                  style={{ filter: `drop-shadow(0 ${isHov ? 6 : 4}px ${isHov ? 12 : 8}px rgba(14,118,158,${isHov ? 0.32 : 0.2}))` }}
                />
                {/* Highlight strip */}
                <rect
                  x={x} y={y} width={barW * 0.38} height={barH}
                  rx={BAR_RADIUS} ry={BAR_RADIUS}
                  fill="url(#ucBarHighlight)"
                />
                {/* Value label above bar */}
                {barH > 20 && (
                  <text
                    x={x + barW / 2} y={y - 4}
                    textAnchor="middle"
                    fill="rgba(23,50,74,0.58)"
                    fontSize={8}
                    fontFamily="var(--font-mono, monospace)"
                    fontWeight={700}
                  >
                    {fmtK(b.count)}
                  </text>
                )}
                {/* X-axis date label */}
                {i % labelEvery === 0 && (
                  <text
                    x={x + barW / 2} y={PAD_T + PLOT_H + PAD_B - 6}
                    textAnchor="middle"
                    fill="rgba(23,50,74,0.44)"
                    fontSize={8}
                    fontFamily="var(--font-mono, monospace)"
                  >
                    {fmtDateLabel(b.date, n)}
                  </text>
                )}
              </g>
            );
          })}

          {/* Hover crosshair */}
          {hoveredIdx !== null && (
            <line
              x1={barX(hoveredIdx) + barW / 2}
              y1={PAD_T}
              x2={barX(hoveredIdx) + barW / 2}
              y2={PAD_T + PLOT_H}
              stroke="rgba(14,149,189,0.3)"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
          )}

          {/* Empty state */}
          {n === 0 && (
            <text
              x={SVG_W / 2} y={SVG_H / 2}
              textAnchor="middle"
              fill="rgba(23,50,74,0.3)"
              fontSize={12}
              fontFamily="var(--font-mono, monospace)"
            >
              No data for this period
            </text>
          )}
        </svg>

        {/* Hover tooltip — positioned as an absolutely placed div */}
        {hovered && hoveredIdx !== null && (
          <div
            style={{
              position: 'absolute',
              // roughly track the bar; clamp to stay visible
              left: `clamp(8px, calc(${((barX(hoveredIdx) + barW / 2) / SVG_W) * 100}% - 70px), calc(100% - 152px))`,
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
              {hovered.count.toLocaleString()} calls
            </div>
            <div style={{ color: 'rgba(212,72,63,0.9)', fontFamily: 'var(--font-mono)', fontSize: '0.68rem', marginTop: 2 }}>
              ~{errorRate.toFixed(2)}% avg error rate
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
