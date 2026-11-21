'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { callApi, type CallResult } from './api';
import { getStoredKey, useApiKey } from './keyStore';
import { useLiveSlug } from './ApiKeyProvider';
import KeyBar from './KeyBar';
import { ErrorBox, Json, ResultMeta } from './ui';
import { track } from '@/lib/analytics';
import './live.css';

type Billing = { tier?: string; is_metered?: boolean; credits?: { balance?: number; lifetime_purchased?: number; lifetime_used?: number }; credit_usd_value?: number; cost_weights?: Record<string, number> };
type Me = { agent?: { rate_limit_tier?: string; created_at?: string; last_active_at?: string | null; stats?: { total_requests?: number; total_swaps?: number } } };
const CALLS = [['quote', 'Quotes'], ['swap/simulate', 'Dry runs'], ['prices', 'Price reads'], ['portfolio', 'Portfolio reads']] as const;

/** Live balance + usage for the visitor's key, and a calculator driven by the API's own cost_weights. */
export default function BillingPanel() {
  const slug = useLiveSlug();
  const { key } = useApiKey();
  const [bill, setBill] = useState<CallResult | null>(null);
  const [me, setMe] = useState<CallResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [calls, setCalls] = useState<Record<string, number>>({ quote: 200, 'swap/simulate': 20, prices: 100, portfolio: 10 });
  const lock = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!key || lock.current === key) return;
    lock.current = key; setBusy(true);
    const [b, m] = await Promise.all([callApi({ path: '/v1/agent/billing', key, refresh: false }), callApi({ path: '/v1/agent/me', key, refresh: false })]);
    if (getStoredKey() !== key) { if (lock.current === key) lock.current = null; return; } // key changed mid-flight: drop this answer
    setBill(b); setMe(m); setBusy(false); lock.current = null;
    track('widget_run', { slug, widget: 'billing_read', outcome: b.ok ? 'ok' : String(b.status) });
  }, [key, slug]);
  useEffect(() => { setBill(null); setMe(null); setBusy(false); if (key) void load(); }, [key, load]);

  const b = bill?.ok ? (bill.data as Billing) : null;
  const a = me?.ok ? (me.data as Me).agent : null;
  const weights = b?.cost_weights ?? { quote: 1, 'swap/simulate': 1, prices: 1, portfolio: 1 };
  const usd = b?.credit_usd_value ?? 0.001;
  const perDay = CALLS.reduce((n, [id]) => n + (calls[id] || 0) * (weights[id] ?? 0), 0);
  const balance = b?.credits?.balance;
  const unmetered = b?.is_metered === false;

  return (
    <div className="lv lv-stack">
      <KeyBar compact />
      <section className="lv-panel" aria-live="polite" aria-busy={busy}>
        <h3>Balance and usage</h3>
        {!key && <p className="lv-empty">Add a key above to read its live balance. Reading it costs 0 credits.</p>}
        {key && busy && !bill && <div className="lv-loading"><i /><i /><i /></div>}
        {bill && !bill.ok && <ErrorBox r={bill} onRetry={load} />}
        {b && (
          <>
            <dl className="lv-kv lv-kv--hero">
              <div><dt>Balance</dt><dd>{balance} credits</dd></div>
              <div><dt>Worth</dt><dd>${((balance ?? 0) * usd).toFixed(2)}</dd></div>
              <div><dt>Used so far</dt><dd>{b.credits?.lifetime_used}</dd></div>
              <div><dt>Granted or bought</dt><dd>{b.credits?.lifetime_purchased}</dd></div>
              <div><dt>Plan</dt><dd>{b.tier}</dd></div>
              {a?.stats && <div><dt>Requests / swaps</dt><dd>{a.stats.total_requests} / {a.stats.total_swaps}</dd></div>}
            </dl>
            {bill && <ResultMeta r={bill} />}
            <Json data={{ billing: bill?.data, me: me?.data }} label="Raw billing and profile JSON" />
          </>
        )}
        {key && <div className="lv-actions"><button type="button" className="lv-btn lv-btn--ghost" onClick={load} disabled={busy}>Refresh</button></div>}
      </section>
      <section className="lv-panel">
        <h3>What will my workload cost?</h3>
        <p className="lv-note" style={{ margin: '0 0 .8rem' }}>Costs per call come from {b ? 'your key’s live /billing response' : 'the published cost table (1 credit per quote, dry run, price read and portfolio read)'}. 1 credit = ${usd}.</p>
        <div className="lv-grid">
          {CALLS.map(([id, label]) => (
            <div className="lv-field" key={id}>
              <label className="lv-label" htmlFor={`lv-c-${id}`}>{label} per day <span className="lv-hint">({weights[id] ?? 0} cr each)</span></label>
              <input id={`lv-c-${id}`} className="lv-input" inputMode="numeric" value={calls[id]} onChange={(e) => setCalls({ ...calls, [id]: Math.max(0, Math.floor(Number(e.target.value.replace(/\D/g, '')) || 0)) })} />
            </div>
          ))}
        </div>
        <dl className="lv-kv lv-kv--hero" style={{ marginTop: '1rem' }}>
          <div><dt>Credits per day</dt><dd>{perDay.toLocaleString()}</dd></div>
          <div><dt>Per 30 days</dt><dd>{(perDay * 30).toLocaleString()} cr</dd></div>
          <div><dt>Cost per 30 days</dt><dd>${(perDay * 30 * usd).toFixed(2)}</dd></div>
          {unmetered ? <div><dt>Your plan</dt><dd>This plan is not metered</dd></div> : balance !== undefined && <div><dt>Your balance lasts</dt><dd>{perDay > 0 ? `${(balance / perDay).toFixed(1)} days` : 'indefinitely'}</dd></div>}
        </dl>
        <p className="lv-note">Swaps and executions cost more and are not callable from this page. Subscriptions give unmetered access; see the plans on this page.</p>
      </section>
    </div>
  );
}
