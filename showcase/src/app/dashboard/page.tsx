'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { API_BASE_URL } from '@/lib/links';
import { useDashboardAuth } from './auth-context';
import UsageChart from './components/UsageChart';
import styles from './dashboard.module.css';

// ── Types ────────────────────────────────────────────────────────────────────

interface OrgMe {
  id: string;
  name: string;
  tier: string;
  subscription?: {
    renewsAt?: string;
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
}

interface UsageData {
  callsToday: number;
  callsThisMonth: number;
  daily?: { label: string; value: number }[];
}

interface DashboardData {
  org: OrgMe;
  members: Member[];
  apiKeys: ApiKey[];
  usage: UsageData;
  /** Role of the authenticated caller in this org */
  callerRole: 'owner' | 'admin' | 'member' | 'viewer';
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso?: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '—';
  }
}

function fmtNumber(n: number): string {
  return n.toLocaleString();
}

const ROLE_LABELS: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  viewer: 'Viewer',
};

const ROLE_CLASS: Record<string, string> = {
  owner: styles['roleBadge--owner'],
  admin: styles['roleBadge--admin'],
  member: styles['roleBadge--member'],
  viewer: styles['roleBadge--viewer'],
};

const ALL_SCOPES = ['swap', 'read', 'orders', 'portfolio', 'alerts', 'admin'];

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
      if (res.status === 401) {
        clearToken();
        router.replace('/dashboard');
      }
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
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>(['read', 'swap']);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function toggleScope(s: string) {
    setScopes((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    );
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
                <input
                  type="checkbox"
                  checked={scopes.includes(s)}
                  onChange={() => toggleScope(s)}
                />
                {s}
              </label>
            ))}
          </div>
        </div>

        {err && <p className={styles.loginError} role="alert">{err}</p>}

        <div className={styles.modalActions}>
          <button className={styles.actionBtn} onClick={onClose} disabled={busy}>
            Cancel
          </button>
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

// ── Main page ────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { token, clearToken } = useDashboardAuth();
  const apiFetch = useApiFetch(token, clearToken);

  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchErr, setFetchErr] = useState<string | null>(null);
  const [showNewKey, setShowNewKey] = useState(false);

  // Load all dashboard data in parallel
  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    async function load() {
      try {
        const [orgRes, membersRes, keysRes, usageRes] = await Promise.all([
          apiFetch('/enterprise/orgs/me'),
          apiFetch('/enterprise/orgs/me/members'),
          apiFetch('/enterprise/orgs/me/api-keys'),
          apiFetch('/enterprise/orgs/me/usage'),
        ]);

        if (cancelled) return;

        // If any returned 401, the apiFetch helper already redirected
        if (orgRes.status === 401) return;

        const org: OrgMe = orgRes.ok ? await orgRes.json() : { id: 'unknown', name: 'Your Org', tier: 'Enterprise' };
        const membersPayload = membersRes.ok ? await membersRes.json() : [];
        const members: Member[] = Array.isArray(membersPayload) ? membersPayload : (membersPayload?.members ?? []);
        const keysPayload = keysRes.ok ? await keysRes.json() : [];
        const apiKeys: ApiKey[] = Array.isArray(keysPayload) ? keysPayload : (keysPayload?.keys ?? []);
        const usagePayload = usageRes.ok ? await usageRes.json() : {};
        const usage: UsageData = {
          callsToday: usagePayload?.callsToday ?? 0,
          callsThisMonth: usagePayload?.callsThisMonth ?? 0,
          daily: usagePayload?.daily,
        };

        // Determine caller role from members list (fall back to member)
        const callerRole: DashboardData['callerRole'] =
          (members[0]?.role as DashboardData['callerRole']) ?? 'member';

        setData({ org, members, apiKeys, usage, callerRole });
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

  // Revoke an API key
  async function revokeKey(keyId: string) {
    if (!data) return;
    await apiFetch(`/enterprise/orgs/${data.org.id}/api-keys/${keyId}`, { method: 'DELETE' });
    setData((prev) =>
      prev
        ? {
            ...prev,
            apiKeys: prev.apiKeys.map((k) =>
              k.id === keyId ? { ...k, revokedAt: new Date().toISOString() } : k
            ),
          }
        : prev
    );
  }

  // Remove a member
  async function removeMember(userId: string) {
    if (!data) return;
    await apiFetch(`/enterprise/orgs/${data.org.id}/members/${userId}`, { method: 'DELETE' });
    setData((prev) =>
      prev ? { ...prev, members: prev.members.filter((m) => m.userId !== userId) } : prev
    );
  }

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
        <button
          className={styles.actionBtn}
          onClick={() => window.location.reload()}
        >
          Retry
        </button>
      </div>
    );
  }

  const { org, members, apiKeys, usage, callerRole } = data;
  const canManage = callerRole === 'owner' || callerRole === 'admin';
  const activeKeys = apiKeys.filter((k) => !k.revokedAt);

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

        <button className={styles.signOutBtn} onClick={clearToken}>
          Sign out
        </button>
      </header>

      {/* ── KPI strip ── */}
      <div className={styles.kpiRow} aria-label="Key performance indicators">
        <div className={styles.kpiCard}>
          <p className={styles.kpiLabel}>API Calls Today</p>
          <span className={styles.kpiValue}>{fmtNumber(usage.callsToday)}</span>
        </div>
        <div className={styles.kpiCard}>
          <p className={styles.kpiLabel}>API Calls This Month</p>
          <span className={styles.kpiValue}>{fmtNumber(usage.callsThisMonth)}</span>
        </div>
        <div className={styles.kpiCard}>
          <p className={styles.kpiLabel}>Team Members</p>
          <span className={styles.kpiValue}>{fmtNumber(members.length)}</span>
        </div>
        <div className={styles.kpiCard}>
          <p className={styles.kpiLabel}>Active API Keys</p>
          <span className={styles.kpiValue}>{fmtNumber(activeKeys.length)}</span>
        </div>
      </div>

      {/* ── Usage chart ── */}
      <section className={styles.card} aria-label="API usage chart">
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>API Usage</h2>
          <p className="summer-kicker" style={{ margin: 0 }}>Last 7 days</p>
        </div>
        <div className={styles.chartWrap}>
          <UsageChart
            callsToday={usage.callsToday}
            callsThisMonth={usage.callsThisMonth}
            daily={usage.daily}
          />
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
                    <span className={styles.mono} style={{ marginLeft: 8 }}>
                      {m.handle}
                    </span>
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
              <th>Last Used</th>
              <th>Expires</th>
              {canManage && <th aria-label="Actions" />}
            </tr>
          </thead>
          <tbody>
            {apiKeys.length === 0 && (
              <tr>
                <td colSpan={canManage ? 6 : 5} style={{ color: 'var(--summer-muted)', fontStyle: 'italic' }}>
                  No API keys yet.
                </td>
              </tr>
            )}
            {apiKeys.map((k) => (
              <tr key={k.id} style={{ opacity: k.revokedAt ? 0.45 : 1 }}>
                <td style={{ fontWeight: 600 }}>
                  {k.name}
                  {k.revokedAt && (
                    <span
                      className={styles.roleBadge}
                      style={{ marginLeft: 8, background: 'rgba(212,72,63,0.1)', borderColor: 'rgba(212,72,63,0.3)', color: '#c0392b' }}
                    >
                      Revoked
                    </span>
                  )}
                </td>
                <td className={styles.mono}>{k.prefix}…</td>
                <td>
                  <div className={styles.pills}>
                    {k.scopes.map((s) => (
                      <span key={s} className={styles.pill}>{s}</span>
                    ))}
                  </div>
                </td>
                <td className={styles.mono}>{fmtDate(k.lastUsedAt)}</td>
                <td className={styles.mono}>{fmtDate(k.expiresAt)}</td>
                {canManage && (
                  <td>
                    {!k.revokedAt && (
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
            ))}
          </tbody>
        </table>
      </section>

      {/* ── Billing ── */}
      <section className={styles.card} aria-label="Billing">
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>Billing</h2>
        </div>
        <div className={styles.billingRow}>
          <div className={styles.billingPlan}>
            <span className={styles.tierBadge}>Enterprise</span>
            <span className={styles.billingPlanName}>{org.tier ?? 'Enterprise'} Plan</span>
          </div>
          {org.subscription?.renewsAt && (
            <span className={styles.billingMeta}>
              Renews {fmtDate(org.subscription.renewsAt)}
            </span>
          )}
          <div className={styles.billingLink}>
            <Link
              href="/pricing"
              className={`${styles.actionBtn} ${styles['actionBtn--create']}`}
              style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none', minHeight: 34, padding: '0 14px', borderRadius: 8, border: '1px solid rgba(207,227,234,0.9)' }}
            >
              Manage Billing
            </Link>
          </div>
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
