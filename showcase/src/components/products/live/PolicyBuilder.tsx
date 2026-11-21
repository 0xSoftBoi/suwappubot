'use client';

import { useMemo, useRef, useState } from 'react';
import { Tabs, TabsList, TabsPanel, TabsTab } from '@ui-sdk/react/tabs';
import { callApi, type CallResult } from './api';
import { getStoredKey, useApiKey } from './keyStore';
import { useLiveSlug } from './ApiKeyProvider';
import KeyBar from './KeyBar';
import { CopyBtn, ErrorBox, Json, ResultMeta } from './ui';
import { curlSnippet, pySnippet, tsSnippet } from './snippets';
import { track } from '@/lib/analytics';
import './live.css';

const ADDR = /^0x[0-9a-fA-F]{40}$/;
const WINDOWS = [[3600, 'per hour'], [86400, 'per day'], [604800, 'per week']] as const;

/** Decimal ETH string -> wei string, exact (no float). Returns null when invalid. */
function ethToWei(v: string): string | null {
  const m = /^(\d+)(?:\.(\d{1,18}))?$/.exec(v.trim());
  if (!m) return null;
  return (BigInt(m[1]) * 10n ** 18n + BigInt((m[2] ?? '').padEnd(18, '0'))).toString();
}

/**
 * Builds the exact body for POST /v1/agent/wallet/policy (OpenAPI CreatePolicyRequest) and shows it.
 * It never POSTs: creating a policy changes a wallet's rules, so that runs from the visitor's own code.
 * "Read my current policy" is a real GET.
 */
export default function PolicyBuilder() {
  const slug = useLiveSlug();
  const { key } = useApiKey();
  const [kind, setKind] = useState<'spending_limit' | 'whitelist'>('spending_limit');
  const [eth, setEth] = useState('0.5');
  const [win, setWin] = useState<number>(86400);
  const [addrs, setAddrs] = useState('');
  const [res, setRes] = useState<CallResult | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);

  const built = useMemo(() => {
    if (kind === 'spending_limit') {
      const wei = ethToWei(eth);
      if (!wei || wei === '0') return { err: 'Enter a limit greater than 0, up to 18 decimals (in ETH, or the chain’s native token).' };
      return { body: { type: 'spending_limit', params: { maxAmountWei: wei, timeWindowSeconds: win } } };
    }
    const list = addrs.split(/[\s,]+/).filter(Boolean);
    if (!list.length) return { err: 'Add at least one address, one per line.' };
    const bad = list.find((a) => !ADDR.test(a));
    if (bad) return { err: `Not a valid 0x address: ${bad.slice(0, 20)}` };
    return { body: { type: 'whitelist', params: { allowedAddresses: list } } };
  }, [kind, eth, win, addrs]);

  async function read() {
    const k = getStoredKey();
    if (!k || lock.current) return;
    lock.current = true; setBusy(true);
    const r = await callApi({ path: '/v1/agent/wallet/policies', key: k });
    setRes(r); setBusy(false); lock.current = false;
    track('widget_run', { slug, widget: 'policy_read', outcome: r.ok ? 'ok' : String(r.status) });
  }

  const PATH = '/v1/agent/wallet/policy';
  return (
    <div className="lv lv-stack">
      <KeyBar compact />
      <section className="lv-panel">
        <h3>Build the policy</h3>
        <div className="lv-grid lv-grid--2">
          <div className="lv-field"><label className="lv-label" htmlFor="lv-pk">Policy type</label>
            <select id="lv-pk" className="lv-select" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              <option value="spending_limit">Spending limit (per transaction value)</option>
              <option value="whitelist">Address allowlist</option>
            </select></div>
          {kind === 'spending_limit' ? (
            <>
              <div className="lv-field"><label className="lv-label" htmlFor="lv-pl">Limit (native token)</label>
                <input id="lv-pl" className="lv-input" inputMode="decimal" value={eth} onChange={(e) => setEth(e.target.value)} /></div>
              <div className="lv-field"><label className="lv-label" htmlFor="lv-pw">Time window</label>
                <select id="lv-pw" className="lv-select" value={win} onChange={(e) => setWin(Number(e.target.value))}>
                  {WINDOWS.map(([s, l]) => <option key={s} value={s}>{l}</option>)}</select></div>
            </>
          ) : (
            <div className="lv-field" style={{ gridColumn: '1 / -1' }}><label className="lv-label" htmlFor="lv-pa">Allowed addresses (one per line)</label>
              <textarea id="lv-pa" className="lv-input" style={{ minHeight: '6rem', padding: '.6rem .8rem', fontFamily: 'var(--v3-font-mono)' }} value={addrs} onChange={(e) => setAddrs(e.target.value)} placeholder="0x…" spellCheck={false} /></div>
          )}
        </div>
        {'err' in built && built.err && <p className="lv-error-line" role="alert" style={{ marginTop: '.75rem' }}>{built.err}</p>}
        {'body' in built && built.body && (
          <div style={{ marginTop: '1rem' }}>
            <p className="lv-label" style={{ margin: '0 0 .5rem' }}>The exact request. Not sent from this page: creating a policy changes your wallet’s rules, so run it from your own code.</p>
            <Tabs defaultValue="curl" className="lv-tabs">
              <TabsList aria-label="Language"><TabsTab value="curl">curl</TabsTab><TabsTab value="ts">TypeScript</TabsTab><TabsTab value="py">Python</TabsTab></TabsList>
              {([['curl', curlSnippet], ['ts', tsSnippet], ['py', pySnippet]] as const).map(([id, fn]) => {
                const code = fn('POST', PATH, built.body);
                return <TabsPanel key={id} value={id}><div className="lv-codewrap"><pre className="lv-pre" tabIndex={0}>{code}</pre><CopyBtn text={code} slug={slug} what={`policy_${id}`} /></div></TabsPanel>;
              })}
            </Tabs>
          </div>
        )}
      </section>
      <section className="lv-panel" aria-live="polite" aria-busy={busy}>
        <h3>Your wallet’s current policies</h3>
        <div className="lv-actions" style={{ marginTop: 0 }}>
          <button type="button" className="lv-btn lv-btn--secondary" onClick={read} disabled={busy || !key}>{busy ? 'Reading…' : 'Read my current policy'}</button>
          <span className="lv-cost">GET /v1/agent/wallet/policies · free read{!key ? ' · add a key first' : ''}</span>
        </div>
        {!res && !busy && <p className="lv-empty" style={{ marginTop: '1rem' }}>Not read yet. This is a real call: a key with no managed wallet gets the API’s real answer.</p>}
        {busy && <div className="lv-loading" style={{ marginTop: '1rem' }}><i /><i /><i /></div>}
        {res && !busy && (<div style={{ marginTop: '1rem' }}>{res.ok ? <ResultMeta r={res} /> : <ErrorBox r={res} onRetry={read} />}{res.data != null && <Json data={res.data} open label="Response" />}</div>)}
      </section>
    </div>
  );
}
