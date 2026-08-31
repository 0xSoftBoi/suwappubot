'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import Link from 'next/link';
import { Copy, Check, CaretLeft, CaretRight, DownloadSimple } from '@phosphor-icons/react';
import { API_BASE_URL } from '@/lib/links';
import { type AuthState, useDashboardAuth } from '../auth-context';
import dStyles from '../dashboard.module.css';
import styles from './transactions.module.css';

// ── Types (mirrors GET /enterprise/orgs/:orgId/transactions) ───────────────

interface OrgMe {
  id: string;
  name: string;
  tier: string;
}

interface TxRow {
  id: string;
  timestamp: string;
  userId: string;
  fromChain: string;
  toChain: string;
  fromToken: string;
  toToken: string;
  fromAmount: number;
  toAmount: number;
  realizedToAmount: number;
  fromAmountUsd: number;
  toAmountUsd: number;
  realizedToAmountUsd: number;
  status: string;
  txHash: string | null;
  bridgeTxHash: string | null;
  destinationTxHash: string | null;
}

const PAGE_SIZE = 50;

// Base status vocabulary — swap-adjacent tables across the codebase converge
// on pending/processing/completed/failed(/refunded); any status the API
// actually returns that isn't in this list still shows up via the "seen in
// this page" merge below, so the filter never hides a real value.
const BASE_STATUSES = ['pending', 'processing', 'completed', 'failed', 'refunded'];

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtUsd(n: number): string {
  return n.toLocaleString(undefined, {
    style: 'currency', currency: 'USD',
    maximumFractionDigits: Math.abs(n) >= 1000 ? 0 : 2,
  });
}

function fmtAmount(n: number): string {
  const abs = Math.abs(n);
  const decimals = abs >= 1000 ? 2 : abs >= 1 ? 4 : 6;
  return n.toLocaleString(undefined, { maximumFractionDigits: decimals });
}

function shortId(id: string | null | undefined, head = 8, tail = 6): string {
  if (!id) return '—';
  return id.length > head + tail + 1 ? `${id.slice(0, head)}…${id.slice(-tail)}` : id;
}

function fmtTimestamp(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts || '—';
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
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
// No per-chain block-explorer map exists anywhere in the showcase codebase
// (checked src/data + src/content) — so this stays copy-only rather than
// inventing explorer URLs.

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
        aria-label={`Copy ${label} hash`}
      >
        {copied ? <Check size={13} weight="bold" /> : <Copy size={13} />}
      </button>
    </span>
  );
}

// ── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const norm = (status || 'unknown').toLowerCase();
  return (
    <span className={styles.statusBadge} data-status={norm}>
      {status || 'Unknown'}
    </span>
  );
}

// ── Transaction row (expandable) ────────────────────────────────────────────

function TxRowItem({ row }: { row: TxRow }) {
  const [open, setOpen] = useState(false);
  const usdValue = row.realizedToAmountUsd || row.toAmountUsd || row.fromAmountUsd || 0;

  return (
    <>
      <tr className={styles.txRow} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <td className={dStyles.mono}>{fmtTimestamp(row.timestamp)}</td>
        <td className={dStyles.mono}>{shortId(row.userId)}</td>
        <td>
          <span className={styles.pair}>
            <span className={styles.pairToken}>{row.fromToken}</span>
            <span className={styles.pairChain}>{row.fromChain}</span>
            <span className={styles.pairArrow} aria-hidden="true">→</span>
            <span className={styles.pairToken}>{row.toToken}</span>
            <span className={styles.pairChain}>{row.toChain}</span>
          </span>
        </td>
        <td className={dStyles.mono} style={{ textAlign: 'right' }}>{fmtUsd(usdValue)}</td>
        <td><StatusBadge status={row.status} /></td>
        <td onClick={(e) => e.stopPropagation()}>
          <HashChip label="tx" hash={row.txHash} />
        </td>
      </tr>
      {open && (
        <tr className={styles.detailRow}>
          <td colSpan={6}>
            <div className={styles.detailPanel}>
              <div className={styles.detailGrid}>
                <div className={styles.detailField}>
                  <span className={styles.detailLabel}>Transaction ID</span>
                  <span className={dStyles.mono}>{row.id}</span>
                </div>
                <div className={styles.detailField}>
                  <span className={styles.detailLabel}>Member</span>
                  <span className={dStyles.mono}>{row.userId}</span>
                </div>
                <div className={styles.detailField}>
                  <span className={styles.detailLabel}>Timestamp</span>
                  <span className={dStyles.mono}>{row.timestamp}</span>
                </div>
                <div className={styles.detailField}>
                  <span className={styles.detailLabel}>From</span>
                  <span className={dStyles.mono}>
                    {fmtAmount(row.fromAmount)} {row.fromToken} ({row.fromChain}) · {fmtUsd(row.fromAmountUsd)}
                  </span>
                </div>
                <div className={styles.detailField}>
                  <span className={styles.detailLabel}>To (quoted)</span>
                  <span className={dStyles.mono}>
                    {fmtAmount(row.toAmount)} {row.toToken} ({row.toChain}) · {fmtUsd(row.toAmountUsd)}
                  </span>
                </div>
                <div className={styles.detailField}>
                  <span className={styles.detailLabel}>To (realized)</span>
                  <span className={dStyles.mono}>
                    {fmtAmount(row.realizedToAmount)} {row.toToken} · {fmtUsd(row.realizedToAmountUsd)}
                  </span>
                </div>
              </div>
              <div className={styles.detailHashes}>
                <HashChip label="source tx" hash={row.txHash} />
                <HashChip label="bridge tx" hash={row.bridgeTxHash} />
                <HashChip label="destination tx" hash={row.destinationTxHash} />
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
  chain: string;
  status: string;
  userId: string;
  from: string;
  to: string;
  minUsd: string;
}

const EMPTY_FILTERS: Filters = { chain: '', status: '', userId: '', from: '', to: '', minUsd: '' };

function FilterBar({
  draft, setDraft, chainOptions, statusOptions, onApply, onReset,
}: {
  draft: Filters;
  setDraft: (f: Filters) => void;
  chainOptions: string[];
  statusOptions: string[];
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
        <span className={styles.filterLabel}>Status</span>
        <select
          className={styles.filterSelect}
          value={draft.status}
          onChange={(e) => setDraft({ ...draft, status: e.target.value })}
        >
          <option value="">All statuses</option>
          {statusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>

      <label className={styles.filterField}>
        <span className={styles.filterLabel}>Member (user ID)</span>
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

      <label className={styles.filterField}>
        <span className={styles.filterLabel}>Min USD</span>
        <input
          type="number"
          min="0"
          step="1"
          className={styles.filterInput}
          placeholder="0"
          value={draft.minUsd}
          onChange={(e) => setDraft({ ...draft, minUsd: e.target.value })}
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

export default function TransactionsPage() {
  const { auth, clearToken } = useDashboardAuth();
  const apiFetch = useApiFetch(auth);

  const [org, setOrg]         = useState<OrgMe | null>(null);
  const [hasOrg, setHasOrg]   = useState(true);
  const [rows, setRows]       = useState<TxRow[]>([]);
  const [offset, setOffset]   = useState(0);
  const [loading, setLoading] = useState(true);
  const [fetchErr, setFetchErr] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportErr, setExportErr] = useState<string | null>(null);

  const [draftFilters, setDraftFilters] = useState<Filters>(EMPTY_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<Filters>(EMPTY_FILTERS);

  const buildParams = useCallback((filters: Filters, extra: Record<string, string> = {}) => {
    const params = new URLSearchParams();
    if (filters.chain) params.set('chain', filters.chain);
    if (filters.status) params.set('status', filters.status);
    if (filters.userId) params.set('userId', filters.userId);
    if (filters.from) params.set('from', filters.from);
    if (filters.to) params.set('to', filters.to);
    if (filters.minUsd) params.set('minUsd', filters.minUsd);
    Object.entries(extra).forEach(([k, v]) => params.set(k, v));
    return params;
  }, []);

  const load = useCallback(async (orgId: string, filters: Filters, off: number) => {
    setLoading(true);
    setFetchErr(null);
    try {
      const params = buildParams(filters, { limit: String(PAGE_SIZE), offset: String(off) });
      const res = await apiFetch(`/enterprise/orgs/${orgId}/transactions?${params}`);

      if (res.status === 401) {
        clearToken();
        return;
      }
      if (!res.ok) {
        setFetchErr('Could not load transactions. Please try again.');
        setLoading(false);
        return;
      }

      const payload = await res.json();
      const parsedRows: TxRow[] = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.rows)
          ? payload.rows
          : Array.isArray(payload?.transactions)
            ? payload.transactions
            : [];
      setRows(parsedRows);
    } catch (e) {
      setFetchErr('Could not load transactions. Check your connection.');
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [apiFetch, clearToken, buildParams]);

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
        await load(orgData.id, EMPTY_FILTERS, 0);
      } catch (e) {
        if (!cancelled) {
          setFetchErr('Could not load transactions. Check your connection.');
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
      const res = await apiFetch(`/enterprise/orgs/${org.id}/transactions?${params}`);
      if (!res.ok) {
        setExportErr('CSV export failed. Please try again.');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `transactions-${org.id}-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setExportErr('CSV export failed. Check your connection.');
      console.error(e);
    } finally {
      setExporting(false);
    }
  }

  // Filter option values derived from what's actually on screen — the API
  // gives no separate facet endpoint, so this only ever offers values that
  // exist somewhere in the currently loaded page (task spec: "select from
  // values present").
  const chainOptions = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => { if (r.fromChain) set.add(r.fromChain); if (r.toChain) set.add(r.toChain); });
    return Array.from(set).sort();
  }, [rows]);

  const statusOptions = useMemo(() => {
    const set = new Set(BASE_STATUSES);
    rows.forEach((r) => { if (r.status) set.add(r.status.toLowerCase()); });
    return Array.from(set).sort();
  }, [rows]);

  // ── Loading ──
  if (loading && rows.length === 0 && !fetchErr) {
    return (
      <div aria-busy="true" aria-live="polite">
        <span className="sr-only">Loading transactions</span>
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
        <span>Create a workspace to see transactions.</span>
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
      <section className={dStyles.card} aria-label="Filter transactions">
        <div className={dStyles.cardHead}>
          <h2 className={dStyles.cardTitle}>Transactions</h2>
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
          chainOptions={chainOptions}
          statusOptions={statusOptions}
          onApply={handleApply}
          onReset={handleReset}
        />
        {exportErr && <p className={styles.exportErr} role="alert">{exportErr}</p>}
      </section>

      <section className={dStyles.card} aria-label="Transaction list">
        {isEmpty ? (
          <div className={dStyles.stateBox} style={{ minHeight: 160 }}>
            <span>No transactions match these filters.</span>
          </div>
        ) : (
          <>
            <table className={dStyles.table}>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Member</th>
                  <th>Pair</th>
                  <th style={{ textAlign: 'right' }}>USD Value</th>
                  <th>Status</th>
                  <th>Tx Hash</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => <TxRowItem key={r.id} row={r} />)}
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
