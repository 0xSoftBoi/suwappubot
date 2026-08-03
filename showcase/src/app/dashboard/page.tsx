'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { API_BASE_URL } from '@/lib/links';
import { useDashboardAuth } from './auth-context';
import UsageChart, { DailyBucket } from './components/UsageChart';
import BillingPanel from './components/BillingPanel';
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
  /** null when the signed-in user has no enterprise organisation — the normal
      case for someone who just signed up with Google. NOT an error state. */
  org: OrgMe | null;
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

// clearToken is intentionally NOT a parameter here: this helper must never
// end the session on its own. See the note in the 401 branch below.
function useApiFetch(token: string) {
  return useCallback(
    async (path: string, opts: RequestInit = {}): Promise<Response> => {
      const res = await fetch(`${API_BASE_URL}${path}`, {
        ...opts,
        // Send the parent-domain session cookie. This is now the primary
        // credential: the cookie is minted by python-api on every auth flow
        // (Google OAuth, Telegram, passkey) and scoped to .suwappu.bot, so it
        // reaches api-ts as a same-site request and never has to be held in JS.
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          // Only sent when a token was pasted manually — the legacy fallback.
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(opts.headers ?? {}),
        },
      });
      // Deliberately does NOT sign the user out on 401.
      //
      // It used to. That meant a 401 from ANY endpoint ended the session — and
      // the organisation sub-routes (/orgs/me/members, /api-keys, /usage) 401
      // for a user who has no organisation, which is the normal state for a
      // fresh Google sign-up. So the dashboard signed people out milliseconds
      // after they signed in, and the login screen reappeared with no
      // explanation. Only the session probe in layout.tsx decides whether the
      // session is actually dead; a feature endpoint refusing one request is
      // not evidence of that.
      return res;
    },
    [token]
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
  const apiFetch              = useApiFetch(token);

  const [data, setData]         = useState<DashboardData | null>(null);
  const [loading, setLoading]   = useState(true);
  const [fetchErr, setFetchErr] = useState<string | null>(null);
  const [showNewKey, setShowNewKey] = useState(false);

  // Period for usage chart (7D | 30D)
  // Tabs, not one long scroll. The page previously stacked seven equal cards
  // — KPIs, chart, endpoints, team, keys, billing — so the thing a paying
  // customer actually came for sat at the very bottom, below analytics they
  // did not ask for. These three groups map to the three jobs people come
  // here to do: monitor, administer, pay.
  const [tab, setTab] = useState<'overview' | 'team' | 'billing'>('overview');
  // Snapped to Billing below when the account has no organisation.

  const [period, setPeriod] = useState<'7d' | '30d'>('7d');
  const [periodUsage, setPeriodUsage] = useState<UsageData | null>(null);
  const [periodLoading, setPeriodLoading] = useState(false);

  // ── Initial load ──────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    async function load() {
      try {
        // Resolve the org FIRST. The sub-routes are meaningless without one,
        // and firing them regardless produced a burst of 401s in the console
        // for every user who has no organisation.
        const orgRes = await apiFetch('/enterprise/orgs/me');
        if (cancelled) return;

        const orgOk = orgRes.ok;
        const [membersRes, keysRes, usageRes] = orgOk
          ? await Promise.all([
              apiFetch('/enterprise/orgs/me/members'),
              apiFetch('/enterprise/orgs/me/api-keys'),
              apiFetch('/enterprise/orgs/me/usage?period=7d'),
            ])
          : [null, null, null];
        if (cancelled) return;

        // 401 = the session is genuinely invalid; bounce to sign-in.
        if (orgRes.status === 401) {
          clearToken();
          return;
        }

        // Anything else non-OK (402 tier gate, 403, 404) means the user simply
        // has no enterprise organisation — which is the NORMAL state for a
        // fresh Google sign-up. Previously this fell through to a fabricated
        // org called "Your Org" on tier "Enterprise", or bailed out entirely
        // and left `data` null so the render threw and the page went blank.
        // Neither is acceptable: a paying-or-not user must still reach their
        // plan and billing.
        const org: OrgMe | null = orgRes.ok ? await orgRes.json() : null;

        const membersPayload = membersRes?.ok ? await membersRes.json() : [];
        const members: Member[] = Array.isArray(membersPayload)
          ? membersPayload
          : (membersPayload?.members ?? []);

        const keysPayload = keysRes?.ok ? await keysRes.json() : [];
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

        const usagePayload = usageRes?.ok ? await usageRes.json() : {};
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
    await apiFetch(`/enterprise/orgs/${data.org?.id}/api-keys/${keyId}`, { method: 'DELETE' });
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
    await apiFetch(`/enterprise/orgs/${data.org?.id}/members/${userId}`, { method: 'DELETE' });
    setData((prev) =>
      prev ? { ...prev, members: prev.members.filter((m) => m.userId !== userId) } : prev
    );
  }

  // ── Render guards ─────────────────────────────────────────────────────────
  if (loading) {
    // Skeleton that matches the real layout, not a centred spinner. A spinner
    // says "something is happening somewhere"; a skeleton says "the two
    // headline figures and a panel are arriving here", so the page does not
    // visibly reflow when data lands.
    return (
      <div aria-busy="true" aria-live="polite">
        <span className={styles.srOnly}>Loading your dashboard</span>
        <div className={styles.skelTabs} aria-hidden="true">
          <span /><span /><span />
        </div>
        <div className={styles.kpiPrimary} aria-hidden="true">
          <div className={`${styles.kpiHero} ${styles.skel}`}>
            <div className={styles.skelLine} style={{ width: '38%' }} />
            <div className={styles.skelLine} style={{ width: '62%', height: 34 }} />
            <div className={styles.skelLine} style={{ width: '30%' }} />
          </div>
          <div className={`${styles.kpiHero} ${styles.skel}`}>
            <div className={styles.skelLine} style={{ width: '30%' }} />
            <div className={styles.skelLine} style={{ width: '46%', height: 34 }} />
            <div className={styles.skelLine} style={{ width: '52%' }} />
          </div>
        </div>
        <div className={`${styles.card} ${styles.skel}`} aria-hidden="true">
          <div className={styles.skelLine} style={{ width: '22%' }} />
          <div className={styles.skelLine} style={{ width: '100%' }} />
          <div className={styles.skelLine} style={{ width: '84%' }} />
          <div className={styles.skelLine} style={{ width: '91%' }} />
        </div>
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
  // Team and API keys are ORGANISATION features. Without an org those tabs
  // lead to empty tables, so they are hidden rather than shown broken.
  const hasOrg = org !== null;
  // Without an org the only meaningful tab is Billing, so never leave the user
  // staring at an Overview built entirely from organisation usage data.
  const activeTab = hasOrg ? tab : 'billing';
  const activeUsage = periodUsage ?? usage;
  const canManage   = callerRole === 'owner' || callerRole === 'admin';
  const activeKeys  = apiKeys.filter((k) => !k.revokedAt);

  // Billing helpers
  const totalCalls   = usage.callsThisMonth;
  const seatUsed     = members.length;
  const seatLimit    = org?.subscription?.seatLimit ?? null;
  const rateLimit    = org?.subscription?.rateLimitPerMin ?? 1000;
  const subStatus    = org?.subscription?.status ?? 'active';
  const usagePct     = Math.min((totalCalls / ENTERPRISE_SOFT_WARN) * 100, 100);

  // Top endpoints total (for percentage bars)
  const endpointTotal = usage.topEndpoints.reduce((s, e) => s + e.count, 0) || 1;

  return (
    <>
      {/* ── Header bar ── */}
      <header className={styles.header}>
        <h1 className={styles.orgName}>{org?.name ?? 'Your account'}</h1>
        {/* The real tier. This was hardcoded to "Enterprise", so every
            customer saw a plan they might not be on — on a billing page. */}
        <span className={styles.tierBadge}>{(org?.tier ?? 'free').toUpperCase()}</span>
        <div className={styles.headerSep} />
        <div className={styles.userInfo}>
          <span className={styles.userName}>{members[0]?.name ?? 'You'}</span>
          <span className={`${styles.roleBadge} ${ROLE_CLASS[callerRole] ?? styles['roleBadge--member']}`}>
            {ROLE_LABELS[callerRole] ?? callerRole}
          </span>
        </div>
        <button className={styles.signOutBtn} onClick={clearToken}>Sign out</button>
      </header>

      {/* ── Tab nav ── */}
      <nav className={styles.tabs} aria-label="Dashboard sections">
        {(hasOrg
          ? ([
              ['overview', 'Overview'],
              ['team', 'Team & API keys'],
              ['billing', 'Billing'],
            ] as const)
          : ([['billing', 'Billing']] as const)
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={styles.tab}
            data-active={activeTab === id || undefined}
            aria-current={activeTab === id ? 'page' : undefined}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      {activeTab === 'overview' && (<>
      {/* ── KPI hierarchy ──
          Was six identical tiles in a six-column grid, which gave calls,
          errors, latency, team size and key count all the same weight — so
          nothing read as important. Two problems fixed:

          1. Hierarchy. The two numbers that change behaviour lead at full
             size: spend-driving volume, and the error rate that decides
             whether the integration is trusted. Latency and today's calls
             are supporting context, so they are compact.
          2. Team size and key count are gone from here entirely. They are
             not performance indicators, and they now have their own tab one
             click away — duplicating them as tiles diluted the strip.

          Status dots appear ONLY where they encode a signal. Four of the six
          tiles previously carried a static #8eb6c5 dot that looked identical
          to the live health colour used for errors and latency, so a
          decoration read as a status light. */}
      <div className={styles.kpiPrimary}>
        <div className={styles.kpiHero}>
          <p className={styles.kpiLabel}>API calls this month</p>
          <span className={styles.kpiHeroValue}>{fmtNumber(usage.callsThisMonth)}</span>
          <span className={styles.kpiHeroMeta}>
            {fmtNumber(usage.callsToday)} today
          </span>
        </div>

        <div className={styles.kpiHero}>
          <p className={styles.kpiLabel}>
            Error rate
            <span
              className={styles.kpiDotInline}
              style={SIGNAL_DOT[errorRateColor(usage.errorRate)]}
              aria-label={`Status: ${errorRateColor(usage.errorRate)}`}
            />
          </p>
          <span className={styles.kpiHeroValue}>{usage.errorRate.toFixed(2)}%</span>
          <span className={styles.kpiHeroMeta}>
            {usage.rateLimitHits > 0
              ? `${fmtNumber(usage.rateLimitHits)} rate-limit hits`
              : 'No rate-limit hits'}
          </span>
        </div>
      </div>

      <div className={styles.kpiSecondary}>
        <div className={styles.kpiCompact}>
          <span className={styles.kpiCompactLabel}>
            Avg response
            <span
              className={styles.kpiDotInline}
              style={SIGNAL_DOT[latencyColor(usage.avgDurationMs)]}
              aria-label={`Status: ${latencyColor(usage.avgDurationMs)}`}
            />
          </span>
          <span className={styles.kpiCompactValue}>{fmtMs(usage.avgDurationMs)}</span>
        </div>

        <div className={styles.kpiCompact}>
          <span className={styles.kpiCompactLabel}>Plan</span>
          <span className={styles.kpiCompactValue}>{(org?.tier ?? 'free').toUpperCase()}</span>
        </div>

        <div className={styles.kpiCompact}>
          <span className={styles.kpiCompactLabel}>Rate limit</span>
          <span className={styles.kpiCompactValue}>
            {rateLimit.toLocaleString()}<span className={styles.kpiUnit}> req/min</span>
          </span>
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

      </>)}

      {activeTab === 'team' && (<>
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

      </>)}

      {/* No organisation: say so plainly. Silently showing only a Billing tab
          reads as a broken page — the user cannot tell whether features are
          missing, still loading, or failed. */}
      {!hasOrg && (
        <section className={styles.card} aria-label="Account">
          <div className={styles.cardHead}>
            <h2 className={styles.cardTitle}>Your account</h2>
          </div>
          <p className={styles.billingMeta} style={{ margin: 0, lineHeight: 1.6 }}>
            Team management, API keys and usage analytics are organisation
            features &mdash; they appear here once your account belongs to one.
            Your plan, credits and payments are below.
          </p>
        </section>
      )}

      {activeTab === 'billing' && (<>
      {/* ── Billing ──
          Previously TWO stacked billing sections: this card and BillingPanel
          directly below it, each showing the plan and each with its own
          competing call to action. Now one. The plan limits that lived here
          (rate limit, seat usage) move into the panel, where they sit next to
          the plan they belong to. */}
      <BillingPanel
        apiFetch={apiFetch}
        fallbackTier={org?.tier}
        renewsAt={org?.subscription?.renewsAt}
        rateLimitPerMin={rateLimit}
        seatsUsed={seatUsed}
        seatLimit={seatLimit}
      />

      </>)}

      {/* ── New key modal ── */}
      {showNewKey && (
        <NewKeyModal
          orgId={org?.id ?? ''}
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
