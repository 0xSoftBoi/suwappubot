'use client';

// Pure-SVG API usage bar chart — no charting library.
// Accepts either a 7-day daily breakdown or falls back to a
// 2-bar today-vs-month comparison when granular data is absent.

interface DailyBucket {
  label: string; // e.g. "Mon", "Jun 24"
  value: number;
}

interface UsageChartProps {
  daily?: DailyBucket[];
  callsToday: number;
  callsThisMonth: number;
}

const CHART_H = 120; // SVG inner height for bars
const BAR_RADIUS = 4;

function buildFallbackBuckets(today: number, month: number): DailyBucket[] {
  return [
    { label: 'Today', value: today },
    { label: 'Month', value: month },
  ];
}

export default function UsageChart({ daily, callsToday, callsThisMonth }: UsageChartProps) {
  const buckets: DailyBucket[] =
    daily && daily.length > 0 ? daily : buildFallbackBuckets(callsToday, callsThisMonth);

  const max = Math.max(...buckets.map((b) => b.value), 1);

  // Layout constants
  const padL = 36; // left axis area
  const padB = 28; // bottom label area
  const padT = 12;
  const padR = 12;
  // Total SVG width is dynamic via viewBox — we use 480 as the canonical width
  const svgW = 480;
  const svgH = CHART_H + padT + padB;
  const plotW = svgW - padL - padR;
  const plotH = CHART_H;

  const barCount = buckets.length;
  const gap = Math.min(8, plotW / barCount / 3);
  const barW = (plotW - gap * (barCount - 1)) / barCount;

  // Gridline values: 0, 25%, 50%, 75%, 100%
  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * max));

  const formatLabel = (n: number): string => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
    return String(n);
  };

  return (
    <div className="usage-chart" role="img" aria-label="API usage bar chart">
      <svg
        viewBox={`0 0 ${svgW} ${svgH}`}
        width="100%"
        height={svgH}
        style={{ display: 'block', overflow: 'visible' }}
      >
        <defs>
          {/* Accent gradient — sky-blue to teal to match the summer aesthetic */}
          <linearGradient id="ucBarGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#27bdf0" />
            <stop offset="100%" stopColor="#0b8bc7" />
          </linearGradient>
          {/* Subtle highlight on tall bars */}
          <linearGradient id="ucBarHighlight" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="rgba(255,255,255,0.22)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0)" />
          </linearGradient>
        </defs>

        {/* Grid lines */}
        {gridLines.map((val, i) => {
          const y = padT + plotH - (val / max) * plotH;
          return (
            <g key={i}>
              <line
                x1={padL}
                y1={y}
                x2={svgW - padR}
                y2={y}
                stroke="rgba(142,182,197,0.28)"
                strokeWidth={1}
                strokeDasharray={i === 0 ? 'none' : '3 4'}
              />
              <text
                x={padL - 6}
                y={y + 4}
                textAnchor="end"
                fill="rgba(23,50,74,0.42)"
                fontSize={9}
                fontFamily="var(--font-mono, monospace)"
              >
                {formatLabel(val)}
              </text>
            </g>
          );
        })}

        {/* Bars */}
        {buckets.map((b, i) => {
          const barH = Math.max(2, (b.value / max) * plotH);
          const x = padL + i * (barW + gap);
          const y = padT + plotH - barH;

          return (
            <g key={i}>
              {/* Main bar */}
              <rect
                x={x}
                y={y}
                width={barW}
                height={barH}
                rx={BAR_RADIUS}
                ry={BAR_RADIUS}
                fill="url(#ucBarGrad)"
                style={{ filter: 'drop-shadow(0 4px 8px rgba(14,118,158,0.22))' }}
              />
              {/* Inset highlight strip */}
              <rect
                x={x}
                y={y}
                width={barW * 0.38}
                height={barH}
                rx={BAR_RADIUS}
                ry={BAR_RADIUS}
                fill="url(#ucBarHighlight)"
              />
              {/* Value label above bar (only if bar is tall enough) */}
              {barH > 18 && (
                <text
                  x={x + barW / 2}
                  y={y - 4}
                  textAnchor="middle"
                  fill="rgba(23,50,74,0.6)"
                  fontSize={9}
                  fontFamily="var(--font-mono, monospace)"
                  fontWeight={700}
                >
                  {formatLabel(b.value)}
                </text>
              )}
              {/* X-axis label */}
              <text
                x={x + barW / 2}
                y={padT + plotH + padB - 6}
                textAnchor="middle"
                fill="rgba(23,50,74,0.5)"
                fontSize={9}
                fontFamily="var(--font-mono, monospace)"
              >
                {b.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
