'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  ListChecks, ShieldWarning, ShieldCheck, ShieldSlash, Scroll, Key,
  CheckCircle, XCircle, ArrowRight, CircleNotch,
} from '@phosphor-icons/react';
import { API_BASE_URL } from '@/lib/links';
import { type AuthState, useDashboardAuth } from '../auth-context';
import dStyles from '../dashboard.module.css';
import styles from './security.module.css';

// ── Types ────────────────────────────────────────────────────────────────────
// Every shape here mirrors the route file it comes from — see the comment
// above each panel's load() for the exact endpoint.

interface OrgMe {
  id: string;
  name: string;
  tier: string;
}

type Role = 'owner' | 'admin' | 'member' | 'viewer';

interface MeResponse {
  org: OrgMe;
  role: Role;
}

// GET /enterprise/orgs/:orgId/approval-requests (enterprisePolicies.ts) —
// raw policyApprovalRequests rows, unshaped.
interface ApprovalRequestRow {
  id: string;
  requestType: string;
  payload: Record<string, unknown>;
  status: string;
  requiredApprovals: number;
  requestedBy: number | string | null;
  createdAt: string;
  expiresAt: string | null;
}

// GET /enterprise/orgs/:orgId/compliance/events (enterpriseCompliance.ts)
interface ScreeningEventRow {
  id: number | string;
  timestamp: string;
  chain: string | null;
  direction: string | null;
  address: string | null;
  decision: string | null;
  reason: string | null;
}

interface ComplianceSummary {
  byDecision: { decision: string | null; count: number }[];
}

// GET /enterprise/orgs/:orgId/audit (enterpriseAudit.ts)
interface AuditRow {
  id: number | string;
  timestamp: string;
  userId: number | string | null;
  eventType: string;
  details: unknown;
}

interface VerifyResult {
  valid: boolean;
  checkedCount: number;
  firstBrokenAt: number | string | null;
}

type ChainStatus = 'checking' | 'valid' | 'broken' | 'error';

// GET /enterprise/orgs/me/api-keys (routes/enterprise.ts) — same route the
// Overview page (../page.tsx) fetches, addressed via the 'me' alias.
interface ApiKeyRow {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  expiresAt?: string | null;
  revokedAt?: string | null;
  lastUsedAt?: string | null;
}

// GET /enterprise/orgs/me/members (routes/enterprise.ts)
interface MemberRow {
  id: string;
  userId: string | number;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  joinedAt: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtTimestamp(ts: string | null | undefined): string {
  if (!ts) return '-';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function shortId(id: string | number | null | undefined, head = 6, tail = 4): string {
  if (id === null || id === undefined) return '-';
  const s = String(id);
  return s.length > head + tail + 1 ? `${s.slice(0, head)}…${s.slice(-tail)}` : s;
}

// Same pattern as summarizeDetails() in ../audit/page.tsx and
// summarizePayload() in ../policies/page.tsx — no pre-baked summary field
// from the API, so this reads the same JSON those pages show in full.
function summarizeJson(v: unknown, maxKeys = 3): string {
  if (v === null || v === undefined) return '-';
  if (typeof v !== 'object') return String(v);
  const entries = Object.entries(v as Record<string, unknown>);
  if (entries.length === 0) return '-';
  const fmt = (x: unknown) => (x === null || x === undefined ? '-' : typeof x === 'object' ? JSON.stringify(x) : String(x));
  const shown = entries.slice(0, maxKeys).map(([k, val]) => `${k}: ${fmt(val)}`).join(', ');
  return entries.length > maxKeys ? `${shown}, …` : shown;
}

// keyStatus derivation — same logic as ../page.tsx's keyStatus(), duplicated
// here rather than shared since every dashboard page keeps its own small
// helpers (see audit/compliance/policies pages).
type KeyStatus = 'active' | 'expiring' | 'expired' | 'revoked';

function keyStatus(k: ApiKeyRow): KeyStatus {
  if (k.revokedAt) return 'revoked';
  if (!k.expiresAt) return 'active';
  const days = Math.floor((new Date(k.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (days < 0) return 'expired';
  if (days <= 7) return 'expiring';
  return 'active';
}

const KEY_STATUS_LABEL: Record<KeyStatus, string> = {
  active: 'Active', expiring: 'Expiring soon', expired: 'Expired', revoked: 'Revoked',
};

// clearToken deliberately NOT wired into every non-org 401 — see the same
// comment in ../page.tsx / ../compliance/page.tsx. Only the /enterprise/orgs/me
// probe below treats a 401 as a genuinely dead session.
function useApiFetch(auth: AuthState) {
  return useCallback(
    async (path: string, opts: RequestInit = {}): Promise<Response> => {
      return fetch(`${API_BASE_URL}${path}`, {
        ...opts,
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(auth.kind === 'token' ? { Authorization: `Bearer ${auth.value}` } : {}),
          ...(opts.headers ?? {}),
        },
      });
    },
    [auth]
  );
}

type ApiFetch = ReturnType<typeof useApiFetch>;

const REFRESH_MS = 60_000;

// ── Status strip tile ────────────────────────────────────────────────────────

type Tone = 'ok' | 'warn' | 'danger' | 'neutral';

function StatusTile({
  icon, label, value, tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  tone: Tone;
}) {
  return (
    <div className={styles.statusTile}>
      <span className={styles.statusIcon} data-tone={tone === 'neutral' ? undefined : tone}>{icon}</span>
      <div className={styles.statusBody}>
        <span className={styles.statusValue}>{value}</span>
        <span className={styles.statusLabel}>{label}</span>
      </div>
    </div>
  );
}

// ── Shared per-panel state box ──────────────────────────────────────────────

function PanelState({ children, onRetry }: { children: React.ReactNode; onRetry?: () => void }) {
  return (
    <div className={styles.panelState} role="alert">
      <span>{children}</span>
      {onRetry && <button type="button" className={styles.panelRetry} onClick={onRetry}>Retry</button>}
    </div>
  );
}

function PanelHead({
  icon, title, extra, href, linkLabel,
}: {
  icon: React.ReactNode;
  title: string;
  extra?: React.ReactNode;
  href?: string;
  linkLabel?: string;
}) {
  return (
    <div className={styles.panelHead}>
      <div className={styles.panelTitleWrap}>
        <span className={styles.panelIcon}>{icon}</span>
        <h2 className={dStyles.cardTitle}>{title}</h2>
        {extra}
      </div>
      {href && (
        <Link href={href} className={styles.panelLink}>
          {linkLabel ?? 'Review'} <ArrowRight size={13} weight="bold" />
        </Link>
      )}
    </div>
  );
}

// =============================================================================
// 1. Pending Approvals — GET /enterprise/orgs/:orgId/approval-requests?status=pending
// =============================================================================

function PendingApprovalsPanel({
  orgId, apiFetch, refreshKey, onCount,
}: {
  orgId: string;
  apiFetch: ApiFetch;
  refreshKey: number;
  onCount: (n: number | null) => void;
}) {
  const [rows, setRows] = useState<ApprovalRequestRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [voteErr, setVoteErr] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await apiFetch(`/enterprise/orgs/${orgId}/approval-requests?status=pending&limit=5`);
      if (res.status === 403) { setErr('Requires admin access.'); onCount(null); return; }
      if (!res.ok) { setErr('Could not load pending approvals.'); onCount(null); return; }
      const body = await res.json();
      const list: ApprovalRequestRow[] = Array.isArray(body?.requests) ? body.requests : [];
      setRows(list);
      const t = Number(body?.total ?? list.length);
      setTotal(t);
      onCount(t);
    } catch (e) {
      setErr('Could not load pending approvals. Check your connection.');
      onCount(null);
      console.error(e);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiFetch, orgId]);

  useEffect(() => { load(); }, [load, refreshKey]);

  async function vote(id: string, decision: 'approve' | 'reject') {
    setBusyId(id);
    setVoteErr((v) => ({ ...v, [id]: '' }));
    try {
      const res = await apiFetch(`/enterprise/orgs/${orgId}/approval-requests/${id}/vote`, {
        method: 'POST',
        body: JSON.stringify({ decision }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        const msg = typeof body?.error === 'string' ? body.error : 'Could not record your vote.';
        setVoteErr((v) => ({ ...v, [id]: msg }));
        return;
      }
      await load();
    } catch (e) {
      setVoteErr((v) => ({ ...v, [id]: 'Network error. Check your connection.' }));
      console.error(e);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className={dStyles.card} aria-label="Pending approvals">
      <PanelHead
        icon={<ListChecks size={17} weight="bold" />}
        title="Pending Approvals"
        href="/dashboard/policies"
        linkLabel="Review"
      />
      {loading ? (
        <div className={dStyles.skel} aria-hidden="true">
          <div className={dStyles.skelLine} style={{ width: '60%' }} />
          <div className={dStyles.skelLine} style={{ width: '100%' }} />
        </div>
      ) : err ? (
        <PanelState onRetry={load}>{err}</PanelState>
      ) : rows.length === 0 ? (
        <PanelState>No pending approval requests.</PanelState>
      ) : (
        <div className={styles.rowList}>
          {rows.map((r) => (
            <div key={r.id} className={styles.incidentRow}>
              <div className={styles.incidentMain}>
                <div className={styles.incidentTitleRow}>
                  <span className={styles.pillSm} data-tone="pending">{r.requestType.replace(/_/g, ' ')}</span>
                  <span className={dStyles.mono} style={{ fontSize: '0.72rem' }}>
                    {r.requiredApprovals} approval{r.requiredApprovals === 1 ? '' : 's'} required
                  </span>
                </div>
                <span className={styles.incidentSummary} title={summarizeJson(r.payload)}>
                  {summarizeJson(r.payload)}
                </span>
                <span className={styles.incidentMeta}>
                  Requested {fmtTimestamp(r.createdAt)} · <span className={dStyles.mono}>{shortId(r.requestedBy)}</span>
                </span>
                {voteErr[r.id] && <p className={styles.voteErrSm} role="alert">{voteErr[r.id]}</p>}
              </div>
              <div className={styles.voteBtns}>
                <button
                  type="button"
                  className={styles.voteBtnSm}
                  data-decision="approve"
                  disabled={busyId === r.id}
                  onClick={() => vote(r.id, 'approve')}
                  aria-label="Approve"
                >
                  <CheckCircle size={13} weight="bold" /> Approve
                </button>
                <button
                  type="button"
                  className={styles.voteBtnSm}
                  data-decision="reject"
                  disabled={busyId === r.id}
                  onClick={() => vote(r.id, 'reject')}
                  aria-label="Reject"
                >
                  <XCircle size={13} weight="bold" /> Reject
                </button>
              </div>
            </div>
          ))}
          {total > rows.length && (
            <span className={styles.incidentMeta}>Showing {rows.length} of {total} pending. See Policies for the full queue.</span>
          )}
        </div>
      )}
    </section>
  );
}

// =============================================================================
// 2. Blocked & Flagged Screening — compliance/events (+ summary, last 7d)
// =============================================================================

function ScreeningPanel({
  orgId, apiFetch, refreshKey, onCount,
}: {
  orgId: string;
  apiFetch: ApiFetch;
  refreshKey: number;
  onCount: (n: number | null) => void;
}) {
  const [rows, setRows] = useState<(ScreeningEventRow & { decision: string })[]>([]);
  const [blockedCount, setBlockedCount] = useState(0);
  const [flaggedCount, setFlaggedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const [summaryRes, blockedRes, flaggedRes] = await Promise.all([
        apiFetch(`/enterprise/orgs/${orgId}/compliance/summary?days=7`),
        apiFetch(`/enterprise/orgs/${orgId}/compliance/events?decision=blocked&limit=10&from=${since}`),
        apiFetch(`/enterprise/orgs/${orgId}/compliance/events?decision=flagged&limit=10&from=${since}`),
      ]);
      if (summaryRes.status === 403 || blockedRes.status === 403 || flaggedRes.status === 403) {
        setErr('Requires admin access.');
        onCount(null);
        return;
      }
      if (!summaryRes.ok || !blockedRes.ok || !flaggedRes.ok) {
        setErr('Could not load screening data.');
        onCount(null);
        return;
      }
      const summary: ComplianceSummary = await summaryRes.json();
      const countFor = (d: string) =>
        (summary.byDecision ?? []).find((row) => (row.decision || '').toLowerCase() === d)?.count ?? 0;
      const blocked = countFor('blocked');
      const flagged = countFor('flagged');
      setBlockedCount(blocked);
      setFlaggedCount(flagged);
      onCount(blocked);

      const blockedBody = await blockedRes.json();
      const flaggedBody = await flaggedRes.json();
      const blockedRows: ScreeningEventRow[] = Array.isArray(blockedBody?.events) ? blockedBody.events : [];
      const flaggedRows: ScreeningEventRow[] = Array.isArray(flaggedBody?.events) ? flaggedBody.events : [];
      const merged = [...blockedRows.map((r) => ({ ...r, decision: 'blocked' })), ...flaggedRows.map((r) => ({ ...r, decision: 'flagged' }))]
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 6);
      setRows(merged);
    } catch (e) {
      setErr('Could not load screening data. Check your connection.');
      onCount(null);
      console.error(e);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiFetch, orgId]);

  useEffect(() => { load(); }, [load, refreshKey]);

  return (
    <section className={dStyles.card} aria-label="Blocked and flagged screening">
      <PanelHead
        icon={<ShieldWarning size={17} weight="bold" />}
        title="Blocked & Flagged Screening"
        href="/dashboard/compliance"
        linkLabel="Review"
      />
      {loading ? (
        <div className={dStyles.skel} aria-hidden="true">
          <div className={dStyles.skelLine} style={{ width: '55%' }} />
          <div className={dStyles.skelLine} style={{ width: '100%' }} />
        </div>
      ) : err ? (
        <PanelState onRetry={load}>{err}</PanelState>
      ) : (
        <>
          <div className={styles.incidentTitleRow} style={{ marginBottom: 12 }}>
            <span className={styles.pillSm} data-tone="blocked">{blockedCount} blocked</span>
            <span className={styles.pillSm} data-tone="flagged">{flaggedCount} flagged</span>
            <span className={styles.incidentMeta}>last 7 days</span>
          </div>
          {rows.length === 0 ? (
            <PanelState>No blocked or flagged screening events in the last 7 days.</PanelState>
          ) : (
            <div className={styles.rowList}>
              {rows.map((r) => (
                <div key={`${r.decision}-${r.id}`} className={styles.incidentRow}>
                  <div className={styles.incidentMain}>
                    <div className={styles.incidentTitleRow}>
                      <span className={styles.pillSm} data-tone={r.decision}>{r.decision}</span>
                      <span className={dStyles.mono} style={{ fontSize: '0.78rem' }}>{r.chain || '-'}</span>
                      <span className={styles.incidentMeta} style={{ textTransform: 'capitalize' }}>{r.direction || '-'}</span>
                    </div>
                    <span className={styles.incidentSummary}>
                      {r.address ? shortId(r.address, 8, 6) : '-'} · {r.reason || 'unspecified'}
                    </span>
                    <span className={styles.incidentMeta}>{fmtTimestamp(r.timestamp)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

// =============================================================================
// 3. Recent Admin Activity — GET /enterprise/orgs/:orgId/audit + /audit/verify
// =============================================================================

function ChainMiniBadge({ status, result }: { status: ChainStatus; result: VerifyResult | null }) {
  let icon: React.ReactNode;
  let label: string;
  if (status === 'checking') { icon = <CircleNotch size={12} weight="bold" />; label = 'Verifying…'; }
  else if (status === 'valid') { icon = <ShieldCheck size={12} weight="fill" />; label = `Chain verified`; }
  else if (status === 'broken') { icon = <ShieldWarning size={12} weight="fill" />; label = `Broken at ${result?.firstBrokenAt ?? '?'}`; }
  else { icon = <ShieldSlash size={12} weight="fill" />; label = 'Could not verify'; }
  return (
    <span className={styles.chainBadge} data-status={status} role="status" aria-live="polite">
      <span className={styles.chainBadgeIcon} data-spin={status === 'checking' || undefined}>{icon}</span>
      {label}
    </span>
  );
}

function AuditActivityPanel({
  orgId, apiFetch, refreshKey, onChainStatus,
}: {
  orgId: string;
  apiFetch: ApiFetch;
  refreshKey: number;
  onChainStatus: (s: ChainStatus) => void;
}) {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [chainStatus, setChainStatus] = useState<ChainStatus>('checking');
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    setChainStatus('checking');
    onChainStatus('checking');
    try {
      const [auditRes, verifyRes] = await Promise.all([
        apiFetch(`/enterprise/orgs/${orgId}/audit?limit=15`),
        apiFetch(`/enterprise/orgs/${orgId}/audit/verify?limit=1000`),
      ]);
      if (auditRes.status === 403 || verifyRes.status === 403) {
        setErr('Requires admin access.');
        setChainStatus('error');
        onChainStatus('error');
        return;
      }
      if (!auditRes.ok) {
        setErr('Could not load recent activity.');
      } else {
        const body = await auditRes.json();
        setRows(Array.isArray(body?.events) ? body.events : []);
      }
      if (verifyRes.ok) {
        const v: VerifyResult = await verifyRes.json();
        setVerifyResult(v);
        const s: ChainStatus = v.valid ? 'valid' : 'broken';
        setChainStatus(s);
        onChainStatus(s);
      } else {
        setChainStatus('error');
        onChainStatus('error');
      }
    } catch (e) {
      setErr('Could not load recent activity. Check your connection.');
      setChainStatus('error');
      onChainStatus('error');
      console.error(e);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiFetch, orgId]);

  useEffect(() => { load(); }, [load, refreshKey]);

  return (
    <section className={dStyles.card} aria-label="Recent admin activity">
      <PanelHead
        icon={<Scroll size={17} weight="bold" />}
        title="Recent Admin Activity"
        extra={!loading && <ChainMiniBadge status={chainStatus} result={verifyResult} />}
        href="/dashboard/audit"
        linkLabel="Review"
      />
      {loading ? (
        <div className={dStyles.skel} aria-hidden="true">
          <div className={dStyles.skelLine} style={{ width: '50%' }} />
          <div className={dStyles.skelLine} style={{ width: '100%' }} />
        </div>
      ) : err && rows.length === 0 ? (
        <PanelState onRetry={load}>{err}</PanelState>
      ) : rows.length === 0 ? (
        <PanelState>No recent admin activity.</PanelState>
      ) : (
        <div className={styles.rowList}>
          {rows.slice(0, 6).map((r) => (
            <div key={r.id} className={styles.incidentRow}>
              <div className={styles.incidentMain}>
                <div className={styles.incidentTitleRow}>
                  <span className={styles.pillSm} data-tone="neutral">{r.eventType || 'unknown'}</span>
                  <span className={dStyles.mono} style={{ fontSize: '0.72rem' }}>{shortId(r.userId)}</span>
                </div>
                <span className={styles.incidentSummary} title={summarizeJson(r.details)}>{summarizeJson(r.details)}</span>
                <span className={styles.incidentMeta}>{fmtTimestamp(r.timestamp)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// =============================================================================
// 4. API Keys & Access — GET /enterprise/orgs/me/api-keys + /orgs/me/members
// =============================================================================

const ROLE_ORDER: MemberRow['role'][] = ['owner', 'admin', 'member', 'viewer'];
const ROLE_LABEL: Record<MemberRow['role'], string> = {
  owner: 'Owners', admin: 'Admins', member: 'Members', viewer: 'Viewers',
};

function ApiKeysAccessPanel({
  apiFetch, refreshKey, onActiveCount,
}: {
  apiFetch: ApiFetch;
  refreshKey: number;
  onActiveCount: (n: number | null) => void;
}) {
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [keysRes, membersRes] = await Promise.all([
        apiFetch('/enterprise/orgs/me/api-keys'),
        apiFetch('/enterprise/orgs/me/members'),
      ]);
      if (keysRes.status === 403 || membersRes.status === 403) {
        setErr('Requires admin access.');
        onActiveCount(null);
        return;
      }
      if (!keysRes.ok || !membersRes.ok) {
        setErr('Could not load API keys and access.');
        onActiveCount(null);
        return;
      }
      const keysBody = await keysRes.json();
      const keyList: ApiKeyRow[] = Array.isArray(keysBody?.keys) ? keysBody.keys : [];
      keyList.sort((a, b) => {
        if (!a.lastUsedAt && !b.lastUsedAt) return 0;
        if (!a.lastUsedAt) return 1;
        if (!b.lastUsedAt) return -1;
        return new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime();
      });
      setKeys(keyList);
      onActiveCount(keyList.filter((k) => !k.revokedAt).length);

      const membersBody = await membersRes.json();
      setMembers(Array.isArray(membersBody?.members) ? membersBody.members : []);
    } catch (e) {
      setErr('Could not load API keys and access. Check your connection.');
      onActiveCount(null);
      console.error(e);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiFetch]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const roleCounts = ROLE_ORDER.map((role) => ({
    role,
    count: members.filter((m) => m.role === role).length,
  }));

  return (
    <section className={dStyles.card} aria-label="API keys and access">
      <PanelHead
        icon={<Key size={17} weight="bold" />}
        title="API Keys & Access"
        href="/dashboard"
        linkLabel="Manage"
      />
      {loading ? (
        <div className={dStyles.skel} aria-hidden="true">
          <div className={dStyles.skelLine} style={{ width: '55%' }} />
          <div className={dStyles.skelLine} style={{ width: '100%' }} />
        </div>
      ) : err ? (
        <PanelState onRetry={load}>{err}</PanelState>
      ) : (
        <>
          {keys.length === 0 ? (
            <PanelState>No API keys yet.</PanelState>
          ) : (
            <div>
              {keys.slice(0, 5).map((k) => {
                const st = keyStatus(k);
                return (
                  <div key={k.id} className={styles.keyRow}>
                    <div className={styles.keyName}>
                      <strong>{k.name}</strong>
                      <span className={dStyles.mono} style={{ fontSize: '0.74rem' }}>{k.keyPrefix}…</span>
                    </div>
                    <span className={`${dStyles.keyStatusBadge} ${dStyles[`keyStatus--${st}`]}`}>
                      {KEY_STATUS_LABEL[st]}
                    </span>
                  </div>
                );
              })}
              {keys.length > 5 && (
                <span className={styles.incidentMeta}>+{keys.length - 5} more. See Overview / Team &amp; API keys.</span>
              )}
            </div>
          )}
          <div className={styles.roleDist}>
            {roleCounts.map(({ role, count }) => (
              <span key={role} className={styles.roleDistItem}>
                {ROLE_LABEL[role]} <strong>{count}</strong>
              </span>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function SecurityPage() {
  const { auth, clearToken } = useDashboardAuth();
  const apiFetch = useApiFetch(auth);

  const [org, setOrg] = useState<OrgMe | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [hasOrg, setHasOrg] = useState(true);
  const [loading, setLoading] = useState(true);
  const [fetchErr, setFetchErr] = useState<string | null>(null);

  // Bumped every 60s (paused while the tab is hidden) — each panel's own
  // load() re-runs off this, so a partial failure in one panel never blocks
  // the others from refreshing.
  const [refreshKey, setRefreshKey] = useState(0);

  // Small pieces of derived state fed up from each panel for the status
  // strip — panels stay independently loading/erroring; a panel that fails
  // just reports null here instead of blanking the strip.
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [blocked7d, setBlocked7d] = useState<number | null>(null);
  const [chainStatus, setChainStatus] = useState<ChainStatus>('checking');
  const [activeKeys, setActiveKeys] = useState<number | null>(null);

  // Resolve the org + caller role once — same {org, role} unwrap of
  // /enterprise/orgs/me as ../compliance/page.tsx and ../policies/page.tsx.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await apiFetch('/enterprise/orgs/me');
        if (cancelled) return;
        if (res.status === 401) { clearToken(); return; }
        if (!res.ok) { setHasOrg(false); setLoading(false); return; }
        const data: MeResponse = await res.json();
        if (cancelled) return;
        setOrg(data.org);
        setRole(data.role);
        setHasOrg(true);
      } catch (e) {
        if (!cancelled) {
          setFetchErr('Could not load your workspace. Check your connection.');
          console.error(e);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiFetch]);

  useEffect(() => {
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      setRefreshKey((k) => k + 1);
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  // ── Loading ──
  if (loading) {
    return (
      <div aria-busy="true" aria-live="polite">
        <span className="sr-only">Loading Security Center</span>
        <div className={`${dStyles.card} ${dStyles.skel}`} aria-hidden="true">
          <div className={dStyles.skelLine} style={{ width: '30%' }} />
          <div className={dStyles.skelLine} style={{ width: '100%' }} />
          <div className={dStyles.skelLine} style={{ width: '100%' }} />
          <div className={dStyles.skelLine} style={{ width: '84%' }} />
        </div>
      </div>
    );
  }

  // ── No organisation yet ──
  if (!hasOrg) {
    return (
      <div className={dStyles.stateBox}>
        <span>Create a workspace to see the Security Center.</span>
        <Link href="/dashboard" className={dStyles.actionBtn}>Go to Overview</Link>
      </div>
    );
  }

  // ── Error ──
  if (fetchErr || !org) {
    return (
      <div className={dStyles.stateBox} role="alert">
        <span>{fetchErr ?? 'Could not load your workspace.'}</span>
        <button className={dStyles.actionBtn} onClick={() => window.location.reload()}>Retry</button>
      </div>
    );
  }

  // ── Admin-only page gate ──
  // Every panel below is admin-scoped server-side (approval-requests reads
  // are member-visible but voting is admin+; compliance/audit are admin+ on
  // every route). One page-level gate here matches the task spec rather than
  // rendering four separate 403 states.
  const canManage = role === 'owner' || role === 'admin';
  if (!canManage) {
    return (
      <div className={dStyles.stateBox} role="alert">
        <span>The Security Center requires admin role. Ask an org owner or admin for access.</span>
        <Link href="/dashboard" className={dStyles.actionBtn}>Go to Overview</Link>
      </div>
    );
  }

  const chainTone: Tone = chainStatus === 'valid' ? 'ok' : chainStatus === 'checking' ? 'neutral' : 'danger';
  const chainLabel = chainStatus === 'checking' ? 'Checking…' : chainStatus === 'valid' ? 'Verified' : chainStatus === 'broken' ? 'Broken' : 'Unknown';

  return (
    <>
      <header className={dStyles.header}>
        <h1 className={dStyles.orgName}>{org.name}: Security Center</h1>
        <span className={dStyles.tierBadge}>{org.tier.toUpperCase()}</span>
      </header>

      <div className={styles.statusStrip}>
        <StatusTile
          icon={<ListChecks size={18} weight="bold" />}
          label="Pending approvals"
          value={pendingCount ?? '-'}
          tone={pendingCount === null ? 'neutral' : pendingCount > 0 ? 'warn' : 'ok'}
        />
        <StatusTile
          icon={<ShieldWarning size={18} weight="bold" />}
          label="Blocked (7d)"
          value={blocked7d ?? '-'}
          tone={blocked7d === null ? 'neutral' : blocked7d > 0 ? 'danger' : 'ok'}
        />
        <StatusTile
          icon={chainStatus === 'valid' ? <ShieldCheck size={18} weight="fill" /> : <ShieldSlash size={18} weight="fill" />}
          label="Audit chain"
          value={chainLabel}
          tone={chainTone}
        />
        <StatusTile
          icon={<Key size={18} weight="bold" />}
          label="Active API keys"
          value={activeKeys ?? '-'}
          tone="neutral"
        />
      </div>

      <div className={styles.panelGrid}>
        <PendingApprovalsPanel orgId={org.id} apiFetch={apiFetch} refreshKey={refreshKey} onCount={setPendingCount} />
        <ScreeningPanel orgId={org.id} apiFetch={apiFetch} refreshKey={refreshKey} onCount={setBlocked7d} />
        <AuditActivityPanel orgId={org.id} apiFetch={apiFetch} refreshKey={refreshKey} onChainStatus={setChainStatus} />
        <ApiKeysAccessPanel apiFetch={apiFetch} refreshKey={refreshKey} onActiveCount={setActiveKeys} />
      </div>
    </>
  );
}
