'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Field, FieldControl, FieldLabel } from '@ui-sdk/react/field';
import { Tabs, TabsList, TabsPanel, TabsTab } from '@ui-sdk/react/tabs';
import { track } from '@/lib/analytics';
import { callApi, type CallResult } from './api';
import { getStoredKey, isAmount, useApiKey } from './keyStore';
import { useLiveSlug } from './ApiKeyProvider';
import KeyBar from './KeyBar';
import { CopyBtn, ErrorBox, Json, ResultMeta } from './ui';
import { curlSnippet, pySnippet, tsSnippet } from './snippets';
import { CREDIT_COST } from './allowlist';
import './live.css';

type Chain = { key: string; name: string };
type Quote = {
  quote_id?: string; from_chain?: string; to_chain?: string; from_token?: { symbol: string }; to_token?: { symbol: string; decimals?: number };
  amount_in?: string; amount_out?: string; amount_out_min?: string; exchange_rate?: string; price_impact?: string;
  estimated_gas_usd?: string; bridge_fee_usd?: string; route?: string; slippage?: string; estimated_time_seconds?: number;
  expires_in_seconds?: number; dex?: string; sign_url?: string;
};
type Sim = {
  would_execute?: boolean; expected_output?: { token?: string; amount?: string; amount_usd?: string }; min_output_after_slippage?: string;
  price_impact_pct?: number; fees?: Record<string, string>; checks?: { name: string; status: string; detail?: string }[]; warnings?: string[];
};
const ADDR = /^0x[0-9a-fA-F]{40}$/;

/** raw integer string -> decimal string using the token's decimals (display only). */
function fromRaw(raw: string | undefined, decimals?: number): string {
  if (!raw || !/^\d+$/.test(raw) || decimals === undefined) return raw ?? '';
  const s = raw.padStart(decimals + 1, '0');
  const whole = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, '').slice(0, 8);
  return frac ? `${whole}.${frac}` : whole;
}

export default function LiveConsole({ compact = false }: { compact?: boolean }) {
  const slug = useLiveSlug();
  const { key } = useApiKey();
  const [chains, setChains] = useState<Chain[] | null>(null);
  const [chainErr, setChainErr] = useState<CallResult | null>(null);
  const [from, setFrom] = useState('USDC');
  const [to, setTo] = useState('ETH');
  const [amount, setAmount] = useState('10');
  const [chain, setChain] = useState('base');
  const [toChain, setToChain] = useState('');
  const [wallet, setWallet] = useState('');
  const [busy, setBusy] = useState<null | 'quote' | 'sim'>(null);
  const [quote, setQuote] = useState<{ r: CallResult; body: Record<string, unknown>; at: number } | null>(null);
  const [sim, setSim] = useState<{ r: CallResult; body: Record<string, unknown> } | null>(null);
  const [left, setLeft] = useState(0);
  const [formErr, setFormErr] = useState<string | null>(null);
  const lock = useRef(false);

  const loadChains = useCallback(async () => {
    setChainErr(null);
    const r = await callApi({ path: '/v1/agent/chains' });
    const list = (r.data as { chains?: Chain[] } | null)?.chains;
    if (r.ok && Array.isArray(list)) setChains(list); else setChainErr(r);
  }, []);
  useEffect(() => { void loadChains(); }, [loadChains]);

  // 60 s expiry countdown from the moment the quote arrived.
  useEffect(() => {
    if (!quote?.r.ok) return;
    const ttl = (quote.r.data as Quote).expires_in_seconds ?? 60;
    const tick = () => setLeft(Math.max(0, Math.ceil(ttl - (Date.now() - quote.at) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [quote]);

  function buildBody(): Record<string, unknown> | null {
    if (!from.trim() || !to.trim()) { setFormErr('Enter a from token and a to token.'); return null; }
    if (!isAmount(amount)) { setFormErr('Amount must be a positive number in human units, e.g. 10.'); return null; }
    if (wallet.trim() && !ADDR.test(wallet.trim())) { setFormErr('Wallet address must be a 0x… EVM address (42 characters).'); return null; }
    setFormErr(null);
    const crossChain = toChain && toChain !== chain;
    return {
      from_token: from.trim(), to_token: to.trim(), amount: amount.trim(),
      ...(crossChain ? { from_chain: chain, to_chain: toChain } : { chain }),
      ...(wallet.trim() ? { wallet_address: wallet.trim() } : {}),
    };
  }

  async function run(kind: 'quote' | 'sim') {
    if (lock.current) return;
    const body = buildBody();
    if (!body) return;
    const k = getStoredKey();
    if (!k) { setFormErr('Add a key above first. It is free and takes one click.'); return; }
    lock.current = true; setBusy(kind);
    const path = kind === 'quote' ? '/v1/agent/quote' : '/v1/agent/swap/simulate';
    const r = await callApi({ method: 'POST', path, body, key: k });
    if (kind === 'quote') { setQuote({ r, body, at: Date.now() }); setSim(null); } else setSim({ r, body });
    track('widget_run', { slug, widget: kind === 'quote' ? 'live_quote' : 'live_simulate', outcome: r.ok ? 'ok' : r.status === 0 ? 'network' : String(r.status) });
    lock.current = false; setBusy(null);
  }

  const q = quote?.r.ok ? (quote.r.data as Quote) : null;
  const s = sim?.r.ok ? (sim.r.data as Sim) : null;
  const shown = sim ?? quote;
  const lastPath = sim ? '/v1/agent/swap/simulate' : '/v1/agent/quote';
  const decimals = q?.to_token?.decimals;
  const cost = CREDIT_COST['POST /v1/agent/quote'];
  const expired = Boolean(q && left <= 0);

  return (
    <div className={`lv lv-stack${compact ? ' lv--compact' : ''}`}>
      <KeyBar compact={compact} />
      <form className="lv-panel" onSubmit={(e) => { e.preventDefault(); void run('quote'); }} noValidate>
        <h3>Quote a swap</h3>
        <div className="lv-grid">
          <Field name="from" className="lv-field"><FieldLabel className="lv-label">From token</FieldLabel>
            <FieldControl className="lv-input" value={from} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFrom(e.target.value)} list="lv-tokens" autoComplete="off" spellCheck={false} placeholder="USDC" /></Field>
          <Field name="to" className="lv-field"><FieldLabel className="lv-label">To token</FieldLabel>
            <FieldControl className="lv-input" value={to} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTo(e.target.value)} list="lv-tokens" autoComplete="off" spellCheck={false} placeholder="ETH" /></Field>
          <Field name="amount" className="lv-field"><FieldLabel className="lv-label">Amount (human units)</FieldLabel>
            <FieldControl className="lv-input" value={amount} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAmount(e.target.value)} inputMode="decimal" autoComplete="off" placeholder="10" /></Field>
          <div className="lv-field">
            <label className="lv-label" htmlFor="lv-chain">Chain{chains ? '' : ' (loading)'}</label>
            <select id="lv-chain" className="lv-select" value={chain} onChange={(e) => setChain(e.target.value)} disabled={!chains}>
              {(chains ?? [{ key: 'base', name: 'Base' }]).map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
            </select>
          </div>
        </div>
        <datalist id="lv-tokens">{['USDC', 'USDT', 'ETH', 'WETH', 'DAI', 'WBTC', 'SOL'].map((t) => <option key={t} value={t} />)}</datalist>
        <div className="lv-grid lv-grid--2" style={{ marginTop: '.85rem' }}>
          <div className="lv-field">
            <label className="lv-label" htmlFor="lv-tochain">To chain (optional, for cross-chain)</label>
            <select id="lv-tochain" className="lv-select" value={toChain} onChange={(e) => setToChain(e.target.value)} disabled={!chains}>
              <option value="">Same chain</option>
              {(chains ?? []).map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
            </select>
          </div>
          <Field name="wallet" className="lv-field"><FieldLabel className="lv-label">Wallet address (optional)</FieldLabel>
            <FieldControl className="lv-input lv-input--mono" value={wallet} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setWallet(e.target.value)} placeholder="0x…" autoComplete="off" spellCheck={false} />
            <span className="lv-hint">Needed for a dry run. A quote without one cannot be executed.</span></Field>
        </div>
        {chainErr && <div style={{ marginTop: '.85rem' }}><ErrorBox r={chainErr} onRetry={loadChains} /></div>}
        {formErr && <p className="lv-error-line" role="alert" style={{ marginTop: '.75rem' }}>{formErr}</p>}
        <div className="lv-actions">
          <button type="submit" className="lv-btn lv-btn--primary" disabled={busy !== null || !key}>{busy === 'quote' ? 'Quoting…' : 'Run live quote'}</button>
          <button type="button" className="lv-btn lv-btn--secondary" disabled={busy !== null || !key || !wallet.trim()} onClick={() => run('sim')} aria-describedby="lv-sim-why">{busy === 'sim' ? 'Simulating…' : 'Dry run'}</button>
          <span className="lv-cost">Costs <strong>{cost} credit</strong> per run{!key ? ' · add a key first' : ''}</span>
        </div>
        <p id="lv-sim-why" className="lv-note">{wallet.trim() ? 'Dry run simulates this swap for your wallet. It never signs or sends anything. Costs 1 credit.' : 'Dry run needs a wallet address: the simulation checks that wallet’s balance and allowance.'}</p>
      </form>

      <section className="lv-panel" aria-live="polite" aria-busy={busy !== null}>
        <h3>Result</h3>
        {busy && <div className="lv-loading" aria-label="Running"><i /><i /><i /></div>}
        {!busy && !shown && <p className="lv-empty">Nothing run yet. Press Run live quote to call the production API with your key. The response, route and the exact request appear here.</p>}
        {!busy && shown && !shown.r.ok && <ErrorBox r={shown.r} onRetry={() => run(sim ? 'sim' : 'quote')}>{shown.r.status === 401 ? <p>Your key was rejected. Create or paste a key above.</p> : shown.r.status === 402 ? <p>This key is out of credits.</p> : null}</ErrorBox>}
        {!busy && shown?.r.ok && <ResultMeta r={shown.r} />}
        {!busy && q && !sim && (
          <>
            <dl className="lv-kv lv-kv--hero">
              <div><dt>You receive (expected)</dt><dd>{q.amount_out} {q.to_token?.symbol}</dd></div>
              <div><dt>Minimum out</dt><dd>{q.amount_out_min} {q.to_token?.symbol}</dd></div>
              <div><dt>Route</dt><dd>{q.route ?? q.dex}</dd></div>
              <div><dt>Price impact</dt><dd>{q.price_impact}</dd></div>
              <div><dt>Fees</dt><dd>{[q.bridge_fee_usd && `${q.bridge_fee_usd} protocol`, q.estimated_gas_usd && `${q.estimated_gas_usd} gas`].filter(Boolean).join(' + ') || 'n/a'}</dd></div>
              <div><dt>Expires</dt><dd><span className={`lv-count${expired ? ' lv-count--out' : ''}`}>{expired ? 'Expired, run again' : `${left}s left`}</span></dd></div>
            </dl>
          </>
        )}
        {!busy && s && (
          <>
            <dl className="lv-kv lv-kv--hero">
              <div><dt>Expected out</dt><dd>{fromRaw(s.expected_output?.amount, decimals)} {s.expected_output?.token}{s.expected_output?.amount_usd ? ` (~$${s.expected_output.amount_usd})` : ''}</dd></div>
              <div><dt>Minimum out</dt><dd>{fromRaw(s.min_output_after_slippage, decimals)} {s.expected_output?.token}</dd></div>
              <div><dt>Price impact</dt><dd>{s.price_impact_pct}%</dd></div>
              <div><dt>Fees</dt><dd>{Object.entries(s.fees ?? {}).map(([k2, v]) => `${v} ${k2.replace('_', ' ')}`).join(' + ') || 'n/a'}</dd></div>
            </dl>
            {s.checks && (
              <ul className="lv-checks" aria-label="Simulation checks">
                {s.checks.map((c) => <li key={c.name} className={`is-${c.status}`}><b>{c.status}</b><span><strong>{c.name.replace(/_/g, ' ')}</strong>{c.detail ? `: ${c.detail}` : ''}</span></li>)}
              </ul>
            )}
          </>
        )}
        {!busy && shown && shown.r.data != null && <Json data={shown.r.data} />}
        {!busy && shown && (
          <div style={{ marginTop: '1rem' }}>
            <p className="lv-label" style={{ margin: '0 0 .5rem' }}>The exact request that just ran</p>
            <Tabs defaultValue="curl" className="lv-tabs">
              <TabsList aria-label="Language">
                <TabsTab value="curl">curl</TabsTab><TabsTab value="ts">TypeScript</TabsTab><TabsTab value="py">Python</TabsTab>
              </TabsList>
              {([['curl', curlSnippet], ['ts', tsSnippet], ['py', pySnippet]] as const).map(([id, fn]) => {
                const code = fn('POST', lastPath, shown.body);
                return (
                  <TabsPanel key={id} value={id}>
                    <div className="lv-codewrap"><pre className="lv-pre" tabIndex={0}>{code}</pre><CopyBtn text={code} slug={slug} what={`request_${id}`} /></div>
                  </TabsPanel>
                );
              })}
            </Tabs>
          </div>
        )}
      </section>
    </div>
  );
}
