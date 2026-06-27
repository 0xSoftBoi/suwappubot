'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { API_BASE_URL } from '@/lib/links';
import { useDashboardAuth } from './auth-context';
import UsageChart, { DailyBucket } from './components/UsageChart';
import styles from './dashboard.module.css';

// ── Types ────────────────────────────────────────────────────────────────────

interface OrgMe {
  id: string;
  name: string;
  tier: string;
  subscription?: {
    renewsAt?: string;
    status?: string;
    rateLimitPerMin?: number;
    seatLimit?: number;
  };
}

interface Member {
  userId: string;
  name: string;
  handle?: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  joinedAt: string;
}

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt?: string;
  expiresAt?: string;
  revokedAt?: string;
  callsThisMonth?: number;
}

interface TopEndpoint {
  endpoint: string;
  count: number;
}

interface UsageData {
  callsToday: number;
  callsThisMonth: number;
  rateLimitHits: number;
  avgDurationMs: number;
  errorRate: number;       // 0–100
  topEndpoints: TopEndpoint[];
  daily: DailyBucket[];
}

interface DashboardData {
  org: OrgMe;
  members: Member[];
  apiKeys: ApiKey[];
  usage: UsageData;
  callerRole: 'owner' | 'admin' | 'member' | 'viewer';
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso?: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  } catch { return '—'; }
}

function fmtNumber(n: number): string {
  return n.toLocaleString();
}

function fmtMs(ms: number): string {
  return `${ms.toLocaleString()}ms`;
}

// Days until a date; negative = expired
function daysUntil(iso?: string): number | null {
  if (!iso) return null;
  const diff = new Date(iso).getTime() - Date.now();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

// API key status derived from expiresAt / revokedAt
function keyStatus(k: ApiKey): 'active' | 'expiring' | 'expired' | 'revoked' {
  if (k.revokedAt) return 'revoked';
  if (!k.expiresAt) return 'active';
  const d = daysUntil(k.expiresAt);
  if (d === null) return 'active';
  if (d < 0) return 'expired';
  if (d <= 7) return 'expiring';
  return 'active';
}

const KEY_STATUS_LABEL: Record<string, string> = {
  active: 'Active',
  expiring: 'Expiring soon',
  expired: 'Expired',
  revoked: 'Revoked',
};

// Status dot color: green / yellow / red
type SignalColor = 'green' | 'yellow' | 'red';

function errorRateColor(rate: number): SignalColor {
  if (rate < 0.1)  return 'green';
  if (rate < 1)    return 'yellow';
  return 'red';
}

function latencyColor(ms: number): SignalColor {
  if (ms < 200) return 'green';
  if (ms < 500) return 'yellow';
  return 'red';
}

const SIGNAL_DOT: Record<SignalColor, React.CSSProperties> = {
  green:  { background: '#27ae60', boxShadow: '0 0 0 3px rgba(39,174,96,0.18)' },
  yellow: { background: '#e5b02b', boxShadow: '0 0 0 3px rgba(229,176,43,0.18)' },
  red:    { background: '#c0392b', boxShadow: '0 0 0 3px rgba(192,57,43,0.18)' },
};

const ROLE_LABELS: Record<string, string> = {
  owner: 'Owner', admin: 'Admin', member: 'Member', viewer: 'Viewer',
};

const ROLE_CLASS: Record<string, string> = {
  owner:  styles['roleBadge--owner'],
  admin:  styles['roleBadge--admin'],
  member: styles['roleBadge--member'],
  viewer: styles['roleBadge--viewer'],
};

const ALL_SCOPES = ['swap', 'read', 'orders', 'portfolio', 'alerts', 'admin'];

// Enterprise soft warning threshold for usage meter (enterprise = "unlimited")
const ENTERPRISE_SOFT_WARN = 500_000;

// ── Fetch helper: clears token + redirects on 401 ────────────────────────────

function useApiFetch(token: string, clearToken: () => void) {
  const router = useRouter();
  return useCallback(
    async (path: string, opts: RequestInit = {}): Promise<Response> => {
      const res = await fetch(`${API_BASE_URL}${path}`, {
        ...opts,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          ...(opts.headers ?? {}),
        },
      });
      if (res.status === 401) { clearToken(); router.replace('/dashboard'); }
      return res;
    },
    [token, clearToken, router]
  );
}

// ── New API Key Modal ────────────────────────────────────────────────────────

interface NewKeyModalProps {
  orgId: string;
  onClose: () => void;
  onCreated: (key: ApiKey) => void;
  apiFetch: ReturnType<typeof useApiFetch>;
}

function NewKeyModal({ orgId, onClose, onCreated, apiFetch }: NewKeyModalProps) {
  const [name, setName]   = useState('');
  const [scopes, setScopes] = useState<string[]>(['read', 'swap']);
  const [busy, setBusy]   = useState(false);
  const [err, setErr]     = useState<string | null>(null);

  function toggleScope(s: string) {
    setScopes((prev) => prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]);
  }

  async function handleCreate() {
    if (!name.trim()) { setErr('Key name is required.'); return; }
    setBusy(true); setErr(null);
    try {
      const res = await apiFetch(`/enterprise/orgs/${orgId}/api-keys`, {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), scopes }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErr(body?.detail ?? 'Failed to create key.');
        return;
      }
      const created: ApiKey = await res.json();
      onCreated(created);
    } catch {
      setErr('Network error. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.modalBackdrop} role="dialog" aria-modal="true" aria-label="Create API key">
      <div className={styles.modal}>
        <h2 className={styles.modalTitle}>New API Key</h2>
        <label className={styles.fieldLabel}>
          <span className={styles.fieldLabelText}>Key name *</span>
          <input
            className={styles.fieldInput}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="prod-agent-fleet"
            autoFocus
          />
        </label>
        <div>
          <span className={styles.fieldLabelText}>Scopes</span>
          <div className={styles.scopeGrid}>
            {ALL_SCOPES.map((s) => (
              <label key={s} className={styles.scopeCheck}>
                <input type="checkbox" checked={scopes.includes(s)} onChange={() => toggleScope(s)} />
                {s}
              </label>
            ))}
          </div>
        </div>
        {err && <p className={styles.loginError} role="alert">{err}</p>}
        <div className={styles.modalActions}>
          <button className={styles.actionBtn} onClick={onClose} disabled={busy}>Cancel</button>
          <button
            className="summer-button summer-button--primary"
            onClick={handleCreate}
            disabled={busy || !name.trim()}
          >
            {busy ? 'Creating…' : 'Create key'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Normalise usage API payload ───────────────────────────────────────────────

function parseUsage(payload: Record<string, unknown>): UsageData {
  const rawDaily = Array.isArray(payload?.daily) ? payload.daily as Record<string, unknown>[] : [];
  const daily: DailyBucket[] = rawDaily.map((d) => ({
    date:  String(d.date ?? d.label ?? ''),
    count: Number(d.count ?? d.value ?? 0),
  }));

  const rawEndpoints = Array.isArray(payload?.topEndpoints) ? payload.topEndpoints as Record<string, unknown>[] : [];
  const topEndpoints: TopEndpoint[] = rawEndpoints.map((e) => ({
    endpoint: String(e.endpoint ?? ''),
    count:    Number(e.count ?? 0),
  }));

  return {
    callsToday:    Number(payload?.callsToday    ?? 0),
    callsThisMonth:Number(payload?.callsThisMonth ?? 0),
    rateLimitHits: Number(payload?.rateLimitHits  ?? 0),
    avgDurationMs: Number(payload?.avgDurationMs  ?? 0),
    errorRate:     Number(payload?.errorRate       ?? 0),
    topEndpoints,
    daily,
  };
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { token, clearToken } = useDashboardAuth();
  const apiFetch              = useApiFetch(token, clearToken);

  const [data, setData]         = useState<DashboardData | null>(null);
  const [loading, setLoading]   = useState(true);
  const [fetchErr, setFetchErr] = useState<string | null>(null);
  const [showNewKey, setShowNewKey] = useState(false);

  // Period for usage chart (7D | 30D)
  const [period, setPeriod] = useState<'7d' | '30d'>('7d');
  const [periodUsage, setPeriodUsage] = useState<UsageData | null>(null);
  const [periodLoading, setPeriodLoading] = useState(false);

  // ── Initial load ──────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    async function load() {
      try {
        const [orgRes, membersRes, keysRes, usageRes] = await Promise.all([
          apiFetch('/enterprise/orgs/me'),
          apiFetch('/enterprise/orgs/me/members'),
          apiFetch('/enterprise/orgs/me/api-keys'),
          apiFetch('/enterprise/orgs/me/usage?period=7d'),
        ]);
        if (cancelled) return;
        if (orgRes.status === 401) return;

        const org: OrgMe = orgRes.ok
          ? await orgRes.json()
          : { id: 'unknown', name: 'Your Org', tier: 'Enterprise' };

        const membersPayload = membersRes.ok ? await membersRes.json() : [];
        const members: Member[] = Array.isArray(membersPayload)
          ? membersPayload
          : (membersPayload?.members ?? []);

        const keysPayload = keysRes.ok ? await keysRes.json() : [];
        const apiKeys: ApiKey[] = Array.isArray(keysPayload)
          ? keysPayload
          : (keysPayload?.keys ?? []);

        // Sort by lastUsedAt desc
        apiKeys.sort((a, b) => {
          if (!a.lastUsedAt && !b.lastUsedAt) return 0;
          if (!a.lastUsedAt) return 1;
          if (!b.lastUsedAt) return -1;
          return new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime();
        });

        const usagePayload = usageRes.ok ? await usageRes.json() : {};
        const usage = parseUsage(usagePayload as Record<string, unknown>);

        const callerRole: DashboardData['callerRole'] =
          (members[0]?.role as DashboardData['callerRole']) ?? 'member';

        setData({ org, members, apiKeys, usage, callerRole });
        setPeriodUsage(usage);
      } catch (e) {
        if (!cancelled) {
          setFetchErr('Could not load dashboard. Check your connection.');
          console.error(e);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [apiFetch]);

  // ── Period switch: re-fetch usage with ?period= ───────────────────────────
  const handlePeriodChange = useCallback(async (p: '7d' | '30d') => {
    if (p === period) return;
    setPeriod(p);
    setPeriodLoading(true);
    try {
      const res = await apiFetch(`/enterprise/orgs/me/usage?period=${p}`);
      if (res.ok) {
        const payload = await res.json();
        setPeriodUsage(parseUsage(payload as Record<string, unknown>));
      }
    } catch { /* keep previous data */ }
    finally { setPeriodLoading(false); }
  }, [apiFetch, period]);

  // ── Key / member mutations ────────────────────────────────────────────────
  async function revokeKey(keyId: string) {
    if (!data) return;
    await apiFetch(`/enterprise/orgs/${data.org.id}/api-keys/${keyId}`, { method: 'DELETE' });
    setData((prev) =>
      prev ? {
        ...prev,
        apiKeys: prev.apiKeys.map((k) =>
          k.id === keyId ? { ...k, revokedAt: new Date().toISOString() } : k
        ),
      } : prev
    );
  }

  async function removeMember(userId: string) {
    if (!data) return;
    await apiFetch(`/enterprise/orgs/${data.org.id}/members/${userId}`, { method: 'DELETE' });
    setData((prev) =>
      prev ? { ...prev, members: prev.members.filter((m) => m.userId !== userId) } : prev
    );
  }

  // ── Render guards ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className={styles.stateBox}>
        <div className={styles.spinner} aria-hidden="true" />
        <span>Loading dashboard…</span>
      </div>
    );
  }

  if (fetchErr || !data) {
    return (
      <div className={styles.stateBox} role="alert">
        <span>{fetchErr ?? 'Unexpected error.'}</span>
        <button className={styles.actionBtn} onClick={() => window.location.reload()}>Retry</button>
      </div>
    );
  }

  const { org, members, apiKeys, usage, callerRole } = data;
  const activeUsage = periodUsage ?? usage;
  const canManage   = callerRole === 'owner' || callerRole === 'admin';
  const activeKeys  = apiKeys.filter((k) => !k.revokedAt);

  // Billing helpers
  const totalCalls   = usage.callsThisMonth;
  const seatUsed     = members.length;
  const seatLimit    = org.subscription?.seatLimit ?? null;
  const rateLimit    = org.subscription?.rateLimitPerMin ?? 1000;
  const subStatus    = org.subscription?.status ?? 'active';
  const usagePct     = Math.min((totalCalls / ENTERPRISE_SOFT_WARN) * 100, 100);

  // Top endpoints total (for percentage bars)
  const endpointTotal = usage.topEndpoints.reduce((s, e) => s + e.count, 0) || 1;

  return (
    <>
      {/* ── Header bar ── */}
      <header className={styles.header}>
        <h1 className={styles.orgName}>{org.name}</h1>
        <span className={styles.tierBadge}>Enterprise</span>
        <div className={styles.headerSep} />
        <div className={styles.userInfo}>
          <span className={styles.userName}>{members[0]?.name ?? 'You'}</span>
          <span className={`${styles.roleBadge} ${ROLE_CLASS[callerRole] ?? styles['roleBadge--member']}`}>
            {ROLE_LABELS[callerRole] ?? callerRole}
          </span>
        </div>
        <button className={styles.signOutBtn} onClick={clearToken}>Sign out</button>
      </header>

      {/* ── 6-tile KPI strip ── */}
      <div className={styles.kpiRow} aria-label="Key performance indicators">

        {/* 1 — API Calls Today */}
        <div className={styles.kpiCard}>
          <div className={styles.kpiDot} style={{ background: '#8eb6c5' }} aria-hidden="true" />
          <p className={styles.kpiLabel}>API Calls Today</p>
          <span className={styles.kpiValue}>{fmtNumber(usage.callsToday)}</span>
        </div>

        {/* 2 — API Calls This Month */}
        <div className={styles.kpiCard}>
          <div className={styles.kpiDot} style={{ background: '#8eb6c5' }} aria-hidden="true" />
          <p className={styles.kpiLabel}>API Calls This Month</p>
          <span className={styles.kpiValue}>{fmtNumber(usage.callsThisMonth)}</span>
        </div>

        {/* 3 — Error Rate */}
        <div className={styles.kpiCard}>
          <div
            className={styles.kpiDot}
            style={SIGNAL_DOT[errorRateColor(usage.errorRate)]}
            aria-label={`Status: ${errorRateColor(usage.errorRate)}`}
          />
          <p className={styles.kpiLabel}>Error Rate</p>
          <span className={styles.kpiValue}>{usage.errorRate.toFixed(2)}%</span>
        </div>

        {/* 4 — Avg Response Time */}
        <div className={styles.kpiCard}>
          <div
            className={styles.kpiDot}
            style={SIGNAL_DOT[latencyColor(usage.avgDurationMs)]}
            aria-label={`Status: ${latencyColor(usage.avgDurationMs)}`}
          />
          <p className={styles.kpiLabel}>Avg Response Time</p>
          <span className={styles.kpiValue}>{fmtMs(usage.avgDurationMs)}</span>
        </div>

        {/* 5 — Team Members */}
        <div className={styles.kpiCard}>
          <div className={styles.kpiDot} style={{ background: '#8eb6c5' }} aria-hidden="true" />
          <p className={styles.kpiLabel}>Team Members</p>
          <span className={styles.kpiValue}>{fmtNumber(members.length)}</span>
        </div>

        {/* 6 — Active API Keys */}
        <div className={styles.kpiCard}>
          <div className={styles.kpiDot} style={{ background: '#8eb6c5' }} aria-hidden="true" />
          <p className={styles.kpiLabel}>Active API Keys</p>
          <span className={styles.kpiValue}>{fmtNumber(activeKeys.length)}</span>
        </div>

      </div>

      {/* ── Usage chart ── */}
      <section className={styles.card} aria-label="API usage chart">
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>API Usage</h2>
          {periodLoading && (
            <span style={{ color: 'var(--summer-muted)', fontFamily: 'var(--font-mono)', fontSize: '0.7rem' }}>
              Loading…
            </span>
          )}
        </div>
        <div className={styles.chartWrap}>
          <UsageChart
            daily={activeUsage.daily}
            errorRate={activeUsage.errorRate}
            rateLimitHits={activeUsage.rateLimitHits}
            avgDurationMs={activeUsage.avgDurationMs}
            period={period}
            onPeriodChange={handlePeriodChange}
          />
        </div>
      </section>

      {/* ── Top endpoints table ── */}
      {usage.topEndpoints.length > 0 && (
        <section className={styles.card} aria-label="Top endpoints">
          <div className={styles.cardHead}>
            <h2 className={styles.cardTitle}>Top Endpoints</h2>
            <span className={styles.kicker}>this month</span>
          </div>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Endpoint</th>
                <th style={{ textAlign: 'right' }}>Calls</th>
                <th style={{ textAlign: 'right' }}>% of total</th>
                <th style={{ width: 140 }}>Proportion</th>
              </tr>
            </thead>
            <tbody>
              {usage.topEndpoints.map((ep, i) => {
                const pct = (ep.count / endpointTotal) * 100;
                return (
                  <tr key={i}>
                    <td className={styles.mono}>{ep.endpoint}</td>
                    <td className={styles.mono} style={{ textAlign: 'right' }}>
                      {ep.count.toLocaleString()}
                    </td>
                    <td className={styles.mono} style={{ textAlign: 'right', color: 'var(--summer-muted)' }}>
                      {pct.toFixed(1)}%
                    </td>
                    <td>
                      <div className={styles.propBarTrack}>
                        <div
                          className={styles.propBarFill}
                          style={{ width: `${pct}%` }}
                          aria-label={`${pct.toFixed(1)}% of calls`}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {/* ── Latency distribution (placeholder until endpoint returns buckets) ── */}
      <section className={styles.card} aria-label="Latency distribution">
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>Latency Distribution</h2>
        </div>
        <div className={styles.latencyPlaceholder}>
          <span className={styles.latencyPlaceholderIcon} aria-hidden="true">⏱</span>
          <div>
            <p className={styles.latencyPlaceholderTitle}>Latency breakdown coming soon</p>
            <p className={styles.latencyPlaceholderSub}>
              P50 / P95 / P99 buckets (&lt;100ms · 100–200ms · 200–500ms · 500ms–1s · &gt;1s)
              will appear here once the usage endpoint returns per-bucket data.
              Current average: <strong>{fmtMs(usage.avgDurationMs)}</strong>
            </p>
          </div>
        </div>
      </section>

      {/* ── Team table ── */}
      <section className={styles.card} aria-label="Team members">
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>Team</h2>
        </div>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Member</th>
              <th>Role</th>
              <th>Joined</th>
              {canManage && <th aria-label="Actions" />}
            </tr>
          </thead>
          <tbody>
            {members.length === 0 && (
              <tr>
                <td colSpan={canManage ? 4 : 3} style={{ color: 'var(--summer-muted)', fontStyle: 'italic' }}>
                  No members found.
                </td>
              </tr>
            )}
            {members.map((m) => (
              <tr key={m.userId}>
                <td>
                  <span style={{ fontWeight: 600 }}>{m.name}</span>
                  {m.handle && (
                    <span className={styles.mono} style={{ marginLeft: 8 }}>{m.handle}</span>
                  )}
                </td>
                <td>
                  <span className={`${styles.roleBadge} ${ROLE_CLASS[m.role] ?? styles['roleBadge--member']}`}>
                    {ROLE_LABELS[m.role] ?? m.role}
                  </span>
                </td>
                <td className={styles.mono}>{fmtDate(m.joinedAt)}</td>
                {canManage && (
                  <td>
                    {m.role !== 'owner' && (
                      <button
                        className={styles.actionBtn}
                        onClick={() => removeMember(m.userId)}
                        aria-label={`Remove ${m.name}`}
                      >
                        Remove
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* ── API Keys table ── */}
      <section className={styles.card} aria-label="API keys">
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>API Keys</h2>
          {canManage && (
            <button
              className={`${styles.actionBtn} ${styles['actionBtn--create']}`}
              onClick={() => setShowNewKey(true)}
            >
              + Create New Key
            </button>
          )}
        </div>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Prefix</th>
              <th>Scopes</th>
              <th>Calls / mo</th>
              <th>Status</th>
              <th>Last Used</th>
              <th>Expires</th>
              {canManage && <th aria-label="Actions" />}
            </tr>
          </thead>
          <tbody>
            {apiKeys.length === 0 && (
              <tr>
                <td colSpan={canManage ? 8 : 7} style={{ color: 'var(--summer-muted)', fontStyle: 'italic' }}>
                  No API keys yet.
                </td>
              </tr>
            )}
            {apiKeys.map((k) => {
              const st = keyStatus(k);
              return (
                <tr key={k.id} style={{ opacity: st === 'revoked' ? 0.45 : 1 }}>
                  <td style={{ fontWeight: 600 }}>{k.name}</td>
                  <td className={styles.mono}>{k.prefix}…</td>
                  <td>
                    <div className={styles.pills}>
                      {k.scopes.map((s) => (
                        <span key={s} className={styles.pill}>{s}</span>
                      ))}
                    </div>
                  </td>
                  <td className={styles.mono}>
                    {k.callsThisMonth !== undefined ? k.callsThisMonth.toLocaleString() : '—'}
                  </td>
                  <td>
                    <span className={`${styles.keyStatusBadge} ${styles[`keyStatus--${st}`]}`}>
                      {KEY_STATUS_LABEL[st]}
                    </span>
                  </td>
                  <td className={styles.mono}>{fmtDate(k.lastUsedAt)}</td>
                  <td className={styles.mono}>{fmtDate(k.expiresAt)}</td>
                  {canManage && (
                    <td>
                      {st !== 'revoked' && (
                        <button
                          className={styles.actionBtn}
                          onClick={() => revokeKey(k.id)}
                          aria-label={`Revoke ${k.name}`}
                        >
                          Revoke
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {/* ── Billing ── */}
      <section className={styles.card} aria-label="Billing">
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>Billing</h2>
        </div>

        {/* Plan row */}
        <div className={styles.billingPlanRow}>
          <div className={styles.billingPlan}>
            <span className={styles.tierBadge}>Enterprise</span>
            <span className={styles.billingPlanName}>{org.tier ?? 'Enterprise'} Plan</span>
          </div>
          {org.subscription?.renewsAt && (
            <span className={styles.billingMeta}>
              Renewal: {fmtDate(org.subscription.renewsAt)}
            </span>
          )}
          <div className={styles.billingStatusPill} data-status={subStatus}>
            <span className={styles.billingStatusDot} />
            {subStatus.charAt(0).toUpperCase() + subStatus.slice(1)}
          </div>
          <div className={styles.billingLink}>
            <Link
              href="/pricing"
              className={`${styles.actionBtn} ${styles['actionBtn--create']}`}
              style={{
                display: 'inline-flex', alignItems: 'center', textDecoration: 'none',
                minHeight: 34, padding: '0 14px', borderRadius: 8,
                border: '1px solid rgba(207,227,234,0.9)',
              }}
            >
              Manage Billing
            </Link>
          </div>
        </div>

        {/* Usage meter */}
        <div className={styles.billingMetrics}>

          <div className={styles.billingMetric}>
            <div className={styles.billingMetricLabel}>
              <span>API Calls This Month</span>
              <span className={styles.mono}>{totalCalls.toLocaleString()} / ∞</span>
            </div>
            <div className={styles.meterTrack} aria-label={`${totalCalls.toLocaleString()} API calls used`}>
              <div className={styles.meterFill} style={{ width: `${usagePct}%` }} />
            </div>
            {totalCalls > ENTERPRISE_SOFT_WARN * 0.8 && (
              <p className={styles.billingWarn}>
                Heads up — approaching {(ENTERPRISE_SOFT_WARN / 1000).toFixed(0)}k soft monitoring threshold.
                Contact your account manager to discuss capacity.
              </p>
            )}
          </div>

          <div className={styles.billingMetric}>
            <div className={styles.billingMetricLabel}>
              <span>Rate Limit</span>
              <span className={styles.mono}>{rateLimit.toLocaleString()} req/min</span>
            </div>
          </div>

          {seatLimit !== null && (
            <div className={styles.billingMetric}>
              <div className={styles.billingMetricLabel}>
                <span>Seat Usage</span>
                <span className={styles.mono}>{seatUsed} / {seatLimit} seats</span>
              </div>
              <div className={styles.meterTrack} aria-label={`${seatUsed} of ${seatLimit} seats used`}>
                <div
                  className={styles.meterFill}
                  style={{
                    width: `${Math.min((seatUsed / seatLimit) * 100, 100)}%`,
                    background: seatUsed >= seatLimit
                      ? 'linear-gradient(90deg, #c0392b, #e74c3c)'
                      : undefined,
                  }}
                />
              </div>
            </div>
          )}

        </div>
      </section>

      {/* ── New key modal ── */}
      {showNewKey && (
        <NewKeyModal
          orgId={org.id}
          onClose={() => setShowNewKey(false)}
          onCreated={(key) => {
            setData((prev) => prev ? { ...prev, apiKeys: [key, ...prev.apiKeys] } : prev);
            setShowNewKey(false);
          }}
          apiFetch={apiFetch}
        />
      )}
    </>
  );
}
