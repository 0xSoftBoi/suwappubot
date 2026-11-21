'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Field, FieldControl, FieldLabel } from '@ui-sdk/react/field';
import { Tabs, TabsList, TabsPanel, TabsTab } from '@ui-sdk/react/tabs';
import { track } from '@/lib/analytics';
import { callApi, type CallResult } from './api';
import { getKeyReady, isAmount, useApiKey } from './keyStore';
import { useLiveSlug } from './ApiKeyProvider';
import KeyBar from './KeyBar';
import { CopyBtn, ErrorBox, Json, ResultMeta } from './ui';
import { curlSnippet, pySnippet, tsSnippet } from './snippets';
import { CREDIT_COST } from './allowlist';
import './live.css';

type Chain = { key: string; name: string; type?: string };
type Quote = {
  quote_id?: string; from_chain?: string; to_chain?: string; from_token?: { symbol: string }; to_token?: { symbol: string; decimals?: number };
  amount_in?: string; amount_out?: string; amount_out_min?: string; exchange_rate?: string; price_impact?: string;
  estimated_gas_usd?: string; bridge_fee_usd?: string; route?: string; slippage?: string; estimated_time_seconds?: number;
  expires_in_seconds?: number; dex?: string; sign_url?: string;
};
type Sim = {
  quote_id?: string; would_execute?: boolean; expected_output?: { token?: string; amount?: string; amount_usd?: string }; min_output_after_slippage?: string;
  price_impact_pct?: number; fees?: Record<string, string>; checks?: { name: string; status: string; detail?: string }[]; warnings?: string[];
};
const ADDR = /^0x[0-9a-fA-F]{40}$/;
const SOL_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
/** The quote route handles EVM and Solana; Sui, TON and the rest are rejected by it. */
const QUOTABLE = new Set(['evm', 'solana']);

/** raw integer string -> decimal string using the token's decimals; without trusted decimals the integer is labelled, never scaled. */
function fromRaw(raw: string | undefined, decimals?: number): string {
  if (!raw) return '';
  if (!/^\d+$/.test(raw)) return raw;
  if (decimals === undefined) return `${raw} base units`;
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
  const [quote, setQuote] = useState<{ r: CallResult; body: Record<string, unknown>; at: number; hash: string } | null>(null);
  const [sim, setSim] = useState<{ r: CallResult; body: Record<string, unknown>; hash: string; decimals?: number; quoteId?: string } | null>(null);
  const [left, setLeft] = useState(0);
  const [formErr, setFormErr] = useState<string | null>(null);
  const lock = useRef(false);

  const loadChains = useCallback(async () => {
    setChainErr(null);
    const r = await callApi({ path: '/v1/agent/chains' });
    const list = (r.data as { chains?: Chain[] } | null)?.chains;
    if (r.ok && Array.isArray(list)) setChains(list.filter((c) => !c.type || QUOTABLE.has(c.type))); else setChainErr(r);
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
    const sol = chains?.find((c) => c.key === chain)?.type === 'solana';
    if (wallet.trim() && !(sol ? SOL_ADDR : ADDR).test(wallet.trim())) { setFormErr(sol ? 'Wallet address must be a Solana address (base58, 32-44 characters).' : 'Wallet address must be a 0x… EVM address (42 characters).'); return null; }
    setFormErr(null);
    const crossChain = toChain && toChain !== chain;
    return {
      from_token: from.trim(), to_token: to.trim(), amount: amount.trim(),
      ...(crossChain ? { from_chain: chain, to_chain: toChain } : { chain }),
      ...(wallet.trim() ? { wallet_address: wallet.trim() } : {}),
    };
  }

  // Any edit to the form invalidates the quote and the simulation shown on screen.
  const hash = JSON.stringify([from.trim(), to.trim(), amount.trim(), chain, toChain, wallet.trim()]);
  const quoteLive = quote?.hash === hash ? quote : null;
  const simLive = sim?.hash === hash ? sim : null;

  async function run(kind: 'quote' | 'sim') {
    if (lock.current) return;
    const body = buildBody();
    if (!body) return;
    lock.current = true; setBusy(kind);
    const k = await getKeyReady();
    if (!k) { setFormErr('Add a key above first. It is free and takes one click.'); lock.current = false; setBusy(null); return; }
    const myHash = hash;
    const doQuote = async () => {
      const r = await callApi({ method: 'POST', path: '/v1/agent/quote', body, key: k });
      const at = Date.now();
      setQuote({ r, body, at, hash: myHash }); setSim(null);
      track('widget_run', { slug, widget: 'live_quote', outcome: r.ok ? 'ok' : r.status === 0 ? 'network' : String(r.status) });
      return { r, at };
    };
    if (kind === 'quote') { await doQuote(); }
    else {
      // Dry run always simulates the quote on screen: reuse it while it is live for these exact inputs, else quote first.
      let qd = quoteLive && quoteLive.r.ok && (quoteLive.r.data as Quote).quote_id && Date.now() - quoteLive.at < ((quoteLive.r.data as Quote).expires_in_seconds ?? 60) * 1000 ? (quoteLive.r.data as Quote) : null;
      if (!qd) {
        const { r } = await doQuote();
        qd = r.ok ? (r.data as Quote) : null;
      }
      if (qd?.quote_id) {
        const sbody = { ...body, quote_id: qd.quote_id };
        const r = await callApi({ method: 'POST', path: '/v1/agent/swap/simulate', body: sbody, key: k });
        setSim({ r, body: sbody, hash: myHash, decimals: qd.to_token?.decimals, quoteId: qd.quote_id });
        track('widget_run', { slug, widget: 'live_simulate', outcome: r.ok ? 'ok' : r.status === 0 ? 'network' : String(r.status) });
      }
    }
    lock.current = false; setBusy(null);
  }

  const q = quoteLive?.r.ok ? (quoteLive.r.data as Quote) : null;
  const s = simLive?.r.ok ? (simLive.r.data as Sim) : null;
  const shown = simLive ?? quoteLive;
  const lastPath = simLive ? '/v1/agent/swap/simulate' : '/v1/agent/quote';
  // Decimals only count when they came with the same quote the simulation ran against.
  const solSim = (s as (Sim & { chain_type?: string }) | null)?.chain_type === 'solana';
  const decimals = simLive && s && s.quote_id === simLive.quoteId ? simLive.decimals : undefined;
  const amt = (raw: string | undefined) => (solSim ? raw ?? '' : fromRaw(raw, decimals));
  const cost = CREDIT_COST['POST /v1/agent/quote'];
  const expired = Boolean(q && left <= 0);
  const dryNote = !wallet.trim()
    ? 'Dry run needs a wallet address: the simulation checks that wallet’s balance and allowance.'
    : 'Dry run simulates the quote shown here for your wallet. It never signs or sends anything. It costs 1 credit, plus 1 for a fresh quote if there is no live one for these exact inputs.';

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
            <label className="lv-label" htmlFor="lv-chain">Chain{chains || chainErr ? '' : ' (loading)'}</label>
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
            <FieldControl className="lv-input lv-input--mono" value={wallet} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setWallet(e.target.value)} placeholder="0x… or a Solana address" autoComplete="off" spellCheck={false} />
            <span className="lv-hint">Needed for a dry run. A quote without one cannot be executed.</span></Field>
        </div>
        {chainErr && <div style={{ marginTop: '.85rem' }}><ErrorBox r={chainErr} onRetry={loadChains} /></div>}
        {formErr && <p className="lv-error-line" role="alert" style={{ marginTop: '.75rem' }}>{formErr}</p>}
        <div className="lv-actions">
          <button type="submit" className="lv-btn lv-btn--primary" disabled={busy !== null || !key}>{busy === 'quote' ? 'Quoting…' : 'Run live quote'}</button>
          <button type="button" className="lv-btn lv-btn--secondary" disabled={busy !== null || !key || !wallet.trim()} onClick={() => run('sim')} aria-describedby="lv-sim-why">{busy === 'sim' ? 'Simulating…' : 'Dry run'}</button>
          <span className="lv-cost">Quote costs <strong>{cost} credit</strong>; dry run costs <strong>1 credit</strong>, plus 1 for a fresh quote if needed{!key ? ' · add a key first' : ''}</span>
        </div>
        <p id="lv-sim-why" className="lv-note">{dryNote}</p>
      </form>

      <section className="lv-panel" aria-live="polite" aria-busy={busy !== null}>
        <h3>Result</h3>
        {busy && <div className="lv-loading" aria-label="Running"><i /><i /><i /></div>}
        {!busy && !shown && <p className="lv-empty">Nothing run yet. Press Run live quote to call the production API with your key. The response, route and the exact request appear here.</p>}
        {!busy && shown && !shown.r.ok && <ErrorBox r={shown.r} onRetry={() => run(simLive ? 'sim' : 'quote')}>{shown.r.status === 401 ? <p>Your key was rejected. Create or paste a key above.</p> : shown.r.status === 402 ? <p>This key is out of credits.</p> : null}</ErrorBox>}
        {!busy && shown?.r.ok && <ResultMeta r={shown.r} />}
        {!busy && q && !simLive && (
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
              <div><dt>Expected out</dt><dd>{amt(s.expected_output?.amount)} {s.expected_output?.token}{s.expected_output?.amount_usd ? ` (~$${s.expected_output.amount_usd})` : ''}</dd></div>
              <div><dt>Minimum out</dt><dd>{amt(s.min_output_after_slippage)} {s.expected_output?.token}</dd></div>
              <div><dt>Price impact</dt><dd>{s.price_impact_pct}%</dd></div>
              <div><dt>Fees</dt><dd>{Object.entries(s.fees ?? {}).filter(([, v]) => v != null).map(([k2, v]) => `${v} ${k2.replace('_', ' ')}`).join(' + ') || 'n/a'}</dd></div>
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
