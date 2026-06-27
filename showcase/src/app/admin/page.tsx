'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { API_BASE_URL } from '@/lib/links';
import './admin.css';

// ── Types ──────────────────────────────────────────────────────────────────

interface AdminStats {
  agents_total: number;
  agents_24h: number;
  swaps_total: number;
  swaps_24h: number;
  swaps_volume_usd_24h?: number;
  webhooks_active: number;
  webhooks_deliveries_24h: number;
  webhooks_failure_rate_24h?: number;
}

interface AgentRow {
  agent_id: string;
  status: 'active' | 'inactive' | string;
  total_requests: number;
  total_swaps: number;
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

function truncate(s: string, len = 12): string {
  if (!s) return '—';
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

// ── Auth Gate ────────────────────────────────────────────────────────────────

function AuthGate({ onAuth }: { onAuth: (key: string) => void }) {
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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
        setError('Invalid admin key — check your credentials.');
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

// ── Stat cards ───────────────────────────────────────────────────────────────

function StatCards({ stats }: { stats: AdminStats }) {
  return (
    <div className="adm-stats">
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
        <div className="adm-stat__label">Revenue</div>
        <div className="adm-stat__value" style={{ fontSize: '1.1rem', paddingTop: 4, color: 'var(--adm-faint)' }}>
          See billing
        </div>
        <div className="adm-billing-placeholder">
          <a href="https://dashboard.stripe.com" target="_blank" rel="noopener noreferrer">
            Open Stripe dashboard ↗
          </a>
        </div>
      </div>
    </div>
  );
}

// ── Agents table ─────────────────────────────────────────────────────────────

function AgentsTable({ apiKey }: { apiKey: string }) {
  const [rows, setRows] = useState<AgentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    adminFetch<AgentRow[]>('/admin/agents', apiKey)
      .then(setRows)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [apiKey]);

  const filtered = filter === 'all' ? rows : rows.filter((r) => r.status === filter);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const slice = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

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
                      <td className="adm-mono">{fmtTime(row.created_at)}</td>
                      <td className="adm-mono">{fmtTime(row.last_active_at)}</td>
                    </tr>
                    {isExpanded && (
                      <tr key={`${row.agent_id}-detail`} className="adm-row-detail">
                        <td colSpan={6}>
                          <dl className="adm-detail-grid">
                            <div>
                              <dt>Full Agent ID</dt>
                              <dd>{row.agent_id}</dd>
                            </div>
                            <div>
                              <dt>Status</dt>
                              <dd>{row.status}</dd>
                            </div>
                            <div>
                              <dt>Total Requests</dt>
                              <dd>{row.total_requests.toLocaleString()}</dd>
                            </div>
                            <div>
                              <dt>Total Swaps</dt>
                              <dd>{row.total_swaps.toLocaleString()}</dd>
                            </div>
                            <div>
                              <dt>Created</dt>
                              <dd>{row.created_at}</dd>
                            </div>
                            <div>
                              <dt>Last Active</dt>
                              <dd>{row.last_active_at}</dd>
                            </div>
                            {Object.entries(row)
                              .filter(([k]) => !['agent_id', 'status', 'total_requests', 'total_swaps', 'created_at', 'last_active_at'].includes(k))
                              .map(([k, v]) => (
                                <div key={k}>
                                  <dt>{k}</dt>
                                  <dd>{String(v)}</dd>
                                </div>
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

// ── Swaps table ──────────────────────────────────────────────────────────────

function SwapsTable({ apiKey }: { apiKey: string }) {
  const [rows, setRows] = useState<SwapRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState<'all' | 'success' | 'failed' | 'pending'>('all');

  useEffect(() => {
    setLoading(true);
    adminFetch<SwapRow[]>('/admin/swaps', apiKey)
      .then(setRows)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [apiKey]);

  const filtered = filter === 'all' ? rows : rows.filter((r) => r.status === filter);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const slice = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div className="adm-section" id="swaps">
      <div className="adm-section__head">
        <h2 className="adm-section__title">Swaps</h2>
        <span className="adm-section__meta">{filtered.length} total</span>
      </div>

      <div className="adm-filters">
        {(['all', 'success', 'failed', 'pending'] as const).map((f) => (
          <button key={f} className={`adm-filter-btn${filter === f ? ' adm-filter-btn--active' : ''}`} onClick={() => { setFilter(f); setPage(0); }}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
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
                  <td>{row.usd_value !== undefined ? fmtUSD(row.usd_value) : '—'}</td>
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

// ── Webhooks table ───────────────────────────────────────────────────────────

function WebhooksTable({ apiKey }: { apiKey: string }) {
  const [rows, setRows] = useState<WebhookRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(0);

  useEffect(() => {
    setLoading(true);
    adminFetch<WebhookRow[]>('/admin/webhooks', apiKey)
      .then(setRows)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [apiKey]);

  const totalPages = Math.ceil(rows.length / PAGE_SIZE);
  const slice = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

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
                  <td><span className="adm-mono">{row.response_code ?? '—'}</span></td>
                  <td style={{ maxWidth: 200 }}>
                    <span className="adm-mono" title={row.last_error} style={{ color: row.last_error ? 'var(--adm-red)' : 'var(--adm-faint)' }}>
                      {row.last_error ? truncate(row.last_error, 32) : '—'}
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

// ── Dashboard ─────────────────────────────────────────────────────────────────

type Section = 'overview' | 'agents' | 'swaps' | 'webhooks';

function Dashboard({ apiKey, onSignOut }: { apiKey: string; onSignOut: () => void }) {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [statsError, setStatsError] = useState('');
  const [activeSection, setActiveSection] = useState<Section>('overview');

  useEffect(() => {
    adminFetch<AdminStats>('/admin/stats', apiKey)
      .then(setStats)
      .catch((e) => setStatsError(e.message));
  }, [apiKey]);

  const keyPreview = apiKey.length > 10 ? `${apiKey.slice(0, 6)}••••${apiKey.slice(-3)}` : '••••••';

  const navItems: { id: Section; label: string; icon: string }[] = [
    { id: 'overview', label: 'Overview', icon: '◈' },
    { id: 'agents',   label: 'Agents',   icon: '⬡' },
    { id: 'swaps',    label: 'Swaps',    icon: '⇄' },
    { id: 'webhooks', label: 'Webhooks', icon: '⚡' },
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
          <span className="adm-topbar__key-badge">🔑 {keyPreview}</span>
        </div>

        {/* Overview anchor */}
        <div id="overview" style={{ scrollMarginTop: 24 }}>
          {statsError && <div className="adm-error">Stats unavailable: {statsError}</div>}
          {stats ? <StatCards stats={stats} /> : !statsError && (
            <div className="adm-loading">Loading overview…</div>
          )}
        </div>

        <AgentsTable apiKey={apiKey} />
        <SwapsTable apiKey={apiKey} />
        <WebhooksTable apiKey={apiKey} />
      </main>
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Hydrate from localStorage after mount (avoids SSR mismatch).
    const stored = localStorage.getItem(KEY_STORE);
    setApiKey(stored);
    setReady(true);
  }, []);

  function handleAuth(key: string) {
    setApiKey(key);
  }

  function handleSignOut() {
    localStorage.removeItem(KEY_STORE);
    setApiKey(null);
  }

  if (!ready) return null;

  if (!apiKey) {
    return <AuthGate onAuth={handleAuth} />;
  }

  return <Dashboard apiKey={apiKey} onSignOut={handleSignOut} />;
}
