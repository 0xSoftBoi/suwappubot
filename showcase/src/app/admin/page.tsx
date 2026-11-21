'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { API_BASE_URL, AUTH_BASE_URL } from '@/lib/links';
import FinancePanel from './FinancePanel';
import GrowthSection, { type GrowthReport, KpiTile, KpiGrid } from './GrowthSection';
import { SectionError, SectionSkeleton } from './SectionState';
import { CountUp } from '@/components/v3';
import DailyChart from '@/components/charts/DailyChart';
import { SESSION_AUTH, adminRequestInit } from './adminRequest';
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
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(2)}M`;
  if (a >= 1_000) return `${sign}$${(a / 1_000).toFixed(1)}k`;
  return `${sign}$${a.toFixed(2)}`;
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
  const res = await fetch(`${API_BASE_URL}${path}`, adminRequestInit(key));
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

// ── Activity charts section ───────────────────────────────────────────────────

function ActivityCharts({ timeseries }: { timeseries: AdminTimeseries | null }) {
  if (!timeseries) {
    return (
      <div className="adm-section" id="activity">
        <div className="adm-section__head">
          <h2 className="adm-section__title">Platform Activity</h2>
        </div>
        <div className="adm-loading" role="status">Loading charts…</div>
      </div>
    );
  }

  const charts = [
    {
      title: 'Swap Volume (30d)',
      sub: 'Daily swap count',
      el: <DailyChart title="Swap volume" mode="bars" unit={['swap', 'swaps']} format={fmtNum} points={timeseries.swapVolume.map((d) => ({ label: d.date, value: d.count }))} />,
    },
    {
      title: 'New Agents (30d)',
      sub: 'Daily registrations',
      el: <DailyChart title="New agents" unit={['agent', 'agents']} format={fmtNum} points={timeseries.newAgents.map((d) => ({ label: d.date, value: d.count }))} />,
    },
    {
      title: 'API Calls (30d)',
      sub: 'Enterprise API traffic',
      el: <DailyChart title="API calls" mode="bars" unit={['call', 'calls']} format={fmtNum} points={timeseries.apiCalls.map((d) => ({ label: d.date, value: d.count }))} />,
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

  const signed = (n: number) => `${n >= 0 ? '+' : '\u2212'}${fmtNum(Math.abs(n))}`;
  return (
    <KpiGrid>
      <KpiTile label="Total agents" value={fmtNum(stats.agents_total)} count={stats.agents_total}
        hint={`${signed(stats.agents_24h)} in the last 24 hours`} />
      <KpiTile label="Total swaps" value={fmtNum(stats.swaps_total)} count={stats.swaps_total}
        hint={`${signed(stats.swaps_24h)} in the last 24 hours${stats.swaps_volume_usd_24h !== undefined ? ` \u00b7 ${fmtUSD(stats.swaps_volume_usd_24h)} volume today` : ''}`} />
      <KpiTile label="Active webhooks" value={fmtNum(stats.webhooks_active)} count={stats.webhooks_active}
        hint={`${fmtNum(stats.webhooks_deliveries_24h)} deliveries today${stats.webhooks_failure_rate_24h !== undefined ? ` \u00b7 ${stats.webhooks_failure_rate_24h.toFixed(1)}% failed` : ''}`} />
      {stats.revenue_this_month !== undefined ? (
        <KpiTile label="Subscription value (MRR)" value={fmtUSD(stats.revenue_this_month)}
          hint="Monthly recurring value of paid plans. This is not the same as Money in above, which is cash actually collected." />
      ) : (
        <KpiTile label="Subscription value (MRR)" value="See billing"
          hint={<>Not reported by the API. <a href="https://dashboard.stripe.com" target="_blank" rel="noopener noreferrer">Open Stripe &#8599;</a></>} />
      )}
      <KpiTile label="Enterprise organisations" value={fmtNum(stats.enterprise_orgs ?? 0)} count={stats.enterprise_orgs ?? 0}
        hint={stats.active_enterprise_orgs !== undefined ? `${fmtNum(stats.active_enterprise_orgs)} active in the last 30 days` : 'Organisations on an enterprise plan'} />
      <KpiTile label="API calls today" value={fmtNum(stats.api_calls_today ?? 0)} count={stats.api_calls_today ?? 0}
        hint="Across all organisations" />
      <KpiTile label="Average swap size" value={avgSwapUSD !== null ? fmtUSD(avgSwapUSD) : '\u2014'}
        hint="30-day average, in USD" />
      <KpiTile label="Subscriptions" value="" panel>
        {stats.subscription_breakdown ? (
          <DonutChart breakdown={stats.subscription_breakdown} />
        ) : (
          <p style={{ margin: '8px 0 0', color: 'var(--adm-muted)', fontSize: '0.8rem' }}>No breakdown yet.</p>
        )}
      </KpiTile>
    </KpiGrid>
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

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    adminFetch<AgentRow[]>('/admin/agents', apiKey)
      .then(setRows)
      .catch((e) => setError(e.message || 'error'))
      .finally(() => setLoading(false));
  }, [apiKey]);

  useEffect(() => { load(); }, [load]);

  const filtered    = filter === 'all' ? rows : rows.filter((r) => r.status === filter);
  const totalPages  = Math.ceil(filtered.length / PAGE_SIZE);
  const slice       = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const hasSpend    = rows.some(r => r.total_spend !== undefined);

  return (
    <div className="adm-section" id="agents">
      <div className="adm-section__head">
        <h2 className="adm-section__title">Agents</h2>
        <span className="adm-section__meta">{error ? '—' : `${filtered.length} total`}</span>
      </div>

      <div className="adm-filters">
        {(['all', 'active', 'inactive'] as const).map((f) => (
          <button key={f} className={`adm-filter-btn${filter === f ? ' adm-filter-btn--active' : ''}`} onClick={() => { setFilter(f); setPage(0); }}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      <div className="adm-table-wrap">
        {loading ? (
          <SectionSkeleton what="agents" />
        ) : error ? (
          <SectionError what="agents" onRetry={load} detail={error} />
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

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    adminFetch<SwapRow[]>('/admin/swaps', apiKey)
      .then(setRows)
      .catch((e) => setError(e.message || 'error'))
      .finally(() => setLoading(false));
  }, [apiKey]);

  useEffect(() => { load(); }, [load]);

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
          <span className="adm-section__meta">{error ? '—' : `${filtered.length} shown`}</span>
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

      <div className="adm-table-wrap">
        {loading ? (
          <SectionSkeleton what="swaps" />
        ) : error ? (
          <SectionError what="swaps" onRetry={load} detail={error} />
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

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    adminFetch<WebhookRow[]>('/admin/webhooks', apiKey)
      .then(setRows)
      .catch((e) => setError(e.message || 'error'))
      .finally(() => setLoading(false));
  }, [apiKey]);

  useEffect(() => { load(); }, [load]);

  const totalPages = Math.ceil(rows.length / PAGE_SIZE);
  const slice      = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div className="adm-section" id="webhooks">
      <div className="adm-section__head">
        <h2 className="adm-section__title">Webhooks</h2>
        <span className="adm-section__meta">{error ? '—' : `${rows.length} events`}</span>
      </div>

      <div className="adm-table-wrap">
        {loading ? (
          <SectionSkeleton what="webhooks" />
        ) : error ? (
          <SectionError what="webhooks" onRetry={load} detail={error} />
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

function AuthGate({ onAuth, notice }: { onAuth: (key: string) => void; notice?: string }) {
  const [value, setValue]     = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [showKey, setShowKey] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!value.trim()) return;
    setLoading(true);
    setError('');
    try {
      await adminFetch('/admin/me', value.trim());
      localStorage.setItem(KEY_STORE, value.trim());
      onAuth(value.trim());
    } catch (err) {
      if (err instanceof Error && err.message === 'UNAUTHORIZED') {
        setError('That key was not accepted. Check it and try again.');
      } else {
        setError('Could not reach the server. Check your connection and try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  const returnTo = typeof window === 'undefined' ? 'https://suwappu.bot/admin' : `${window.location.origin}/admin`;

  return (
    <div className="adm-auth">
      <div className="adm-auth__card">
        <img className="adm-auth__logo" src="/logo.svg" alt="" width={44} height={44} aria-hidden="true" />
        <h1 className="adm-auth__title">Suwappu admin</h1>
        <p className="adm-auth__sub">See your visitors, sign-ups, sales leads and revenue.</p>

        <a
          className="adm-auth__btn adm-auth__btn--google"
          href={`${AUTH_BASE_URL}/auth/oauth/google/authorize?redirect_url=${encodeURIComponent(returnTo)}`}
        >
          Continue with Google
        </a>
        {notice && <p className="adm-auth__error" role="alert">{notice}</p>}

        <button type="button" className="adm-auth__toggle" aria-expanded={showKey} onClick={() => setShowKey((v) => !v)}>
          {showKey ? 'Hide admin key sign-in' : 'Use an admin key instead'}
        </button>
        {showKey && (
          <form onSubmit={handleSubmit}>
            <label className="adm-auth__label" htmlFor="adm-key">Admin key</label>
            <input
              id="adm-key"
              name="admin-key"
              type="password"
              autoComplete="current-password"
              spellCheck={false}
              className="adm-auth__input"
              placeholder="Paste your admin key…"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
            {error && <p className="adm-auth__error" role="alert">{error}</p>}
            <button type="submit" className="adm-auth__btn" disabled={loading} aria-busy={loading}>
              Sign in
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

type Section = 'growth' | 'overview' | 'finance' | 'activity' | 'agents' | 'swaps' | 'webhooks';

function Dashboard({ apiKey, email, onSignOut }: { apiKey: string; email: string | null; onSignOut: () => void }) {
  const [stats, setStats]           = useState<AdminStats | null>(null);
  const [statsError, setStatsError] = useState('');
  const [statsLoading, setStatsLoading] = useState(true);
  const [timeseries, setTimeseries] = useState<AdminTimeseries | null>(null);
  const [activeSection, setActiveSection] = useState<Section>('growth');

  const loadStats = useCallback(() => {
    setStatsError('');
    setStatsLoading(true);
    adminFetch<AdminStats>('/admin/stats', apiKey)
      .then(setStats)
      .catch((e) => setStatsError(e.message || 'error'))
      .finally(() => setStatsLoading(false));
  }, [apiKey]);

  useEffect(() => {
    loadStats();

    // Graceful: timeseries endpoint may not exist yet
    adminFetch<AdminTimeseries>('/admin/stats/timeseries?days=30', apiKey)
      .then(setTimeseries)
      .catch(() => { /* silent: charts just stay empty */ });
  }, [apiKey, loadStats]);

  const keyPreview = apiKey === SESSION_AUTH
    ? (email ?? 'Signed in with Google')
    : apiKey.length > 10 ? `${apiKey.slice(0, 6)}••••${apiKey.slice(-3)}` : '••••••';
  const loadGrowth = useCallback((path: string) => adminFetch<GrowthReport>(path, apiKey), [apiKey]);

  const navItems: { id: Section; label: string; icon: string }[] = [
    { id: 'growth',    label: 'Growth',    icon: '↗' },
    { id: 'overview',  label: 'Product',   icon: '◈' },
    { id: 'finance',   label: 'Finance',   icon: '◇' },
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
          <img className="adm-sidebar__brand-dot" src="/logo.svg" alt="" width={28} height={28} aria-hidden="true" />
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
          <div style={{ marginBottom: 6, overflowWrap: 'anywhere' }}>{apiKey === SESSION_AUTH ? 'Signed in as ' : 'Key: '}<span style={{ fontFamily: 'var(--font-mono, monospace)' }}>{keyPreview}</span></div>
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
          <span className="adm-topbar__key-badge">{keyPreview}</span>
        </div>

        <GrowthSection load={loadGrowth} />

        {/* Overview: KPI cards */}
        <div id="overview" style={{ scrollMarginTop: 24 }}>
          <div className="adm-section__head">
            <h2 className="adm-section__title">Product</h2>
            <span className="adm-section__meta">Totals across the whole platform</span>
          </div>
          {statsError && !stats ? (
            <SectionError what="the product numbers" onRetry={loadStats} detail={statsError} />
          ) : stats ? (
            <StatCards stats={stats} timeseries={timeseries} />
          ) : (
            <SectionSkeleton what="the product numbers" rows={3} />
          )}
        </div>

        <FinancePanel apiKey={apiKey} />

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
  const [email, setEmail]   = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [ready, setReady]   = useState(false);

  useEffect(() => {
    // Hydrate after mount (avoids SSR mismatch). A stored key wins; otherwise
    // see whether the visitor already has a staff Google session.
    const url = new URL(window.location.href);
    const cameFromGoogle = url.searchParams.has('auth') || url.searchParams.has('auth_error');
    const googleFailed = url.searchParams.has('auth_error');
    if (cameFromGoogle) {
      ['auth', 'provider', 'auth_error'].forEach((k) => url.searchParams.delete(k));
      window.history.replaceState(null, '', url.toString());
    }

    const stored = localStorage.getItem(KEY_STORE);
    if (stored) { setApiKey(stored); setReady(true); return; }

    let cancelled = false;
    adminFetch<{ email: string | null }>('/admin/me', SESSION_AUTH)
      .then((me) => { if (!cancelled) { setEmail(me.email); setApiKey(SESSION_AUTH); } })
      .catch(() => {
        if (cancelled || !cameFromGoogle) return;
        setNotice(googleFailed
          ? 'Google sign-in did not complete. Please try again.'
          : 'You are signed in, but this Google account does not have admin access. Ask the account owner to add your email.');
      })
      .finally(() => { if (!cancelled) setReady(true); });
    return () => { cancelled = true; };
  }, []);

  function handleAuth(key: string) { setApiKey(key); }

  function handleSignOut() {
    localStorage.removeItem(KEY_STORE);
    if (apiKey === SESSION_AUTH) {
      fetch(`${AUTH_BASE_URL}/auth/logout`, { method: 'POST', credentials: 'include' }).catch(() => {});
    }
    setApiKey(null);
    setEmail(null);
  }

  if (!ready) return <div className="adm-loading" role="status">Loading…</div>;
  if (!apiKey) return <AuthGate onAuth={handleAuth} notice={notice} />;
  return <Dashboard apiKey={apiKey} email={email} onSignOut={handleSignOut} />;
}
