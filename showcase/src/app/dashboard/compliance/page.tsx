'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  Copy, Check, CaretLeft, CaretRight, DownloadSimple,
  ShieldWarning, ShieldCheck, ShieldSlash,
} from '@phosphor-icons/react';
import { API_BASE_URL } from '@/lib/links';
import { type AuthState, useDashboardAuth } from '../auth-context';
import dStyles from '../dashboard.module.css';
import styles from './compliance.module.css';

// ── Types (mirrors GET /enterprise/orgs/:orgId/compliance/summary + /events,
// see api-ts/src/routes/enterpriseCompliance.ts) ────────────────────────────

interface OrgMe {
  id: string;
  name: string;
  tier: string;
}

interface CountRow {
  count: number;
}

interface DecisionCount extends CountRow { decision: string | null }
interface ReasonCount extends CountRow { reason: string | null }
interface ModeCount extends CountRow { mode: string | null }

interface Summary {
  windowDays: number;
  since: string;
  byDecision: DecisionCount[];
  byReason: ReasonCount[];
  byMode: ModeCount[];
  mode: string | null;
  modeSource: 'observed_from_events' | 'no_recent_events';
}

interface EventRow {
  id: number | string;
  timestamp: string;
  userId: number | string | null;
  orgId: string | null;
  chain: string | null;
  direction: string | null;
  address: string | null;
  decision: string | null;
  reason: string | null;
  mode: string | null;
  txContext: unknown;
}

type DecisionTab = 'all' | 'blocked' | 'flagged' | 'allowed';

const PAGE_SIZE = 50;
const DAY_OPTIONS = [7, 30, 90] as const;

// ── Helpers ──────────────────────────────────────────────────────────────────

function shortAddr(addr: string | null | undefined): string {
  if (!addr) return '-';
  return addr.length > 14 ? `${addr.slice(0, 8)}…${addr.slice(-6)}` : addr;
}

function fmtTimestamp(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts || '-';
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit',
  });
}

function prettyJson(v: unknown): string {
  if (v === null || v === undefined) return '-';
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

// Human label for a reason code — falls back to the raw code for values not
// yet in this map, since screening_events.py is free to add new reasons.
const REASON_LABELS: Record<string, string> = {
  ofac_match: 'OFAC match',
  custom_blocklist: 'Custom blocklist',
  not_allowlisted: 'Not allowlisted',
  unscreenable: 'Unscreenable',
  degraded_list: 'Degraded list',
};

function reasonLabel(reason: string | null): string {
  if (!reason) return 'unspecified';
  return REASON_LABELS[reason] ?? reason;
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

// ── Copy-to-clipboard address chip ──────────────────────────────────────────

function AddressChip({ address }: { address: string | null | undefined }) {
  const [copied, setCopied] = useState(false);

  if (!address) return <span className={styles.hashEmpty}>-</span>;

  function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    navigator.clipboard.writeText(address!).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    }).catch(() => {});
  }

  return (
    <span className={styles.hashChip} title={address}>
      <span className={dStyles.mono}>{shortAddr(address)}</span>
      <button
        type="button"
        className={styles.copyBtn}
        onClick={handleCopy}
        aria-label="Copy address"
      >
        {copied ? <Check size={13} weight="bold" /> : <Copy size={13} />}
      </button>
    </span>
  );
}

// ── Decision pill ────────────────────────────────────────────────────────────

function DecisionPill({ decision }: { decision: string | null }) {
  const norm = (decision || 'unknown').toLowerCase();
  return (
    <span className={styles.decisionPill} data-decision={norm}>
      {decision || 'unknown'}
    </span>
  );
}

// ── Reason pill ──────────────────────────────────────────────────────────────

function ReasonPill({ reason }: { reason: string | null }) {
  if (!reason) return <span className={styles.hashEmpty}>-</span>;
  return <span className={styles.reasonPill}>{reasonLabel(reason)}</span>;
}

// ── Mode indicator card (header) ────────────────────────────────────────────

function ModeIndicator({ summary }: { summary: Summary | null }) {
  if (!summary) {
    return (
      <div className={styles.modeCard} data-mode="unknown">
        <span className={styles.modeIcon}><ShieldSlash size={20} weight="fill" /></span>
        <div>
          <div className={styles.modeLabel}>Screening mode</div>
          <div className={styles.modeValue}>-</div>
        </div>
      </div>
    );
  }

  const observed = summary.modeSource === 'observed_from_events' && summary.mode;
  const mode = observed ? summary.mode!.toLowerCase() : 'disabled';

  let icon: React.ReactNode;
  let display: string;
  if (mode === 'enforce') {
    icon = <ShieldWarning size={20} weight="fill" />;
    display = 'ENFORCE';
  } else if (mode === 'monitor') {
    icon = <ShieldCheck size={20} weight="fill" />;
    display = 'MONITOR';
  } else {
    icon = <ShieldSlash size={20} weight="fill" />;
    display = 'DISABLED / UNKNOWN';
  }

  return (
    <div className={styles.modeCard} data-mode={mode}>
      <span className={styles.modeIcon}>{icon}</span>
      <div>
        <div className={styles.modeLabel}>Screening mode</div>
        <div className={styles.modeValue}>{display}</div>
        <div className={styles.modeCaption}>
          {observed
            ? `Observed from the most recent screening event in this window. Suwappu's compliance mode is set by a bot-side env var api-ts cannot read live.`
            : `No screening events observed in this window. Mode cannot be inferred, and may mean screening is off.`}
        </div>
      </div>
    </div>
  );
}

// ── Summary stat tiles ──────────────────────────────────────────────────────

function SummaryTiles({ summary }: { summary: Summary | null }) {
  const byDecision = summary?.byDecision ?? [];
  const total = byDecision.reduce((s, r) => s + (r.count || 0), 0);
  const countFor = (decision: string) =>
    byDecision.find((r) => (r.decision || '').toLowerCase() === decision)?.count ?? 0;

  const blocked = countFor('blocked');
  const flagged = countFor('flagged');
  const allowed = countFor('allowed');

  const byReason = (summary?.byReason ?? [])
    .filter((r) => r.reason)
    .sort((a, b) => (b.count || 0) - (a.count || 0));

  return (
    <div className={styles.summaryBlock}>
      <div className={dStyles.kpiRow} style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
        <div className={dStyles.kpiCard}>
          <p className={dStyles.kpiLabel}>Total screened</p>
          <div className={dStyles.kpiValue}>{total.toLocaleString()}</div>
        </div>
        <div className={dStyles.kpiCard}>
          <span className={`${dStyles.kpiDot} ${styles.kpiDot}`} data-tone="blocked" />
          <p className={dStyles.kpiLabel}>Blocked</p>
          <div className={dStyles.kpiValue}>{blocked.toLocaleString()}</div>
        </div>
        <div className={dStyles.kpiCard}>
          <span className={`${dStyles.kpiDot} ${styles.kpiDot}`} data-tone="flagged" />
          <p className={dStyles.kpiLabel}>Flagged</p>
          <div className={dStyles.kpiValue}>{flagged.toLocaleString()}</div>
        </div>
        <div className={dStyles.kpiCard}>
          <span className={`${dStyles.kpiDot} ${styles.kpiDot}`} data-tone="allowed" />
          <p className={dStyles.kpiLabel}>Allowed</p>
          <div className={dStyles.kpiValue}>{allowed.toLocaleString()}</div>
        </div>
      </div>

      {byReason.length > 0 && (
        <div className={styles.reasonBreakdown}>
          <span className={styles.reasonBreakdownLabel}>By reason</span>
          <div className={styles.reasonBars}>
            {byReason.map((r) => {
              const pct = total > 0 ? Math.round(((r.count || 0) / total) * 100) : 0;
              return (
                <div key={r.reason} className={styles.reasonBarRow}>
                  <span className={styles.reasonBarName}>{reasonLabel(r.reason)}</span>
                  <div className={styles.reasonBarTrack}>
                    <div className={styles.reasonBarFill} style={{ width: `${Math.max(pct, 2)}%` }} />
                  </div>
                  <span className={dStyles.mono}>{r.count}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Event row (expandable) ──────────────────────────────────────────────────

function EventRowItem({ row }: { row: EventRow }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <tr className={styles.eventRow} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <td className={dStyles.mono}>{fmtTimestamp(row.timestamp)}</td>
        <td className={dStyles.mono}>{row.chain || '-'}</td>
        <td className={dStyles.mono} style={{ textTransform: 'capitalize' }}>{row.direction || '-'}</td>
        <td onClick={(e) => e.stopPropagation()}><AddressChip address={row.address} /></td>
        <td><DecisionPill decision={row.decision} /></td>
        <td><ReasonPill reason={row.reason} /></td>
        <td className={dStyles.mono} style={{ textTransform: 'uppercase' }}>{row.mode || '-'}</td>
      </tr>
      {open && (
        <tr className={styles.detailRow}>
          <td colSpan={7}>
            <div className={styles.detailPanel}>
              <div className={styles.detailMeta}>
                <div className={styles.detailField}>
                  <span className={styles.detailLabel}>Event ID</span>
                  <span className={dStyles.mono}>{row.id}</span>
                </div>
                <div className={styles.detailField}>
                  <span className={styles.detailLabel}>User ID</span>
                  <span className={dStyles.mono}>{row.userId ?? '-'}</span>
                </div>
                <div className={styles.detailField}>
                  <span className={styles.detailLabel}>Org ID</span>
                  <span className={dStyles.mono}>{row.orgId ?? '-'}</span>
                </div>
                <div className={styles.detailField}>
                  <span className={styles.detailLabel}>Timestamp</span>
                  <span className={dStyles.mono}>{row.timestamp}</span>
                </div>
              </div>
              <span className={styles.detailLabel}>tx context</span>
              <pre className={styles.jsonBlock}>{prettyJson(row.txContext)}</pre>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ── Filter bar (chain, direction, date range) ───────────────────────────────

interface Filters {
  chain: string;
  direction: string;
  from: string;
  to: string;
}

const EMPTY_FILTERS: Filters = { chain: '', direction: '', from: '', to: '' };

function FilterBar({
  draft, setDraft, chainOptions, onApply, onReset,
}: {
  draft: Filters;
  setDraft: (f: Filters) => void;
  chainOptions: string[];
  onApply: () => void;
  onReset: () => void;
}) {
  return (
    <form
      className={styles.filterBar}
      onSubmit={(e) => { e.preventDefault(); onApply(); }}
    >
      <label className={styles.filterField}>
        <span className={styles.filterLabel}>Chain</span>
        {chainOptions.length > 0 ? (
          <select
            className={styles.filterSelect}
            value={draft.chain}
            onChange={(e) => setDraft({ ...draft, chain: e.target.value })}
          >
            <option value="">All chains</option>
            {chainOptions.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        ) : (
          <input
            className={styles.filterInput}
            placeholder="e.g. base"
            value={draft.chain}
            onChange={(e) => setDraft({ ...draft, chain: e.target.value })}
          />
        )}
      </label>

      <label className={styles.filterField}>
        <span className={styles.filterLabel}>Direction</span>
        <select
          className={styles.filterSelect}
          value={draft.direction}
          onChange={(e) => setDraft({ ...draft, direction: e.target.value })}
        >
          <option value="">Both</option>
          <option value="inbound">Inbound</option>
          <option value="outbound">Outbound</option>
        </select>
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

export default function CompliancePage() {
  const { auth, clearToken } = useDashboardAuth();
  const apiFetch = useApiFetch(auth);

  const [org, setOrg]         = useState<OrgMe | null>(null);
  const [hasOrg, setHasOrg]   = useState(true);
  const [forbidden, setForbidden] = useState(false);

  const [days, setDays] = useState<number>(30);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [summaryErr, setSummaryErr] = useState<string | null>(null);

  const [rows, setRows]       = useState<EventRow[]>([]);
  const [offset, setOffset]   = useState(0);
  const [loading, setLoading] = useState(true);
  const [fetchErr, setFetchErr] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportErr, setExportErr] = useState<string | null>(null);

  const [decisionTab, setDecisionTab] = useState<DecisionTab>('blocked');
  const [draftFilters, setDraftFilters] = useState<Filters>(EMPTY_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<Filters>(EMPTY_FILTERS);

  const buildParams = useCallback((tab: DecisionTab, filters: Filters, extra: Record<string, string> = {}) => {
    const params = new URLSearchParams();
    if (tab !== 'all') params.set('decision', tab);
    if (filters.chain) params.set('chain', filters.chain);
    if (filters.direction) params.set('direction', filters.direction);
    if (filters.from) params.set('from', filters.from);
    if (filters.to) params.set('to', filters.to);
    Object.entries(extra).forEach(([k, v]) => params.set(k, v));
    return params;
  }, []);

  const loadSummary = useCallback(async (orgId: string, windowDays: number) => {
    setSummaryErr(null);
    try {
      const res = await apiFetch(`/enterprise/orgs/${orgId}/compliance/summary?days=${windowDays}`);
      if (res.status === 401) {
        clearToken();
        return;
      }
      if (res.status === 403) {
        setForbidden(true);
        return;
      }
      if (!res.ok) {
        setSummaryErr('Could not load the compliance summary.');
        return;
      }
      const data: Summary = await res.json();
      setSummary(data);
    } catch (e) {
      setSummaryErr('Could not load the compliance summary. Check your connection.');
      console.error(e);
    }
  }, [apiFetch, clearToken]);

  const loadEvents = useCallback(async (orgId: string, tab: DecisionTab, filters: Filters, off: number) => {
    setLoading(true);
    setFetchErr(null);
    try {
      const params = buildParams(tab, filters, { limit: String(PAGE_SIZE), offset: String(off) });
      const res = await apiFetch(`/enterprise/orgs/${orgId}/compliance/events?${params}`);

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
        setFetchErr('Could not load screening events. Please try again.');
        setLoading(false);
        return;
      }

      const payload = await res.json();
      const parsedRows: EventRow[] = Array.isArray(payload?.events) ? payload.events : [];
      setRows(parsedRows);
    } catch (e) {
      setFetchErr('Could not load screening events. Check your connection.');
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [apiFetch, clearToken, buildParams]);

  // Resolve the org once — same pattern as ../audit/page.tsx.
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
          loadSummary(orgData.id, days),
          loadEvents(orgData.id, decisionTab, EMPTY_FILTERS, 0),
        ]);
      } catch (e) {
        if (!cancelled) {
          setFetchErr('Could not load compliance data. Check your connection.');
          setLoading(false);
        }
        console.error(e);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiFetch]);

  function handleDaysChange(next: number) {
    setDays(next);
    if (org) loadSummary(org.id, next);
  }

  function handleTabChange(tab: DecisionTab) {
    setDecisionTab(tab);
    setOffset(0);
    if (org) loadEvents(org.id, tab, appliedFilters, 0);
  }

  function handleApply() {
    setAppliedFilters(draftFilters);
    setOffset(0);
    if (org) loadEvents(org.id, decisionTab, draftFilters, 0);
  }

  function handleReset() {
    setDraftFilters(EMPTY_FILTERS);
    setAppliedFilters(EMPTY_FILTERS);
    setOffset(0);
    if (org) loadEvents(org.id, decisionTab, EMPTY_FILTERS, 0);
  }

  function goPrev() {
    if (!org || offset === 0) return;
    const next = Math.max(0, offset - PAGE_SIZE);
    setOffset(next);
    loadEvents(org.id, decisionTab, appliedFilters, next);
  }

  function goNext() {
    if (!org || rows.length < PAGE_SIZE) return;
    const next = offset + PAGE_SIZE;
    setOffset(next);
    loadEvents(org.id, decisionTab, appliedFilters, next);
  }

  async function handleExportCsv() {
    if (!org) return;
    setExporting(true);
    setExportErr(null);
    try {
      const params = buildParams(decisionTab, appliedFilters, { format: 'csv' });
      const res = await apiFetch(`/enterprise/orgs/${org.id}/compliance/events?${params}`);
      if (!res.ok) {
        setExportErr('CSV export failed. Please try again.');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `compliance-${org.id}-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setExportErr('CSV export failed. Check your connection.');
      console.error(e);
    } finally {
      setExporting(false);
    }
  }

  // Chain options derived from what's actually on screen — the API gives no
  // separate facet endpoint (same constraint as ../transactions/page.tsx).
  const chainOptions = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => { if (r.chain) set.add(r.chain); });
    return Array.from(set).sort();
  }, [rows]);

  // ── Loading ──
  if (loading && rows.length === 0 && !fetchErr && !forbidden && !summary) {
    return (
      <div aria-busy="true" aria-live="polite">
        <span className="sr-only">Loading compliance data</span>
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
        <span>Create a workspace to see compliance screening.</span>
        <Link href="/dashboard" className={dStyles.actionBtn}>Go to Overview</Link>
      </div>
    );
  }

  // ── Admin-only gate ──
  if (forbidden) {
    return (
      <div className={dStyles.stateBox} role="alert">
        <span>Compliance screening requires admin role. Ask an org owner or admin for access.</span>
        <Link href="/dashboard" className={dStyles.actionBtn}>Go to Overview</Link>
      </div>
    );
  }

  // ── Error (nothing has ever loaded — a harder failure than a filtered-out
  // empty result, which is handled by the empty state further down) ──
  if (fetchErr && rows.length === 0 && !summary) {
    return (
      <div className={dStyles.stateBox} role="alert">
        <span>{fetchErr}</span>
        <button
          className={dStyles.actionBtn}
          onClick={() => {
            if (!org) return;
            loadSummary(org.id, days);
            loadEvents(org.id, decisionTab, appliedFilters, offset);
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  const modeIsOff = !summary?.mode || summary.modeSource === 'no_recent_events';
  const totalScreened = (summary?.byDecision ?? []).reduce((s, r) => s + (r.count || 0), 0);
  const isEmpty = rows.length === 0;
  const isGloballyEmpty = isEmpty && decisionTab === 'all' && !appliedFilters.chain
    && !appliedFilters.direction && !appliedFilters.from && !appliedFilters.to && totalScreened === 0;

  return (
    <>
      <section className={dStyles.card} aria-label="Screening mode and summary">
        <div className={dStyles.cardHead}>
          <h2 className={dStyles.cardTitle}>Compliance</h2>
          <div className={styles.daysSelector} role="group" aria-label="Window">
            {DAY_OPTIONS.map((d) => (
              <button
                key={d}
                type="button"
                className={styles.dayBtn}
                data-active={days === d || undefined}
                onClick={() => handleDaysChange(d)}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>
        <ModeIndicator summary={summary} />
        {summaryErr && <p className={styles.exportErr} role="alert">{summaryErr}</p>}
        <SummaryTiles summary={summary} />
      </section>

      <section className={dStyles.card} aria-label="Filter screening events">
        <div className={dStyles.cardHead}>
          <h2 className={dStyles.cardTitle}>Screening events</h2>
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

        <div className={dStyles.tabs} role="tablist" aria-label="Decision filter">
          {(['all', 'blocked', 'flagged', 'allowed'] as DecisionTab[]).map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              className={dStyles.tab}
              data-active={decisionTab === tab || undefined}
              aria-selected={decisionTab === tab}
              onClick={() => handleTabChange(tab)}
            >
              {tab === 'all' ? 'All' : tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        <FilterBar
          draft={draftFilters}
          setDraft={setDraftFilters}
          chainOptions={chainOptions}
          onApply={handleApply}
          onReset={handleReset}
        />
        {exportErr && <p className={styles.exportErr} role="alert">{exportErr}</p>}
      </section>

      <section className={dStyles.card} aria-label="Screening event stream">
        {isEmpty ? (
          <div className={dStyles.stateBox} style={{ minHeight: 160 }}>
            <span>
              {isGloballyEmpty && modeIsOff
                ? 'No screening events. Compliance screening may be disabled.'
                : 'No screening events match these filters.'}
            </span>
          </div>
        ) : (
          <>
            <table className={dStyles.table}>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Chain</th>
                  <th>Direction</th>
                  <th>Address</th>
                  <th>Decision</th>
                  <th>Reason</th>
                  <th>Mode</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => <EventRowItem key={r.id} row={r} />)}
              </tbody>
            </table>
            <div className={styles.pagination}>
              <span className={styles.pageMeta}>
                Showing {offset + 1}-{offset + rows.length}
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
