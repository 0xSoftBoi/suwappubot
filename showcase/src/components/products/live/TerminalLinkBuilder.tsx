'use client';

import { useCallback, useEffect, useState } from 'react';
import { callApi, type CallResult } from './api';
import { useLiveSlug } from './ApiKeyProvider';
import { isAmount } from './keyStore';
import { CopyBtn, ErrorBox } from './ui';
import { TERMINAL_URL } from '@/lib/links';
import { track } from '@/lib/analytics';
import './live.css';

type Chain = { key: string; name: string };

/** Builds the real Terminal /alert-swap deep link (it prefills chain, token, side, amount; nothing executes until the visitor confirms there). */
export default function TerminalLinkBuilder() {
  const slug = useLiveSlug();
  const [chains, setChains] = useState<Chain[] | null>(null);
  const [err, setErr] = useState<CallResult | null>(null);
  const [chain, setChain] = useState('base');
  const [token, setToken] = useState('ETH');
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [amount, setAmount] = useState('50');

  const load = useCallback(async () => {
    setErr(null);
    const r = await callApi({ path: '/v1/agent/chains' });
    const list = (r.data as { chains?: Chain[] } | null)?.chains;
    if (r.ok && Array.isArray(list)) setChains(list); else setErr(r);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const tok = token.trim().toUpperCase();
  const amtOk = isAmount(amount);
  const valid = /^[A-Z0-9._-]{1,20}$/.test(tok) && amtOk;
  const qs = new URLSearchParams({ chain, token: tok, side, amount: amount.trim(), ref: 'site' });
  const href = `${TERMINAL_URL}/alert-swap?${qs.toString()}`;

  return (
    <section className="lv lv-panel">
      <h3>Build the swap</h3>
      <div className="lv-grid">
        <div className="lv-field"><label className="lv-label" htmlFor="lv-t-side">Side</label>
          <select id="lv-t-side" className="lv-select" value={side} onChange={(e) => setSide(e.target.value as 'buy' | 'sell')}><option value="buy">Buy</option><option value="sell">Sell</option></select></div>
        <div className="lv-field"><label className="lv-label" htmlFor="lv-t-tok">Token symbol</label>
          <input id="lv-t-tok" className="lv-input" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" spellCheck={false} /></div>
        <div className="lv-field"><label className="lv-label" htmlFor="lv-t-amt">Amount</label>
          <input id="lv-t-amt" className="lv-input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
        <div className="lv-field"><label className="lv-label" htmlFor="lv-t-ch">Chain{chains || err ? '' : ' (loading)'}</label>
          <select id="lv-t-ch" className="lv-select" value={chain} onChange={(e) => setChain(e.target.value)} disabled={!chains}>
            {(chains ?? [{ key: 'base', name: 'Base' }]).map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}</select></div>
      </div>
      {err && <div style={{ marginTop: '.85rem' }}><ErrorBox r={err} onRetry={load} /></div>}
      {!valid && <p className="lv-error-line" role="alert" style={{ marginTop: '.75rem' }}>Enter a token symbol and a positive amount.</p>}
      <p className="lv-label" style={{ margin: '1rem 0 .4rem' }}>Your link</p>
      <pre className="lv-pre" tabIndex={0}>{valid ? href : 'Fill in the fields above.'}</pre>
      <div className="lv-actions">
        <a className={`lv-btn lv-btn--primary${valid ? '' : ' is-disabled'}`} href={valid ? href : undefined} aria-disabled={!valid} target="_blank" rel="noopener noreferrer" onClick={(e) => { if (!valid) e.preventDefault(); else track('widget_run', { slug, widget: 'terminal_link', outcome: 'open' }); }}>Open in the Terminal</a>
        {valid && <CopyBtn text={href} label="Copy link" slug={slug} what="terminal_link" />}
        <span className="lv-cost">Opens in a new tab. You review and confirm there; nothing executes from this page.</span>
      </div>
    </section>
  );
}
