'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { callApi, type CallResult } from './api';
import { useApiKey } from './keyStore';
import { useLiveSlug } from './ApiKeyProvider';
import KeyBar from './KeyBar';
import { ErrorBox } from './ui';
import { validateParam, PARAMS } from './allowlist';
import { track } from '@/lib/analytics';
import './live.css';

/**
 * Read-only live market panels. Every number is read from the production API at
 * the stamped time; nothing is cached, seeded or mocked. Perps, predictions and
 * the autopilot list are keyless; prices needs the visitor's key (1 credit).
 */
type Col<R> = { id: string; label: string; num?: boolean; value: (r: R) => string | number | null; render?: (r: R) => React.ReactNode };

const usd = (n: number | null | undefined, max = 4) =>
  typeof n === 'number' && Number.isFinite(n)
    ? n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: n >= 1000 ? 0 : n >= 1 ? 2 : max })
    : '—';
const pct = (n: number | null | undefined, d = 1) => (typeof n === 'number' && Number.isFinite(n) ? `${(n * 100).toFixed(d)}%` : '—');
const clock = (d: Date) => d.toLocaleTimeString('en-GB', { hour12: false });

function DataTable<R>({ rows, cols, rowKey, label, initialSort }: { rows: R[]; cols: Col<R>[]; rowKey: (r: R) => string; label: string; initialSort: { id: string; dir: 1 | -1 } }) {
  const [sort, setSort] = useState(initialSort);
  const sorted = useMemo(() => {
    const c = cols.find((x) => x.id === sort.id);
    if (!c) return rows;
    return [...rows].sort((a, b) => {
      const x = c.value(a), y = c.value(b);
      if (x === null && y === null) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * sort.dir;
    });
  }, [rows, cols, sort]);
  return (
    <div className="lv-dscroll" role="region" aria-label={label} tabIndex={0}>
      <table className="lv-dtable">
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c.id} scope="col" className={c.num ? 'is-num' : undefined} aria-sort={sort.id === c.id ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
                <button type="button" onClick={() => setSort((s) => (s.id === c.id ? { id: c.id, dir: (s.dir * -1) as 1 | -1 } : { id: c.id, dir: c.num ? -1 : 1 }))}>
                  {c.label}<span aria-hidden="true">{sort.id === c.id ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}</span>
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={rowKey(r)}>{cols.map((c) => <td key={c.id} className={c.num ? 'is-num' : undefined}>{c.render ? c.render(r) : (c.value(r) ?? '—')}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Shared shell: fetch on mount, search, refresh, stamp, loading/empty/error. */
function Feed<R>({ widget, title, path, pick, cols, search, rowKey, initialSort, searchLabel, note, noun }: {
  widget: string; title: string; path: string; pick: (d: unknown) => R[] | null; cols: Col<R>[]; search: (r: R) => string;
  rowKey: (r: R) => string; initialSort: { id: string; dir: 1 | -1 }; searchLabel: string; note?: React.ReactNode; noun: string;
}) {
  const slug = useLiveSlug();
  const [rows, setRows] = useState<R[] | null>(null);
  const [err, setErr] = useState<CallResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [at, setAt] = useState<Date | null>(null);
  const [q, setQ] = useState('');
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true); setErr(null);
    const r = await callApi({ path, refresh: false });
    if (mine !== seq.current) return;
    const list = r.ok ? pick(r.data) : null;
    if (list) { setRows(list); setAt(new Date()); } else setErr(r.ok ? { ...r, ok: false, error: 'The API answered with an unexpected shape.' } : r);
    track('widget_run', { slug, widget, outcome: list ? 'ok' : r.status === 0 ? 'network' : String(r.status) });
    setLoading(false);
  }, [path, pick, slug, widget]);
  useEffect(() => { void load(); }, [load]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (rows ?? []).filter((r) => !s || search(r).toLowerCase().includes(s));
  }, [rows, q, search]);

  const id = `lv-q-${widget}`;
  return (
    <section className="lv-panel" aria-busy={loading}>
      <h3>{title}</h3>
      <div className="lv-dbar">
        <div className="lv-field">
          <label className="lv-label" htmlFor={id}>{searchLabel}</label>
          <input id={id} className="lv-input" type="search" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" disabled={!rows} />
        </div>
        <button type="button" className="lv-btn lv-btn--ghost" onClick={() => void load()} disabled={loading}>{loading ? 'Reading…' : 'Refresh'}</button>
      </div>
      <p className="lv-note" role="status">
        {at ? <>Read live at <strong>{clock(at)}</strong> from api.suwappu.bot. {rows ? `${shown.length} of ${rows.length} ${noun} shown.` : ''} Free, no key needed.</> : loading ? 'Reading from api.suwappu.bot…' : ''}
      </p>
      {note}
      {loading && !rows && <div className="lv-loading" aria-label="Loading"><i /><i /><i /></div>}
      {err && <ErrorBox r={err} onRetry={() => void load()} />}
      {rows && rows.length === 0 && !err && <p className="lv-empty">The API returned no {noun} right now.</p>}
      {rows && rows.length > 0 && shown.length === 0 && <p className="lv-empty">No {noun} match “{q}”.</p>}
      {rows && shown.length > 0 && <DataTable rows={shown} cols={cols} rowKey={rowKey} label={title} initialSort={initialSort} />}
    </section>
  );
}

type Perp = { name: string; asset?: string; markPrice?: number; maxLeverage?: number; venueMaxLeverage?: number; fundingRate?: number };
const perpCols: Col<Perp>[] = [
  { id: 'name', label: 'Market', value: (r) => r.name, render: (r) => <code>{r.name}</code> },
  { id: 'mark', label: 'Mark price', num: true, value: (r) => r.markPrice ?? null, render: (r) => usd(r.markPrice, 5) },
  { id: 'lev', label: 'Max leverage', num: true, value: (r) => r.maxLeverage ?? null, render: (r) => (r.maxLeverage ? `${r.maxLeverage}x` : '—') },
  { id: 'fund', label: 'Funding / hr', num: true, value: (r) => r.fundingRate ?? null, render: (r) => (typeof r.fundingRate === 'number' ? pct(r.fundingRate, 4) : '—') },
];
const pickPerps = (d: unknown) => { const m = (d as { markets?: unknown } | null)?.markets; return Array.isArray(m) ? (m as Perp[]) : null; };
const perpSearch = (r: Perp) => `${r.name} ${r.asset ?? ''}`;
const perpKey = (r: Perp) => r.name;
export function PerpsLive() {
  return <Feed<Perp> widget="perps_markets_live" title="Live perpetual markets" path="/v1/agent/perps/markets" pick={pickPerps} cols={perpCols} search={perpSearch} rowKey={perpKey}
    initialSort={{ id: 'name', dir: 1 }} searchLabel="Search markets" noun="markets" note={<p className="lv-note">Max leverage is the cap Suwappu enforces, which can sit below the venue maximum.</p>} />;
}

type Pred = { id: string; question: string; outcomes?: string[]; outcomePrices?: number[]; volume?: number; liquidity?: number; endDate?: string };
const predCols: Col<Pred>[] = [
  { id: 'q', label: 'Market', value: (r) => r.question, render: (r) => <span className="lv-dq">{r.question}</span> },
  { id: 'odds', label: 'Outcomes', value: (r) => r.outcomePrices?.[0] ?? null, render: (r) => (r.outcomes?.length ? <span className="lv-dodds">{r.outcomes.map((o, i) => <span key={o}>{o} <strong>{pct(r.outcomePrices?.[i], 0)}</strong></span>)}</span> : '—') },
  { id: 'vol', label: 'Volume', num: true, value: (r) => r.volume ?? null, render: (r) => usd(r.volume, 0) },
  { id: 'liq', label: 'Liquidity', num: true, value: (r) => r.liquidity ?? null, render: (r) => usd(r.liquidity, 0) },
  { id: 'end', label: 'Ends (UTC)', value: (r) => r.endDate ?? null, render: (r) => (r.endDate ? r.endDate.slice(0, 16).replace('T', ' ') : '—') },
];
const pickPred = (d: unknown) => { const m = (d as { markets?: unknown } | null)?.markets; return Array.isArray(m) ? (m as Pred[]) : null; };
const predSearch = (r: Pred) => `${r.question} ${(r.outcomes ?? []).join(' ')}`;
const predKey = (r: Pred) => r.id;
export function PredictLive() {
  return <Feed<Pred> widget="predict_markets_live" title="Live prediction markets" path="/v1/agent/predict/markets" pick={pickPred} cols={predCols} search={predSearch} rowKey={predKey}
    initialSort={{ id: 'vol', dir: -1 }} searchLabel="Search questions" noun="markets" note={<p className="lv-note">Probabilities are the outcome prices the venue quotes right now. Read-only: trading happens through the API with your own key.</p>} />;
}

type Agent = { slug: string; name: string; description?: string; mode?: string; status?: string; chain?: string; equity_usd?: number; starting_equity_usd?: number; pnl_usd?: number; open_positions?: number; last_cycle_at?: string | null };
const agentCols: Col<Agent>[] = [
  { id: 'name', label: 'Agent', value: (r) => r.name, render: (r) => <><strong>{r.name}</strong>{r.description && <span className="lv-dsub">{r.description}</span>}</> },
  { id: 'mode', label: 'Mode', value: (r) => r.mode ?? null, render: (r) => <span className="lv-dtag">{r.mode === 'paper' ? 'Paper' : r.mode ?? '—'}</span> },
  { id: 'status', label: 'Status', value: (r) => r.status ?? null },
  { id: 'chain', label: 'Chain', value: (r) => r.chain ?? null },
  { id: 'eq', label: 'Equity', num: true, value: (r) => r.equity_usd ?? null, render: (r) => usd(r.equity_usd) },
  { id: 'pnl', label: 'P&L', num: true, value: (r) => r.pnl_usd ?? null, render: (r) => usd(r.pnl_usd) },
  { id: 'pos', label: 'Open', num: true, value: (r) => r.open_positions ?? null },
  { id: 'last', label: 'Last cycle (UTC)', value: (r) => r.last_cycle_at ?? null, render: (r) => (r.last_cycle_at ? r.last_cycle_at.slice(0, 16).replace('T', ' ') : '—') },
];
// The panel's disclaimer says "paper only, no real funds at risk", so only
// agents the API marks as paper may appear under it. Anything else is dropped.
const pickAgents = (d: unknown) => { const m = (d as { agents?: unknown } | null)?.agents; return Array.isArray(m) ? (m as Agent[]).filter((a) => a?.mode === 'paper') : null; };
const agentSearch = (r: Agent) => `${r.name} ${r.description ?? ''} ${r.chain ?? ''}`;
const agentKey = (r: Agent) => r.slug;
export function AutopilotLive() {
  return <Feed<Agent> widget="autopilot_agents_live" title="Live paper agents" path="/v1/autopilot" pick={pickAgents} cols={agentCols} search={agentSearch} rowKey={agentKey}
    initialSort={{ id: 'name', dir: 1 }} searchLabel="Search agents" noun="agents" note={<p className="lv-note"><strong>Paper trading only.</strong> Equity and P&amp;L are simulated; no real funds are at risk and no track record is implied.</p>} />;
}

/** Prices: keyed and metered (1 credit per lookup), so it runs on click, never on load. */
export function PricesLive() {
  const slug = useLiveSlug();
  const { key, hydrated } = useApiKey();
  const spec = PARAMS['GET /v1/agent/prices'][0];
  const [symbols, setSymbols] = useState('ETH,SOL,BTC');
  const [verr, setVerr] = useState<string | null>(null);
  const [res, setRes] = useState<{ prices: Record<string, { usd?: number; change_24h?: number }>; unknown: string[] } | null>(null);
  const [err, setErr] = useState<CallResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [at, setAt] = useState<Date | null>(null);

  // One lookup at a time from every entry point (button, Enter, key repeat):
  // each request costs a credit, so a held key must not fan out.
  const inflight = useRef(false);
  const run = async () => {
    if (inflight.current) return;
    const v = validateParam(spec, symbols);
    setVerr(v);
    if (v || !key) return;
    inflight.current = true;
    setBusy(true); setErr(null);
    const list = symbols.split(',').map((s) => s.trim()).filter(Boolean).join(',');
    const r = await callApi({ path: `/v1/agent/prices?symbols=${encodeURIComponent(list)}`, key });
    const d = r.data as { prices?: Record<string, { usd?: number; change_24h?: number }>; unknown_symbols?: string[] } | null;
    if (r.ok && d?.prices) { setRes({ prices: d.prices, unknown: d.unknown_symbols ?? [] }); setAt(new Date()); } else setErr(r);
    track('widget_run', { slug, widget: 'prices_live', outcome: r.ok ? 'ok' : r.status === 0 ? 'network' : String(r.status) });
    setBusy(false);
    inflight.current = false;
  };
  const rows = res ? Object.entries(res.prices).map(([sym, p]) => ({ sym, ...p })) : [];
  const cols: Col<{ sym: string; usd?: number; change_24h?: number }>[] = [
    { id: 'sym', label: 'Symbol', value: (r) => r.sym, render: (r) => <code>{r.sym}</code> },
    { id: 'usd', label: 'Price (USD)', num: true, value: (r) => r.usd ?? null, render: (r) => usd(r.usd, 6) },
    { id: 'chg', label: '24h', num: true, value: (r) => r.change_24h ?? null, render: (r) => (typeof r.change_24h === 'number' ? `${r.change_24h >= 0 ? '+' : ''}${r.change_24h.toFixed(2)}%` : '—') },
  ];
  return (
    <section className="lv-panel" aria-busy={busy}>
      <h3>Live price lookup</h3>
      {hydrated && <KeyBar compact />}
      <div className="lv-dbar">
        <div className="lv-field">
          <label className="lv-label" htmlFor="lv-q-prices">{spec.label}</label>
          <input id="lv-q-prices" className="lv-input lv-input--mono" value={symbols} onChange={(e) => setSymbols(e.target.value)} placeholder={spec.placeholder} autoComplete="off" spellCheck={false}
            aria-invalid={verr ? true : undefined} aria-describedby={verr ? 'lv-prices-err' : undefined} onKeyDown={(e) => { if (e.key === 'Enter' && !e.repeat) void run(); }} />
        </div>
        <button type="button" className="lv-btn lv-btn--primary" onClick={() => void run()} disabled={busy || !hydrated || !key}>{busy ? 'Reading…' : 'Look up prices'}</button>
      </div>
      {verr && <p id="lv-prices-err" className="lv-note" role="alert" style={{ color: '#9a2b1a' }}>{verr}</p>}
      <p className="lv-note" role="status">
        <span className="lv-cost"><strong>Costs 1 credit</strong> per lookup, whatever the number of symbols.</span>{' '}
        {at && <>Read live at <strong>{clock(at)}</strong>.</>}
        {!key && hydrated && ' Add a key above to run it.'}
      </p>
      {err && <ErrorBox r={err} onRetry={() => void run()} />}
      {res && rows.length === 0 && <p className="lv-empty">No prices came back{res.unknown.length ? ` — unknown symbols: ${res.unknown.join(', ')}` : ''}.</p>}
      {res && rows.length > 0 && <DataTable rows={rows} cols={cols} rowKey={(r) => r.sym} label="Live prices" initialSort={{ id: 'sym', dir: 1 }} />}
      {res && res.unknown.length > 0 && rows.length > 0 && <p className="lv-note">Not recognised by the API: {res.unknown.join(', ')}.</p>}
    </section>
  );
}
