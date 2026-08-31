'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  Copy, Check, CaretLeft, CaretRight, DownloadSimple,
  ShieldCheck, ShieldWarning, CircleNotch, ArrowsClockwise,
} from '@phosphor-icons/react';
import { API_BASE_URL } from '@/lib/links';
import { type AuthState, useDashboardAuth } from '../auth-context';
import dStyles from '../dashboard.module.css';
import styles from './audit.module.css';

// ── Types (mirrors GET /enterprise/orgs/:orgId/audit + /audit/verify) ──────

interface OrgMe {
  id: string;
  name: string;
  tier: string;
}

interface AuditRow {
  id: number | string;
  timestamp: string;
  userId: number | string | null;
  orgId: string;
  agentId: number | string | null;
  eventType: string;
  details: unknown;
  ipAddress: string | null;
  prevHash: string | null;
  entryHash: string | null;
}

interface VerifyResult {
  valid: boolean;
  checkedCount: number;
  firstBrokenAt: number | string | null;
}

type ChainStatus = 'checking' | 'valid' | 'broken' | 'error';

const PAGE_SIZE = 50;

// ── Helpers ──────────────────────────────────────────────────────────────────

function shortId(id: string | null | undefined, head = 8, tail = 6): string {
  if (!id) return '—';
  return id.length > head + tail + 1 ? `${id.slice(0, head)}…${id.slice(-tail)}` : id;
}

function fmtTimestamp(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts || '—';
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit',
  });
}

function formatVal(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

// Derives a one-line summary from the first few keys of `details` — the API
// gives no pre-baked summary field, so this reads the same JSON the
// accordion shows in full, just truncated to what fits a table cell.
function summarizeDetails(details: unknown): string {
  if (details === null || details === undefined) return '—';
  if (typeof details !== 'object') return String(details);
  const entries = Object.entries(details as Record<string, unknown>);
  if (entries.length === 0) return '—';
  const shown = entries.slice(0, 3).map(([k, v]) => `${k}: ${formatVal(v)}`).join(', ');
  return entries.length > 3 ? `${shown}, …` : shown;
}

function prettyJson(details: unknown): string {
  if (details === null || details === undefined) return '—';
  try {
    return JSON.stringify(details, null, 2);
  } catch {
    return String(details);
  }
}

// clearToken deliberately NOT wired into every non-org 401 — see the same
// comment in ../page.tsx. Only the /enterprise/orgs/me probe below treats a
// 401 as a genuinely dead session.
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

// ── Copy-to-clipboard hash chip ─────────────────────────────────────────────

function HashChip({ label, hash }: { label: string; hash: string | null | undefined }) {
  const [copied, setCopied] = useState(false);

  if (!hash) return <span className={styles.hashEmpty}>—</span>;

  function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    navigator.clipboard.writeText(hash!).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    }).catch(() => {});
  }

  return (
    <span className={styles.hashChip} title={hash}>
      <span className={styles.hashLabel}>{label}</span>
      <span className={dStyles.mono}>{shortId(hash, 6, 5)}</span>
      <button
        type="button"
        className={styles.copyBtn}
        onClick={handleCopy}
        aria-label={`Copy ${label}`}
      >
        {copied ? <Check size={13} weight="bold" /> : <Copy size={13} />}
      </button>
    </span>
  );
}

// ── Chain-integrity badge ────────────────────────────────────────────────────

function ChainBadge({
  status, result, onVerify, verifying,
}: {
  status: ChainStatus;
  result: VerifyResult | null;
  onVerify: () => void;
  verifying: boolean;
}) {
  let icon: React.ReactNode;
  let label: string;
  const spinning = status === 'checking';

  if (status === 'checking') {
    icon = <CircleNotch size={15} weight="bold" />;
    label = 'Verifying…';
  } else if (status === 'valid') {
    icon = <ShieldCheck size={15} weight="fill" />;
    label = `Chain verified (${result?.checkedCount ?? 0} entries)`;
  } else if (status === 'broken') {
    icon = <ShieldWarning size={15} weight="fill" />;
    label = `Integrity broken at entry ${result?.firstBrokenAt ?? '?'}`;
  } else {
    icon = <ShieldWarning size={15} weight="fill" />;
    label = 'Could not verify chain';
  }

  return (
    <div className={styles.chainMeta}>
      <span className={styles.chainBadge} data-status={status} role="status" aria-live="polite">
        <span className={styles.chainBadgeIcon} data-spin={spinning || undefined}>{icon}</span>
        {label}
      </span>
      <button type="button" className={styles.verifyBtn} onClick={onVerify} disabled={verifying}>
        <ArrowsClockwise size={13} style={{ marginRight: 2 }} />
        Re-verify
      </button>
    </div>
  );
}

// ── Audit row (expandable) ──────────────────────────────────────────────────

function AuditRowItem({ row }: { row: AuditRow }) {
  const [open, setOpen] = useState(false);
  const actor = row.userId !== null && row.userId !== undefined ? String(row.userId) : null;

  return (
    <>
      <tr className={styles.auditRow} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <td className={dStyles.mono}>{fmtTimestamp(row.timestamp)}</td>
        <td className={dStyles.mono}>{shortId(actor)}</td>
        <td><span className={styles.eventPill}>{row.eventType || 'unknown'}</span></td>
        <td className={styles.summaryCell} title={summarizeDetails(row.details)}>
          {summarizeDetails(row.details)}
        </td>
        <td className={dStyles.mono}>{row.ipAddress || '—'}</td>
      </tr>
      {open && (
        <tr className={styles.detailRow}>
          <td colSpan={5}>
            <div className={styles.detailPanel}>
              <div className={styles.detailMeta}>
                <div className={styles.detailField}>
                  <span className={styles.detailLabel}>Entry ID</span>
                  <span className={dStyles.mono}>{row.id}</span>
                </div>
                <div className={styles.detailField}>
                  <span className={styles.detailLabel}>Actor (user ID)</span>
                  <span className={dStyles.mono}>{actor ?? '—'}</span>
                </div>
                <div className={styles.detailField}>
                  <span className={styles.detailLabel}>Agent ID</span>
                  <span className={dStyles.mono}>{row.agentId ?? '—'}</span>
                </div>
                <div className={styles.detailField}>
                  <span className={styles.detailLabel}>Timestamp</span>
                  <span className={dStyles.mono}>{row.timestamp}</span>
                </div>
              </div>
              <pre className={styles.jsonBlock}>{prettyJson(row.details)}</pre>
              <div className={styles.detailHashes}>
                <HashChip label="entry hash" hash={row.entryHash} />
                <HashChip label="prev hash" hash={row.prevHash} />
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ── Filter bar ───────────────────────────────────────────────────────────────

interface Filters {
  eventType: string;
  userId: string;
  from: string;
  to: string;
}

const EMPTY_FILTERS: Filters = { eventType: '', userId: '', from: '', to: '' };

function FilterBar({
  draft, setDraft, eventTypeOptions, onApply, onReset,
}: {
  draft: Filters;
  setDraft: (f: Filters) => void;
  eventTypeOptions: string[];
  onApply: () => void;
  onReset: () => void;
}) {
  return (
    <form
      className={styles.filterBar}
      onSubmit={(e) => { e.preventDefault(); onApply(); }}
    >
      <label className={styles.filterField}>
        <span className={styles.filterLabel}>Event type</span>
        <input
          className={styles.filterInput}
          list="audit-event-type-options"
          placeholder="e.g. member.invited"
          value={draft.eventType}
          onChange={(e) => setDraft({ ...draft, eventType: e.target.value })}
        />
        <datalist id="audit-event-type-options">
          {eventTypeOptions.map((t) => <option key={t} value={t} />)}
        </datalist>
      </label>

      <label className={styles.filterField}>
        <span className={styles.filterLabel}>Actor (user ID)</span>
        <input
          className={styles.filterInput}
          placeholder="user ID"
          value={draft.userId}
          onChange={(e) => setDraft({ ...draft, userId: e.target.value })}
        />
      </label>

      <label className={styles.filterField}>
        <span className={styles.filterLabel}>From</span>
        <input
          type="date"
          className={styles.filterInput}
          value={draft.from}
          onChange={(e) => setDraft({ ...draft, from: e.target.value })}
        />
      </label>

      <label className={styles.filterField}>
        <span className={styles.filterLabel}>To</span>
        <input
          type="date"
          className={styles.filterInput}
          value={draft.to}
          onChange={(e) => setDraft({ ...draft, to: e.target.value })}
        />
      </label>

      <div className={styles.filterActions}>
        <button type="submit" className={`${dStyles.actionBtn} ${dStyles['actionBtn--create']}`}>Apply</button>
        <button type="button" className={dStyles.actionBtn} onClick={onReset}>Reset</button>
      </div>
    </form>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function AuditPage() {
  const { auth, clearToken } = useDashboardAuth();
  const apiFetch = useApiFetch(auth);

  const [org, setOrg]         = useState<OrgMe | null>(null);
  const [hasOrg, setHasOrg]   = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [rows, setRows]       = useState<AuditRow[]>([]);
  const [offset, setOffset]   = useState(0);
  const [loading, setLoading] = useState(true);
  const [fetchErr, setFetchErr] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportErr, setExportErr] = useState<string | null>(null);

  const [chainStatus, setChainStatus] = useState<ChainStatus>('checking');
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);
  const [verifying, setVerifying] = useState(false);

  const [draftFilters, setDraftFilters] = useState<Filters>(EMPTY_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<Filters>(EMPTY_FILTERS);

  const buildParams = useCallback((filters: Filters, extra: Record<string, string> = {}) => {
    const params = new URLSearchParams();
    if (filters.eventType) params.set('eventType', filters.eventType);
    if (filters.userId) params.set('userId', filters.userId);
    if (filters.from) params.set('from', filters.from);
    if (filters.to) params.set('to', filters.to);
    Object.entries(extra).forEach(([k, v]) => params.set(k, v));
    return params;
  }, []);

  const load = useCallback(async (orgId: string, filters: Filters, off: number) => {
    setLoading(true);
    setFetchErr(null);
    try {
      const params = buildParams(filters, { limit: String(PAGE_SIZE), offset: String(off) });
      const res = await apiFetch(`/enterprise/orgs/${orgId}/audit?${params}`);

      if (res.status === 401) {
        clearToken();
        return;
      }
      if (res.status === 403) {
        setForbidden(true);
        setLoading(false);
        return;
      }
      if (!res.ok) {
        setFetchErr('Could not load the audit trail. Please try again.');
        setLoading(false);
        return;
      }

      const payload = await res.json();
      const parsedRows: AuditRow[] = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.events)
          ? payload.events
          : Array.isArray(payload?.rows)
            ? payload.rows
            : [];
      setRows(parsedRows);
    } catch (e) {
      setFetchErr('Could not load the audit trail. Check your connection.');
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [apiFetch, clearToken, buildParams]);

  const runVerify = useCallback(async (orgId: string) => {
    setVerifying(true);
    setChainStatus('checking');
    try {
      const res = await apiFetch(`/enterprise/orgs/${orgId}/audit/verify?limit=1000`);
      if (res.status === 401) {
        clearToken();
        return;
      }
      if (res.status === 403) {
        setForbidden(true);
        setChainStatus('error');
        return;
      }
      if (!res.ok) {
        setChainStatus('error');
        return;
      }
      const data: VerifyResult = await res.json();
      setVerifyResult(data);
      setChainStatus(data.valid ? 'valid' : 'broken');
    } catch (e) {
      setChainStatus('error');
      console.error(e);
    } finally {
      setVerifying(false);
    }
  }, [apiFetch, clearToken]);

  // Resolve the org once — same pattern as ../treasury/page.tsx.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const orgRes = await apiFetch('/enterprise/orgs/me');
        if (cancelled) return;
        if (orgRes.status === 401) {
          clearToken();
          return;
        }
        if (!orgRes.ok) {
          setHasOrg(false);
          setLoading(false);
          return;
        }
        // /enterprise/orgs/me returns { org, role } (see api-ts
      // routes/enterprise.ts) — unwrap, tolerating a flat legacy shape.
      const orgPayload = await orgRes.json();
      const orgData: OrgMe = orgPayload?.org ?? orgPayload;
        if (cancelled) return;
        setOrg(orgData);
        setHasOrg(true);
        await Promise.all([
          load(orgData.id, EMPTY_FILTERS, 0),
          runVerify(orgData.id),
        ]);
      } catch (e) {
        if (!cancelled) {
          setFetchErr('Could not load the audit trail. Check your connection.');
          setLoading(false);
        }
        console.error(e);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiFetch]);

  function handleApply() {
    setAppliedFilters(draftFilters);
    setOffset(0);
    if (org) load(org.id, draftFilters, 0);
  }

  function handleReset() {
    setDraftFilters(EMPTY_FILTERS);
    setAppliedFilters(EMPTY_FILTERS);
    setOffset(0);
    if (org) load(org.id, EMPTY_FILTERS, 0);
  }

  function goPrev() {
    if (!org || offset === 0) return;
    const next = Math.max(0, offset - PAGE_SIZE);
    setOffset(next);
    load(org.id, appliedFilters, next);
  }

  function goNext() {
    if (!org || rows.length < PAGE_SIZE) return;
    const next = offset + PAGE_SIZE;
    setOffset(next);
    load(org.id, appliedFilters, next);
  }

  async function handleExportCsv() {
    if (!org) return;
    setExporting(true);
    setExportErr(null);
    try {
      const params = buildParams(appliedFilters, { format: 'csv' });
      const res = await apiFetch(`/enterprise/orgs/${org.id}/audit?${params}`);
      if (!res.ok) {
        setExportErr('CSV export failed. Please try again.');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-${org.id}-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setExportErr('CSV export failed. Check your connection.');
      console.error(e);
    } finally {
      setExporting(false);
    }
  }

  // eventType options derived from what's actually on screen — the API gives
  // no separate facet endpoint (same constraint noted in
  // ../transactions/page.tsx), so this only ever offers values seen on the
  // currently loaded page, fed into the filter's <datalist>.
  const eventTypeOptions = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => { if (r.eventType) set.add(r.eventType); });
    return Array.from(set).sort();
  }, [rows]);

  // ── Loading ──
  if (loading && rows.length === 0 && !fetchErr && !forbidden) {
    return (
      <div aria-busy="true" aria-live="polite">
        <span className="sr-only">Loading audit trail</span>
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
        <span>Create a workspace to see the audit trail.</span>
        <Link href="/dashboard" className={dStyles.actionBtn}>Go to Overview</Link>
      </div>
    );
  }

  // ── Admin-only gate ──
  if (forbidden) {
    return (
      <div className={dStyles.stateBox} role="alert">
        <span>The audit trail requires admin role. Ask an org owner or admin for access.</span>
        <Link href="/dashboard" className={dStyles.actionBtn}>Go to Overview</Link>
      </div>
    );
  }

  // ── Error ──
  if (fetchErr && rows.length === 0) {
    return (
      <div className={dStyles.stateBox} role="alert">
        <span>{fetchErr}</span>
        <button className={dStyles.actionBtn} onClick={() => org && load(org.id, appliedFilters, offset)}>Retry</button>
      </div>
    );
  }

  const isEmpty = rows.length === 0;

  return (
    <>
      <section className={dStyles.card} aria-label="Audit trail status">
        <div className={dStyles.cardHead}>
          <h2 className={dStyles.cardTitle}>Audit Trail</h2>
          <ChainBadge
            status={chainStatus}
            result={verifyResult}
            verifying={verifying}
            onVerify={() => org && runVerify(org.id)}
          />
        </div>
      </section>

      <section className={dStyles.card} aria-label="Filter audit events">
        <div className={dStyles.cardHead}>
          <h2 className={dStyles.cardTitle}>Filters</h2>
          <button
            type="button"
            className={dStyles.actionBtn}
            onClick={handleExportCsv}
            disabled={exporting || isEmpty}
          >
            <DownloadSimple size={14} style={{ marginRight: 5, verticalAlign: -2 }} />
            {exporting ? 'Exporting…' : 'Export CSV'}
          </button>
        </div>
        <FilterBar
          draft={draftFilters}
          setDraft={setDraftFilters}
          eventTypeOptions={eventTypeOptions}
          onApply={handleApply}
          onReset={handleReset}
        />
        {exportErr && <p className={styles.exportErr} role="alert">{exportErr}</p>}
      </section>

      <section className={dStyles.card} aria-label="Audit event stream">
        {isEmpty ? (
          <div className={dStyles.stateBox} style={{ minHeight: 160 }}>
            <span>No audit events yet.</span>
          </div>
        ) : (
          <>
            <table className={dStyles.table}>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Actor</th>
                  <th>Event type</th>
                  <th>Summary</th>
                  <th>IP</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => <AuditRowItem key={r.id} row={r} />)}
              </tbody>
            </table>
            <div className={styles.pagination}>
              <span className={styles.pageMeta}>
                Showing {offset + 1}–{offset + rows.length}
              </span>
              <div className={styles.pageBtns}>
                <button
                  type="button"
                  className={dStyles.actionBtn}
                  onClick={goPrev}
                  disabled={offset === 0 || loading}
                >
                  <CaretLeft size={14} style={{ verticalAlign: -2 }} /> Prev
                </button>
                <button
                  type="button"
                  className={dStyles.actionBtn}
                  onClick={goNext}
                  disabled={rows.length < PAGE_SIZE || loading}
                >
                  Next <CaretRight size={14} style={{ verticalAlign: -2 }} />
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    </>
  );
}
