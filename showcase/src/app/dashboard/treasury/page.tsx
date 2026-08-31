'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { CaretDown } from '@phosphor-icons/react';
import { API_BASE_URL } from '@/lib/links';
import { type AuthState, useDashboardAuth } from '../auth-context';
import dStyles from '../dashboard.module.css';
import styles from './treasury.module.css';
import TreasuryChart, { type TreasuryPoint } from './TreasuryChart';

// ── Types (mirrors GET /enterprise/orgs/:orgId/treasury and
//    /enterprise/orgs/:orgId/treasury/history?days=30) ──────────────────────

interface OrgMe {
  id: string;
  name: string;
  tier: string;
}

interface Asset {
  symbol: string;
  amount: number;
  valueUsd: number;
}

interface ChainTreasury {
  chain: string;
  valueUsd: number;
  assets: Asset[];
}

interface MemberValue {
  userId: string;
  valueUsd: number;
}

interface TreasuryData {
  totalValueUsd: number;
  chains: ChainTreasury[];
  members: MemberValue[];
  note?: string;
}

interface TreasuryHistory {
  days: number;
  series: TreasuryPoint[];
  derivedFrom: string;
}

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

function shortId(id: string): string {
  if (!id) return '—';
  return id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-6)}` : id;
}

function fmtTime(d: Date | null): string {
  if (!d) return '—';
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
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

// ── Chain row (expandable) ──────────────────────────────────────────────────

function ChainRow({ chain, totalValueUsd }: { chain: ChainTreasury; totalValueUsd: number }) {
  const [open, setOpen] = useState(false);
  const pct = totalValueUsd > 0 ? (chain.valueUsd / totalValueUsd) * 100 : 0;

  return (
    <div className={styles.chainRow}>
      <button
        type="button"
        className={styles.chainHead}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className={styles.chainName}>
          {chain.chain}
          <span className={styles.chainAssetCount}> · {chain.assets.length} asset{chain.assets.length === 1 ? '' : 's'}</span>
        </span>
        <span className={styles.chainValue}>{fmtUsd(chain.valueUsd)}</span>
        <span className={styles.chainPct}>{pct.toFixed(1)}%</span>
        <div className={dStyles.propBarTrack} style={{ width: 90 }}>
          <div className={dStyles.propBarFill} style={{ width: `${pct}%` }} aria-hidden="true" />
        </div>
        <span className={styles.chainCaret} data-open={open || undefined}>
          <CaretDown size={16} />
        </span>
      </button>
      {open && (
        <div className={styles.assetTableWrap}>
          <table className={styles.assetTable}>
            <thead>
              <tr>
                <th>Asset</th>
                <th>Amount</th>
                <th>Value (USD)</th>
              </tr>
            </thead>
            <tbody>
              {chain.assets.length === 0 && (
                <tr><td colSpan={3} style={{ color: 'var(--summer-muted)', fontStyle: 'italic' }}>No assets on this chain.</td></tr>
              )}
              {chain.assets.map((a, i) => (
                <tr key={`${a.symbol}-${i}`}>
                  <td className={styles.assetSymbol}>{a.symbol}</td>
                  <td className={dStyles.mono}>{fmtAmount(a.amount)}</td>
                  <td className={dStyles.mono}>{fmtUsd(a.valueUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function TreasuryPage() {
  const { auth, clearToken } = useDashboardAuth();
  const apiFetch = useApiFetch(auth);

  const [org, setOrg]           = useState<OrgMe | null>(null);
  const [hasOrg, setHasOrg]     = useState(true);
  const [data, setData]         = useState<TreasuryData | null>(null);
  const [history, setHistory]   = useState<TreasuryHistory | null>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [loading, setLoading]   = useState(true);
  const [fetchErr, setFetchErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setFetchErr(null);
    try {
      // Resolve the org first — the treasury routes are org-scoped and
      // meaningless without one (same pattern as ../page.tsx).
      const orgRes = await apiFetch('/enterprise/orgs/me');

      if (orgRes.status === 401) {
        clearToken();
        return;
      }
      if (!orgRes.ok) {
        // No organisation yet — normal for a fresh account, not an error.
        setHasOrg(false);
        setLoading(false);
        return;
      }

      const orgData: OrgMe = await orgRes.json();
      setOrg(orgData);
      setHasOrg(true);

      const [treasuryRes, historyRes] = await Promise.all([
        apiFetch(`/enterprise/orgs/${orgData.id}/treasury`),
        apiFetch(`/enterprise/orgs/${orgData.id}/treasury/history?days=30`),
      ]);

      if (!treasuryRes.ok) {
        setFetchErr('Could not load treasury data. Please try again.');
        setLoading(false);
        return;
      }

      const treasuryPayload = await treasuryRes.json();
      const parsed: TreasuryData = {
        totalValueUsd: Number(treasuryPayload?.totalValueUsd ?? 0),
        chains: Array.isArray(treasuryPayload?.chains) ? treasuryPayload.chains : [],
        members: Array.isArray(treasuryPayload?.members) ? treasuryPayload.members : [],
        note: treasuryPayload?.note,
      };
      setData(parsed);

      if (historyRes.ok) {
        const historyPayload = await historyRes.json();
        setHistory({
          days: Number(historyPayload?.days ?? 30),
          series: Array.isArray(historyPayload?.series) ? historyPayload.series : [],
          derivedFrom: String(historyPayload?.derivedFrom ?? 'swap-flow'),
        });
      } else {
        // History is supplementary — a failed history call shouldn't block
        // the rest of the page, just leaves the chart empty.
        setHistory({ days: 30, series: [], derivedFrom: 'swap-flow' });
      }

      setLoadedAt(new Date());
    } catch (e) {
      setFetchErr('Could not load treasury data. Check your connection.');
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [apiFetch, clearToken]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await load();
      void cancelled;
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiFetch]);

  // ── Loading ──
  if (loading) {
    return (
      <div aria-busy="true" aria-live="polite">
        <span className="sr-only">Loading treasury</span>
        <div className={dStyles.kpiPrimary} aria-hidden="true">
          <div className={`${dStyles.kpiHero} ${dStyles.skel}`}>
            <div className={dStyles.skelLine} style={{ width: '38%' }} />
            <div className={dStyles.skelLine} style={{ width: '62%', height: 34 }} />
            <div className={dStyles.skelLine} style={{ width: '30%' }} />
          </div>
          <div className={`${dStyles.kpiHero} ${dStyles.skel}`}>
            <div className={dStyles.skelLine} style={{ width: '30%' }} />
            <div className={dStyles.skelLine} style={{ width: '46%', height: 34 }} />
            <div className={dStyles.skelLine} style={{ width: '52%' }} />
          </div>
        </div>
        <div className={`${dStyles.card} ${dStyles.skel}`} aria-hidden="true">
          <div className={dStyles.skelLine} style={{ width: '22%' }} />
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
        <span>Create a workspace to see your treasury.</span>
        <Link href="/dashboard" className={dStyles.actionBtn}>Go to Overview</Link>
      </div>
    );
  }

  // ── Error ──
  if (fetchErr || !data) {
    return (
      <div className={dStyles.stateBox} role="alert">
        <span>{fetchErr ?? 'Unexpected error.'}</span>
        <button className={dStyles.actionBtn} onClick={() => load()}>Retry</button>
      </div>
    );
  }

  const { totalValueUsd, chains, members, note } = data;
  const isEmpty = chains.length === 0 && totalValueUsd === 0;
  const sortedMembers = [...members].sort((a, b) => b.valueUsd - a.valueUsd);
  const sortedChains  = [...chains].sort((a, b) => b.valueUsd - a.valueUsd);

  return (
    <>
      {/* ── Header ── */}
      <div className={dStyles.kpiPrimary}>
        <div className={dStyles.kpiHero}>
          <p className={dStyles.kpiLabel}>Total portfolio value</p>
          <span className={dStyles.kpiHeroValue}>{fmtUsd(totalValueUsd)}</span>
          <span className={dStyles.kpiHeroMeta}>
            {org?.name ?? 'Your workspace'} · {chains.length} chain{chains.length === 1 ? '' : 's'}
          </span>
        </div>
        <div className={dStyles.kpiHero}>
          <p className={dStyles.kpiLabel}>Last updated</p>
          <span className={dStyles.kpiHeroValue} style={{ fontSize: '1.3rem' }}>{fmtTime(loadedAt)}</span>
          <span className={dStyles.kpiHeroMeta}>Live snapshot across custodied wallets</span>
        </div>
      </div>

      {isEmpty ? (
        <div className={dStyles.stateBox}>
          <span>{note ?? 'No wallets are linked to this workspace yet — treasury value will appear here once your team holds balances.'}</span>
        </div>
      ) : (
        <>
          {/* ── 30d chart ── */}
          <section className={dStyles.card} aria-label="30-day portfolio value">
            <div className={dStyles.cardHead}>
              <h2 className={dStyles.cardTitle}>30-Day Portfolio Value</h2>
              <span className={dStyles.kicker}>{history?.days ?? 30}D</span>
            </div>
            <div className={dStyles.chartWrap}>
              <TreasuryChart series={history?.series ?? []} />
            </div>
            <p className={styles.chartCaption}>
              Derived from swap flow — a reconstructed value series, not a direct historical balance snapshot.
            </p>
          </section>

          {/* ── Chain breakdown ── */}
          <section className={dStyles.card} aria-label="Chain breakdown">
            <div className={dStyles.cardHead}>
              <h2 className={dStyles.cardTitle}>Chains</h2>
            </div>
            <div className={styles.chainList}>
              {sortedChains.map((c) => (
                <ChainRow key={c.chain} chain={c} totalValueUsd={totalValueUsd} />
              ))}
            </div>
          </section>

          {/* ── Per-member value ── */}
          <section className={dStyles.card} aria-label="Value by member">
            <div className={dStyles.cardHead}>
              <h2 className={dStyles.cardTitle}>By Member</h2>
            </div>
            <table className={dStyles.table}>
              <thead>
                <tr>
                  <th>Member</th>
                  <th style={{ textAlign: 'right' }}>Value</th>
                  <th style={{ textAlign: 'right' }}>% of total</th>
                </tr>
              </thead>
              <tbody>
                {sortedMembers.length === 0 && (
                  <tr>
                    <td colSpan={3} style={{ color: 'var(--summer-muted)', fontStyle: 'italic' }}>
                      No member balances found.
                    </td>
                  </tr>
                )}
                {sortedMembers.map((m) => {
                  const pct = totalValueUsd > 0 ? (m.valueUsd / totalValueUsd) * 100 : 0;
                  return (
                    <tr key={m.userId}>
                      <td className={dStyles.mono}>{shortId(m.userId)}</td>
                      <td className={dStyles.mono} style={{ textAlign: 'right' }}>{fmtUsd(m.valueUsd)}</td>
                      <td className={dStyles.mono} style={{ textAlign: 'right', color: 'var(--summer-muted)' }}>
                        {pct.toFixed(1)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        </>
      )}
    </>
  );
}
