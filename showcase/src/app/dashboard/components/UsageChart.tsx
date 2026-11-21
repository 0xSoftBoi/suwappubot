'use client';

import DailyChart from '@/components/charts/DailyChart';

// Requests-per-day chart for the workspace overview. Presentation over the
// shared DailyChart (hover/keyboard readout, zero baseline, draw-in). The API
// returns period-level error/rate-limit aggregates only (no per-day series), so
// they are shown as captions rather than drawn as a fake per-day line.

export interface DailyBucket {
  date: string;   // ISO date string e.g. "2026-06-20"
  count: number;
}

interface UsageChartProps {
  daily: DailyBucket[];
  errorRate: number;       // 0–100, period-level
  rateLimitHits: number;
  avgDurationMs: number;
  period: '7d' | '30d';
  onPeriodChange: (p: '7d' | '30d') => void;
}

const nf = new Intl.NumberFormat(undefined);
const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });

export default function UsageChart({ daily, errorRate, rateLimitHits, period, onPeriodChange }: UsageChartProps) {
  const total = daily.reduce((a, b) => a + b.count, 0);
  return (
    <div className="uc">
      <div className="uc__bar">
        <div className="uc__tabs" role="group" aria-label="Time period">
          {(['7d', '30d'] as const).map((p) => (
            <button key={p} type="button" className="uc__tab" aria-pressed={period === p} onClick={() => onPeriodChange(p)}>
              {p === '7d' ? 'Last 7 days' : 'Last 30 days'}
            </button>
          ))}
        </div>
        <span className="uc__total">{daily.length > 0 ? `${nf.format(total)} requests` : ''}</span>
      </div>

      {daily.length > 0 ? (
        <DailyChart title="Requests per day" mode="bars" unit={['request', 'requests']} height={230}
          format={(n) => nf.format(n)} formatAxis={(n) => compact.format(n)}
          points={daily.map((d) => ({ label: d.date, value: d.count }))} />
      ) : (
        <div className="uc__empty">No requests in this period yet. Once your apps call the API, daily traffic shows up here.</div>
      )}

      <p className="uc__foot">
        <span>Failed requests <b>{errorRate.toFixed(2)}%</b></span>
        <span>{rateLimitHits > 0 ? <>Turned away for speed <b>{nf.format(rateLimitHits)}</b></> : 'None turned away for speed'}</span>
        <span className="uc__note">Both figures cover the whole period.</span>
      </p>
    </div>
  );
}
