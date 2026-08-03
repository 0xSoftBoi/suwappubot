'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { API_BASE_URL } from '@/lib/links';
import './admin.css';

// ── Types ──────────────────────────────────────────────────────────────────

interface SubscriptionBreakdown {
  free: number;
  pro: number;
  premium: number;
  enterprise: number;
}

interface AdminStats {
  agents_total: number;
  agents_24h: number;
  swaps_total: number;
  swaps_24h: number;
  swaps_volume_usd_24h?: number;
  webhooks_active: number;
  webhooks_deliveries_24h: number;
  webhooks_failure_rate_24h?: number;
  // expanded fields from updated /admin/stats
  revenue_this_month?: number;
  enterprise_orgs?: number;
  active_enterprise_orgs?: number;
  api_calls_today?: number;
  subscription_breakdown?: SubscriptionBreakdown;
}

interface TimeseriesDay {
  date: string;       // ISO date string e.g. "2026-06-01"
  count: number;
  usd_volume?: number;
}

interface AdminTimeseries {
  swapVolume: TimeseriesDay[];
  newAgents: TimeseriesDay[];
  apiCalls: TimeseriesDay[];
}

interface AgentRow {
  agent_id: string;
  status: 'active' | 'inactive' | string;
  total_requests: number;
  total_swaps: number;
  total_spend?: number;
  created_at: string;
  last_active_at: string;
  [key: string]: unknown;
}

interface SwapRow {
  swap_id: string;
  from_chain: string;
  from_token: string;
  to_chain: string;
  to_token: string;
  usd_value?: number;
  status: 'success' | 'failed' | 'pending' | string;
  created_at: string;
}

interface WebhookRow {
  event_type: string;
  status: 'success' | 'failed' | 'pending' | string;
  attempts: number;
  response_code?: number;
  last_error?: string;
  created_at: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const KEY_STORE = 'suwappu_admin_key';
const PAGE_SIZE = 20;

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function fmtUSD(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toFixed(2)}`;
}

function fmtTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

function fmtDateShort(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

function truncate(s: string, len = 12): string {
  if (!s) return '-';
  if (s.length <= len) return s;
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === 'success' || status === 'active' ? 'adm-badge--success' :
    status === 'failed' ? 'adm-badge--failed' :
    status === 'pending' ? 'adm-badge--pending' :
    status === 'inactive' ? 'adm-badge--inactive' :
    'adm-badge--inactive';
  return (
    <span className={`adm-badge ${cls}`}>
      <span className="adm-badge__dot" />
      {status}
    </span>
  );
}

function DeltaBadge({ value }: { value: number }) {
  const cls = value > 0 ? 'adm-stat__delta--up' : value < 0 ? 'adm-stat__delta--down' : 'adm-stat__delta--flat';
  const arrow = value > 0 ? '↑' : value < 0 ? '↓' : '·';
  return (
    <span className={`adm-stat__delta ${cls}`}>
      {arrow} {Math.abs(value)} today
    </span>
  );
}

// ── Admin API fetch wrapper ──────────────────────────────────────────────────

async function adminFetch<T>(path: string, key: string): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: { 'X-Admin-Key': key },
  });
  if (res.status === 401) throw new Error('UNAUTHORIZED');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

// ── SVG chart constants ───────────────────────────────────────────────────────

const VW = 500, VH = 160;
const CL = 44, CR = 12, CT = 14, CB = 36;
const CW = VW - CL - CR;   // chart area width
const CH = VH - CT - CB;   // chart area height

// ── Donut chart ───────────────────────────────────────────────────────────────

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = deg * Math.PI / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function DonutChart({ breakdown }: { breakdown: SubscriptionBreakdown }) {
  const items = [
    { key: 'free'       as const, color: '#3a5368', label: 'Free' },
    { key: 'pro'        as const, color: '#38bdf8', label: 'Pro' },
    { key: 'premium'    as const, color: '#818cf8', label: 'Premium' },
    { key: 'enterprise' as const, color: '#f59e0b', label: 'Enterprise' },
  ];

  const vals = items.map(it => breakdown[it.key]);
  const total = vals.reduce((a, b) => a + b, 0) || 1;

  const cx = 40, cy = 40, r = 30, ir = 19;
  let angle = -90;

  const segments = items.map((item, i) => {
    const pct = vals[i] / total;
    const sweep = pct * 360;
    if (pct < 0.001) return null;
    const startA = angle;
    const endA   = angle + sweep;
    angle = endA;

    const s  = polar(cx, cy, r,  startA);
    const e  = polar(cx, cy, r,  endA);
    const is = polar(cx, cy, ir, endA);
    const ie = polar(cx, cy, ir, startA);
    const lg = sweep > 180 ? 1 : 0;

    const d = `M ${s.x} ${s.y} A ${r} ${r} 0 ${lg} 1 ${e.x} ${e.y} L ${is.x} ${is.y} A ${ir} ${ir} 0 ${lg} 0 ${ie.x} ${ie.y} Z`;
    return <path key={item.key} d={d} fill={item.color} opacity={0.88} />;
  });

  return (
    <div className="adm-donut-wrap">
      <svg viewBox="0 0 80 80" className="adm-donut-svg">
        {segments}
        <text x={cx} y={cy + 3} textAnchor="middle" fontSize={10} fontWeight="700" fill="#e2ecf4">
          {fmtNum(total)}
        </text>
        <text x={cx} y={cy + 13} textAnchor="middle" fontSize={7} fill="rgba(126,164,187,0.7)">
          users
        </text>
      </svg>
      <div className="adm-donut-legend">
        {items.map((item, i) => (
          <div key={item.key} className="adm-donut-legend__item">
            <span className="adm-donut-legend__dot" style={{ background: item.color }} />
            <span className="adm-donut-legend__key">{item.label}</span>
            <span className="adm-donut-legend__val">{fmtNum(vals[i])}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Bar chart ─────────────────────────────────────────────────────────────────

interface BarChartProps {
  data: TimeseriesDay[];
  color?: string;
  valueKey?: 'count' | 'usd_volume';
}

function SvgBarChart({ data, color = '#38bdf8', valueKey = 'count' }: BarChartProps) {
  const [hovered, setHovered] = useState<number | null>(null);
  if (!data.length) return <div className="adm-chart-empty">No data yet</div>;

  const vals = data.map(d => (valueKey === 'usd_volume' ? (d.usd_volume ?? 0) : d.count));
  const maxVal = Math.max(...vals, 1);
  const n = data.length;
  const barW = CW / n;
  const gap  = Math.max(1, barW * 0.18);
  const bw   = barW - gap;

  const yTicks = [0, 0.25, 0.5, 0.75, 1];

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} className="adm-chart-svg" onMouseLeave={() => setHovered(null)}>
      {/* grid */}
      {yTicks.map((f, i) => {
        const y = CT + CH * (1 - f);
        return <line key={i} x1={CL} x2={CL + CW} y1={y} y2={y} stroke="rgba(255,255,255,0.055)" strokeWidth={1} />;
      })}

      {/* y-axis labels */}
      {yTicks.map((f, i) => {
        const y   = CT + CH * (1 - f);
        const val = Math.round(maxVal * f);
        return (
          <text key={i} x={CL - 5} y={y + 3.5} textAnchor="end" fontSize={9} fill="rgba(126,164,187,0.65)">
            {valueKey === 'usd_volume' ? fmtUSD(val) : fmtNum(val)}
          </text>
        );
      })}

      {/* bars */}
      {vals.map((v, i) => {
        const x   = CL + i * barW + gap / 2;
        const bh  = Math.max(2, (v / maxVal) * CH);
        const y   = CT + CH - bh;
        const hot = hovered === i;
        return (
          <rect
            key={i} x={x} y={y} width={bw} height={bh}
            fill={hot ? '#7de0ff' : color} opacity={hot ? 1 : 0.68} rx={2}
            onMouseEnter={() => setHovered(i)}
            style={{ cursor: 'default' }}
          />
        );
      })}

      {/* x-axis date labels every 7 days */}
      {data.map((d, i) => {
        if (i % 7 !== 0 && i !== data.length - 1) return null;
        const x = CL + i * barW + barW / 2;
        return (
          <text key={i} x={x} y={VH - 5} textAnchor="middle" fontSize={8.5} fill="rgba(126,164,187,0.55)">
            {fmtDateShort(d.date)}
          </text>
        );
      })}

      {/* tooltip */}
      {hovered !== null && (() => {
        const i    = hovered;
        const v    = vals[i];
        const x    = CL + i * barW + barW / 2;
        const rawY = CT + CH * (1 - v / maxVal);
        const ty   = Math.max(CT + 4, rawY - 30);
        const txt  = valueKey === 'usd_volume' ? fmtUSD(v) : fmtNum(v);
        const lbl  = fmtDateShort(data[i].date);
        return (
          <g>
            <rect x={x - 30} y={ty} width={60} height={26} rx={4}
              fill="rgba(11,17,26,0.94)" stroke="rgba(56,189,248,0.32)" strokeWidth={1} />
            <text x={x} y={ty + 12} textAnchor="middle" fontSize={10} fill="#e2ecf4" fontWeight="700">{txt}</text>
            <text x={x} y={ty + 22} textAnchor="middle" fontSize={8}  fill="rgba(126,164,187,0.75)">{lbl}</text>
          </g>
        );
      })()}
    </svg>
  );
}

// ── Area chart ────────────────────────────────────────────────────────────────

interface AreaChartProps {
  data: TimeseriesDay[];
  color?: string;
}

function SvgAreaChart({ data, color = '#22c55e' }: AreaChartProps) {
  const [hovered, setHovered] = useState<number | null>(null);
  if (!data.length) return <div className="adm-chart-empty">No data yet</div>;

  const vals = data.map(d => d.count);
  const maxVal = Math.max(...vals, 1);
  const n = data.length;

  const pts = vals.map((v, i) => ({
    x: CL + (n === 1 ? CW / 2 : (i / (n - 1)) * CW),
    y: CT + CH * (1 - v / maxVal),
  }));

  const linePts  = pts.map(p => `${p.x},${p.y}`).join(' ');
  const areaPts  = [`${pts[0].x},${CT + CH}`, ...pts.map(p => `${p.x},${p.y}`), `${pts[n - 1].x},${CT + CH}`].join(' ');
  const bandW    = n > 1 ? CW / (n - 1) : CW;
  const yTicks   = [0, 0.25, 0.5, 0.75, 1];

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} className="adm-chart-svg" onMouseLeave={() => setHovered(null)}>
      {/* grid */}
      {yTicks.map((f, i) => {
        const y = CT + CH * (1 - f);
        return <line key={i} x1={CL} x2={CL + CW} y1={y} y2={y} stroke="rgba(255,255,255,0.055)" strokeWidth={1} />;
      })}

      {/* y-axis labels */}
      {yTicks.map((f, i) => {
        const y   = CT + CH * (1 - f);
        const val = Math.round(maxVal * f);
        return (
          <text key={i} x={CL - 5} y={y + 3.5} textAnchor="end" fontSize={9} fill="rgba(126,164,187,0.65)">
            {fmtNum(val)}
          </text>
        );
      })}

      {/* area fill */}
      <defs>
        <linearGradient id={`area-grad-${color.replace('#','')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={color} stopOpacity={0.22} />
          <stop offset="100%" stopColor={color} stopOpacity={0.02} />
        </linearGradient>
      </defs>
      <polygon points={areaPts} fill={`url(#area-grad-${color.replace('#','')})`} />

      {/* line */}
      <polyline points={linePts} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" />

      {/* dot on hovered point */}
      {hovered !== null && (
        <circle cx={pts[hovered].x} cy={pts[hovered].y} r={3.5} fill={color} />
      )}

      {/* invisible hover bands */}
      {vals.map((_, i) => {
        const x = CL + (n === 1 ? 0 : (i / (n - 1)) * CW) - bandW / 2;
        return (
          <rect key={i} x={x} y={CT} width={bandW} height={CH}
            fill="transparent" onMouseEnter={() => setHovered(i)} style={{ cursor: 'default' }} />
        );
      })}

      {/* x-axis labels */}
      {data.map((d, i) => {
        if (i % 7 !== 0 && i !== n - 1) return null;
        const x = pts[i].x;
        return (
          <text key={i} x={x} y={VH - 5} textAnchor="middle" fontSize={8.5} fill="rgba(126,164,187,0.55)">
            {fmtDateShort(d.date)}
          </text>
        );
      })}

      {/* tooltip */}
      {hovered !== null && (() => {
        const i   = hovered;
        const v   = vals[i];
        const p   = pts[i];
        const ty  = Math.max(CT + 4, p.y - 32);
        const txt = fmtNum(v);
        const lbl = fmtDateShort(data[i].date);
        return (
          <g>
            <rect x={p.x - 30} y={ty} width={60} height={26} rx={4}
              fill="rgba(11,17,26,0.94)" stroke={`${color}55`} strokeWidth={1} />
            <text x={p.x} y={ty + 12} textAnchor="middle" fontSize={10} fill="#e2ecf4" fontWeight="700">{txt}</text>
            <text x={p.x} y={ty + 22} textAnchor="middle" fontSize={8}  fill="rgba(126,164,187,0.75)">{lbl}</text>
          </g>
        );
      })()}
    </svg>
  );
}

// ── Activity charts section ───────────────────────────────────────────────────

function ActivityCharts({ timeseries }: { timeseries: AdminTimeseries | null }) {
  if (!timeseries) {
    return (
      <div className="adm-section" id="activity">
        <div className="adm-section__head">
          <h2 className="adm-section__title">Platform Activity</h2>
        </div>
        <div className="adm-loading">Loading charts…</div>
      </div>
    );
  }

  const charts = [
    {
      title: 'Swap Volume (30d)',
      sub: 'Daily swap count',
      el: <SvgBarChart data={timeseries.swapVolume} color="#38bdf8" valueKey="count" />,
    },
    {
      title: 'New Agents (30d)',
      sub: 'Daily registrations',
      el: <SvgAreaChart data={timeseries.newAgents} color="#22c55e" />,
    },
    {
      title: 'API Calls (30d)',
      sub: 'Enterprise API traffic',
      el: <SvgBarChart data={timeseries.apiCalls} color="#818cf8" valueKey="count" />,
    },
  ];

  return (
    <div className="adm-section" id="activity">
      <div className="adm-section__head">
        <h2 className="adm-section__title">Platform Activity</h2>
        <span className="adm-section__meta">30-day rolling</span>
      </div>
      <div className="adm-charts">
        {charts.map((c) => (
          <div key={c.title} className="adm-chart-card">
            <div className="adm-chart-card__head">
              <span className="adm-chart-card__title">{c.title}</span>
              <span className="adm-chart-card__sub">{c.sub}</span>
            </div>
            {c.el}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Stat cards (8 tiles) ──────────────────────────────────────────────────────

function StatCards({ stats, timeseries }: { stats: AdminStats; timeseries: AdminTimeseries | null }) {
  // Avg swap volume: total USD from timeseries / total swaps
  const avgSwapUSD = (() => {
    if (!timeseries?.swapVolume?.length) return null;
    const totalUSD    = timeseries.swapVolume.reduce((s, d) => s + (d.usd_volume ?? 0), 0);
    const totalSwaps  = timeseries.swapVolume.reduce((s, d) => s + d.count, 0);
    return totalSwaps > 0 ? totalUSD / totalSwaps : null;
  })();

  return (
    <div className="adm-stats">
      {/* Row 1 */}
      <div className="adm-stat">
        <div className="adm-stat__label">Total agents</div>
        <div className="adm-stat__value">{fmtNum(stats.agents_total)}</div>
        <DeltaBadge value={stats.agents_24h} />
      </div>

      <div className="adm-stat">
        <div className="adm-stat__label">Total swaps</div>
        <div className="adm-stat__value">{fmtNum(stats.swaps_total)}</div>
        <DeltaBadge value={stats.swaps_24h} />
        {stats.swaps_volume_usd_24h !== undefined && (
          <div className="adm-stat__sub">{fmtUSD(stats.swaps_volume_usd_24h)} vol today</div>
        )}
      </div>

      <div className="adm-stat">
        <div className="adm-stat__label">Active webhooks</div>
        <div className="adm-stat__value">{fmtNum(stats.webhooks_active)}</div>
        <span className="adm-stat__delta adm-stat__delta--flat">
          {stats.webhooks_deliveries_24h} deliveries today
        </span>
        {stats.webhooks_failure_rate_24h !== undefined && (
          <div className="adm-stat__sub" style={{ color: stats.webhooks_failure_rate_24h > 5 ? 'var(--adm-red)' : 'var(--adm-faint)' }}>
            {stats.webhooks_failure_rate_24h.toFixed(1)}% failure rate
          </div>
        )}
      </div>

      <div className="adm-stat">
        <div className="adm-stat__label">Revenue this month</div>
        {stats.revenue_this_month !== undefined ? (
          <>
            <div className="adm-stat__value">{fmtUSD(stats.revenue_this_month)}</div>
            <span className="adm-stat__delta adm-stat__delta--flat">MRR</span>
          </>
        ) : (
          <>
            <div className="adm-stat__value" style={{ fontSize: '1.05rem', paddingTop: 4, color: 'var(--adm-faint)' }}>
              See billing
            </div>
            <div className="adm-billing-placeholder">
              <a href="https://dashboard.stripe.com" target="_blank" rel="noopener noreferrer">
                Open Stripe ↗
              </a>
            </div>
          </>
        )}
      </div>

      {/* Row 2 */}
      <div className="adm-stat">
        <div className="adm-stat__label">Enterprise orgs</div>
        <div className="adm-stat__value">{fmtNum(stats.enterprise_orgs ?? 0)}</div>
        {stats.active_enterprise_orgs !== undefined && (
          <span className="adm-stat__delta adm-stat__delta--up">
            ↑ {stats.active_enterprise_orgs} active 30d
          </span>
        )}
      </div>

      <div className="adm-stat">
        <div className="adm-stat__label">API calls today</div>
        <div className="adm-stat__value">{fmtNum(stats.api_calls_today ?? 0)}</div>
        <span className="adm-stat__delta adm-stat__delta--flat">across all orgs</span>
      </div>

      <div className="adm-stat">
        <div className="adm-stat__label">Avg swap size</div>
        <div className="adm-stat__value">
          {avgSwapUSD !== null ? fmtUSD(avgSwapUSD) : '-'}
        </div>
        <span className="adm-stat__delta adm-stat__delta--flat">30-day avg USD</span>
      </div>

      {/* Subscription breakdown: donut card */}
      <div className="adm-stat adm-stat--donut">
        <div className="adm-stat__label">Subscriptions</div>
        {stats.subscription_breakdown ? (
          <DonutChart breakdown={stats.subscription_breakdown} />
        ) : (
          <div style={{ color: 'var(--adm-faint)', fontSize: '0.8rem', marginTop: 8 }}>
            No breakdown data
          </div>
        )}
      </div>
    </div>
  );
}

// ── CSV export helper ─────────────────────────────────────────────────────────

function exportSwapsCSV(rows: SwapRow[]) {
  const headers: (keyof SwapRow)[] = ['swap_id', 'from_chain', 'from_token', 'to_chain', 'to_token', 'usd_value', 'status', 'created_at'];
  const lines = [
    headers.join(','),
    ...rows.map(r => headers.map(h => JSON.stringify(r[h] ?? '')).join(',')),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `swaps-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Agents table ──────────────────────────────────────────────────────────────

function AgentsTable({ apiKey }: { apiKey: string }) {
  const [rows, setRows]     = useState<AgentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState('');
  const [page, setPage]     = useState(0);
  const [filter, setFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    adminFetch<AgentRow[]>('/admin/agents', apiKey)
      .then(setRows)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [apiKey]);

  const filtered    = filter === 'all' ? rows : rows.filter((r) => r.status === filter);
  const totalPages  = Math.ceil(filtered.length / PAGE_SIZE);
  const slice       = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const hasSpend    = rows.some(r => r.total_spend !== undefined);

  return (
    <div className="adm-section" id="agents">
      <div className="adm-section__head">
        <h2 className="adm-section__title">Agents</h2>
        <span className="adm-section__meta">{filtered.length} total</span>
      </div>

      <div className="adm-filters">
        {(['all', 'active', 'inactive'] as const).map((f) => (
          <button key={f} className={`adm-filter-btn${filter === f ? ' adm-filter-btn--active' : ''}`} onClick={() => { setFilter(f); setPage(0); }}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {error && <div className="adm-error">Failed to load agents: {error}</div>}

      <div className="adm-table-wrap">
        {loading ? (
          <div className="adm-loading">Loading agents…</div>
        ) : slice.length === 0 ? (
          <div className="adm-empty">No agents found.</div>
        ) : (
          <table className="adm-table">
            <thead>
              <tr>
                <th>Agent ID</th>
                <th>Status</th>
                <th>Requests</th>
                <th>Swaps</th>
                {hasSpend && <th>Spend</th>}
                <th>Created</th>
                <th>Last Active</th>
              </tr>
            </thead>
            <tbody>
              {slice.map((row) => {
                const isExpanded = expanded === row.agent_id;
                return (
                  <>
                    <tr
                      key={row.agent_id}
                      className={isExpanded ? 'adm-row--expanded' : ''}
                      onClick={() => setExpanded(isExpanded ? null : row.agent_id)}
                    >
                      <td><span className="adm-mono" title={row.agent_id}>{truncate(row.agent_id, 14)}</span></td>
                      <td><StatusBadge status={row.status} /></td>
                      <td>{fmtNum(row.total_requests)}</td>
                      <td>{fmtNum(row.total_swaps)}</td>
                      {hasSpend && <td>{row.total_spend !== undefined ? fmtUSD(row.total_spend) : '-'}</td>}
                      <td className="adm-mono">{fmtTime(row.created_at)}</td>
                      <td className="adm-mono">{fmtTime(row.last_active_at)}</td>
                    </tr>
                    {isExpanded && (
                      <tr key={`${row.agent_id}-detail`} className="adm-row-detail">
                        <td colSpan={hasSpend ? 7 : 6}>
                          <dl className="adm-detail-grid">
                            <div><dt>Full Agent ID</dt><dd>{row.agent_id}</dd></div>
                            <div><dt>Status</dt><dd>{row.status}</dd></div>
                            <div><dt>Total Requests</dt><dd>{row.total_requests.toLocaleString()}</dd></div>
                            <div><dt>Total Swaps</dt><dd>{row.total_swaps.toLocaleString()}</dd></div>
                            {row.total_spend !== undefined && (
                              <div><dt>Total Spend</dt><dd>{fmtUSD(row.total_spend)}</dd></div>
                            )}
                            <div><dt>Created</dt><dd>{row.created_at}</dd></div>
                            <div><dt>Last Active</dt><dd>{row.last_active_at}</dd></div>
                            {Object.entries(row)
                              .filter(([k]) => !['agent_id', 'status', 'total_requests', 'total_swaps', 'total_spend', 'created_at', 'last_active_at'].includes(k))
                              .map(([k, v]) => (
                                <div key={k}><dt>{k}</dt><dd>{String(v)}</dd></div>
                              ))}
                          </dl>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        )}

        {!loading && totalPages > 1 && (
          <div className="adm-pagination">
            <span>Page {page + 1} of {totalPages}</span>
            <div className="adm-pagination__controls">
              <button className="adm-pagination__btn" onClick={() => setPage(p => p - 1)} disabled={page === 0}>← Prev</button>
              <button className="adm-pagination__btn" onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1}>Next →</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Swaps table ───────────────────────────────────────────────────────────────

type SwapDateRange = 'today' | '7d' | '30d' | 'all';

function filterByRange(rows: SwapRow[], range: SwapDateRange): SwapRow[] {
  if (range === 'all') return rows;
  const now  = Date.now();
  const ms   = range === 'today' ? 86_400_000 : range === '7d' ? 7 * 86_400_000 : 30 * 86_400_000;
  const cutoff = now - ms;
  return rows.filter(r => new Date(r.created_at).getTime() >= cutoff);
}

function SwapsTable({ apiKey }: { apiKey: string }) {
  const [rows, setRows]         = useState<SwapRow[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [page, setPage]         = useState(0);
  const [filter, setFilter]     = useState<'all' | 'success' | 'failed' | 'pending'>('all');
  const [dateRange, setDateRange] = useState<SwapDateRange>('all');

  useEffect(() => {
    setLoading(true);
    adminFetch<SwapRow[]>('/admin/swaps', apiKey)
      .then(setRows)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [apiKey]);

  const byDate   = filterByRange(rows, dateRange);
  const filtered = filter === 'all' ? byDate : byDate.filter((r) => r.status === filter);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const slice    = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  function handleDateRange(r: SwapDateRange) {
    setDateRange(r);
    setPage(0);
  }

  return (
    <div className="adm-section" id="swaps">
      <div className="adm-section__head">
        <h2 className="adm-section__title">Swaps</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className="adm-section__meta">{filtered.length} shown</span>
          <button
            className="adm-export-btn"
            onClick={() => exportSwapsCSV(filtered)}
            disabled={filtered.length === 0}
            title="Export visible rows as CSV"
          >
            ↓ CSV
          </button>
        </div>
      </div>

      <div className="adm-filters">
        {/* Status filters */}
        {(['all', 'success', 'failed', 'pending'] as const).map((f) => (
          <button key={f} className={`adm-filter-btn${filter === f ? ' adm-filter-btn--active' : ''}`} onClick={() => { setFilter(f); setPage(0); }}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
        <span className="adm-filter-divider" />
        {/* Date range filters */}
        {(['today', '7d', '30d', 'all'] as const).map((r) => (
          <button key={r} className={`adm-filter-btn${dateRange === r ? ' adm-filter-btn--active' : ''}`} onClick={() => handleDateRange(r)}>
            {r === 'all' ? 'All time' : r === 'today' ? 'Today' : r.toUpperCase()}
          </button>
        ))}
      </div>

      {error && <div className="adm-error">Failed to load swaps: {error}</div>}

      <div className="adm-table-wrap">
        {loading ? (
          <div className="adm-loading">Loading swaps…</div>
        ) : slice.length === 0 ? (
          <div className="adm-empty">No swaps found.</div>
        ) : (
          <table className="adm-table">
            <thead>
              <tr>
                <th>Swap ID</th>
                <th>Route</th>
                <th>USD Value</th>
                <th>Status</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {slice.map((row) => (
                <tr key={row.swap_id} className={row.status === 'failed' ? 'adm-row--failed' : ''}>
                  <td><span className="adm-mono" title={row.swap_id}>{truncate(row.swap_id, 14)}</span></td>
                  <td>
                    <span className="adm-mono">
                      {row.from_chain}:{row.from_token} → {row.to_chain}:{row.to_token}
                    </span>
                  </td>
                  <td>{row.usd_value !== undefined ? fmtUSD(row.usd_value) : '-'}</td>
                  <td><StatusBadge status={row.status} /></td>
                  <td className="adm-mono">{fmtTime(row.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {!loading && totalPages > 1 && (
          <div className="adm-pagination">
            <span>Page {page + 1} of {totalPages}</span>
            <div className="adm-pagination__controls">
              <button className="adm-pagination__btn" onClick={() => setPage(p => p - 1)} disabled={page === 0}>← Prev</button>
              <button className="adm-pagination__btn" onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1}>Next →</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Webhooks table ────────────────────────────────────────────────────────────

function WebhooksTable({ apiKey }: { apiKey: string }) {
  const [rows, setRows]       = useState<WebhookRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [page, setPage]       = useState(0);

  useEffect(() => {
    setLoading(true);
    adminFetch<WebhookRow[]>('/admin/webhooks', apiKey)
      .then(setRows)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [apiKey]);

  const totalPages = Math.ceil(rows.length / PAGE_SIZE);
  const slice      = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div className="adm-section" id="webhooks">
      <div className="adm-section__head">
        <h2 className="adm-section__title">Webhooks</h2>
        <span className="adm-section__meta">{rows.length} events</span>
      </div>

      {error && <div className="adm-error">Failed to load webhooks: {error}</div>}

      <div className="adm-table-wrap">
        {loading ? (
          <div className="adm-loading">Loading webhooks…</div>
        ) : slice.length === 0 ? (
          <div className="adm-empty">No webhook events found.</div>
        ) : (
          <table className="adm-table">
            <thead>
              <tr>
                <th>Event Type</th>
                <th>Status</th>
                <th>Attempts</th>
                <th>Response</th>
                <th>Last Error</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {slice.map((row, i) => (
                <tr key={i} className={row.status === 'failed' ? 'adm-row--failed' : ''}>
                  <td><span className="adm-mono">{row.event_type}</span></td>
                  <td><StatusBadge status={row.status} /></td>
                  <td>{row.attempts}</td>
                  <td><span className="adm-mono">{row.response_code ?? '-'}</span></td>
                  <td style={{ maxWidth: 200 }}>
                    <span className="adm-mono" title={row.last_error} style={{ color: row.last_error ? 'var(--adm-red)' : 'var(--adm-faint)' }}>
                      {row.last_error ? truncate(row.last_error, 32) : '-'}
                    </span>
                  </td>
                  <td className="adm-mono">{fmtTime(row.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {!loading && totalPages > 1 && (
          <div className="adm-pagination">
            <span>Page {page + 1} of {totalPages}</span>
            <div className="adm-pagination__controls">
              <button className="adm-pagination__btn" onClick={() => setPage(p => p - 1)} disabled={page === 0}>← Prev</button>
              <button className="adm-pagination__btn" onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1}>Next →</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Auth Gate ─────────────────────────────────────────────────────────────────

function AuthGate({ onAuth }: { onAuth: (key: string) => void }) {
  const [value, setValue]     = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!value.trim()) return;
    setLoading(true);
    setError('');
    try {
      await adminFetch('/admin/stats', value.trim());
      localStorage.setItem(KEY_STORE, value.trim());
      onAuth(value.trim());
    } catch (err) {
      if (err instanceof Error && err.message === 'UNAUTHORIZED') {
        setError('Invalid admin key: check your credentials.');
      } else {
        setError('Could not reach the API. Check network connectivity.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="adm-auth">
      <div className="adm-auth__card">
        <div className="adm-auth__logo">S</div>
        <h1 className="adm-auth__title">Admin access</h1>
        <p className="adm-auth__sub">Enter your admin key to continue.</p>
        <form onSubmit={handleSubmit}>
          <label className="adm-auth__label" htmlFor="adm-key">Admin key</label>
          <input
            id="adm-key"
            type="password"
            autoComplete="current-password"
            className="adm-auth__input"
            placeholder="sk-adm-••••••••"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={loading}
          />
          {error && <p className="adm-auth__error">{error}</p>}
          <button type="submit" className="adm-auth__btn" disabled={loading || !value.trim()}>
            {loading ? 'Verifying…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

type Section = 'overview' | 'activity' | 'agents' | 'swaps' | 'webhooks';

function Dashboard({ apiKey, onSignOut }: { apiKey: string; onSignOut: () => void }) {
  const [stats, setStats]           = useState<AdminStats | null>(null);
  const [statsError, setStatsError] = useState('');
  const [timeseries, setTimeseries] = useState<AdminTimeseries | null>(null);
  const [activeSection, setActiveSection] = useState<Section>('overview');

  useEffect(() => {
    adminFetch<AdminStats>('/admin/stats', apiKey)
      .then(setStats)
      .catch((e) => setStatsError(e.message));

    // Graceful: timeseries endpoint may not exist yet
    adminFetch<AdminTimeseries>('/admin/stats/timeseries?days=30', apiKey)
      .then(setTimeseries)
      .catch(() => { /* silent: charts just stay empty */ });
  }, [apiKey]);

  const keyPreview = apiKey.length > 10 ? `${apiKey.slice(0, 6)}••••${apiKey.slice(-3)}` : '••••••';

  const navItems: { id: Section; label: string; icon: string }[] = [
    { id: 'overview',  label: 'Overview',  icon: '◈' },
    { id: 'activity',  label: 'Activity',  icon: '⟁' },
    { id: 'agents',    label: 'Agents',    icon: '⬡' },
    { id: 'swaps',     label: 'Swaps',     icon: '⇄' },
    { id: 'webhooks',  label: 'Webhooks',  icon: '⚡' },
  ];

  function scrollTo(id: Section) {
    setActiveSection(id);
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <div className="adm-shell">
      {/* Sidebar */}
      <aside className="adm-sidebar">
        <a href="/" className="adm-sidebar__brand">
          <span className="adm-sidebar__brand-dot">S</span>
          Suwappu Admin
        </a>

        <nav className="adm-nav" aria-label="Admin navigation">
          {navItems.map((item) => (
            <button
              key={item.id}
              className={`adm-nav__item${activeSection === item.id ? ' adm-nav__item--active' : ''}`}
              onClick={() => scrollTo(item.id)}
            >
              <span className="adm-nav__icon">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>

        <div className="adm-sidebar__footer">
          <div style={{ marginBottom: 6 }}>Key: <span style={{ fontFamily: 'var(--font-mono, monospace)' }}>{keyPreview}</span></div>
          <button className="adm-signout-btn" onClick={onSignOut}>Sign out</button>
        </div>
      </aside>

      {/* Mobile tabs */}
      <div className="adm-tabs">
        {navItems.map((item) => (
          <button
            key={item.id}
            className={`adm-filter-btn${activeSection === item.id ? ' adm-filter-btn--active' : ''}`}
            onClick={() => scrollTo(item.id)}
          >
            {item.icon} {item.label}
          </button>
        ))}
      </div>

      {/* Main */}
      <main className="adm-main">
        <div className="adm-topbar">
          <h1 className="adm-topbar__title">Dashboard</h1>
          <span className="adm-topbar__key-badge">&#128273; {keyPreview}</span>
        </div>

        {/* Overview: KPI cards */}
        <div id="overview" style={{ scrollMarginTop: 24 }}>
          {statsError && <div className="adm-error">Stats unavailable: {statsError}</div>}
          {stats ? (
            <StatCards stats={stats} timeseries={timeseries} />
          ) : !statsError && (
            <div className="adm-loading">Loading overview…</div>
          )}
        </div>

        {/* Activity: timeseries charts */}
        <ActivityCharts timeseries={timeseries} />

        <AgentsTable apiKey={apiKey} />
        <SwapsTable  apiKey={apiKey} />
        <WebhooksTable apiKey={apiKey} />
      </main>
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [ready, setReady]   = useState(false);

  useEffect(() => {
    // Hydrate from localStorage after mount (avoids SSR mismatch).
    const stored = localStorage.getItem(KEY_STORE);
    setApiKey(stored);
    setReady(true);
  }, []);

  function handleAuth(key: string) { setApiKey(key); }

  function handleSignOut() {
    localStorage.removeItem(KEY_STORE);
    setApiKey(null);
  }

  if (!ready) return null;
  if (!apiKey) return <AuthGate onAuth={handleAuth} />;
  return <Dashboard apiKey={apiKey} onSignOut={handleSignOut} />;
}
