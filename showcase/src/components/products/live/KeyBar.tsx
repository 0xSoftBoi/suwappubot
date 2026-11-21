'use client';

import { useRef, useState } from 'react';
import { Field, FieldControl, FieldLabel } from '@ui-sdk/react/field';
import { track } from '@/lib/analytics';
import { callApi } from './api';
import { KEY_RE, getKeyReady, maskKey, useApiKey } from './keyStore';
import { useLiveSlug } from './ApiKeyProvider';
import { CopyBtn } from './ui';
import './live.css';

const rand = () => Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 8);

/**
 * Key controls shared by every widget: create in one click (public register
 * endpoint), or paste an existing one. Stored encrypted, only in this browser.
 */
export default function KeyBar({ compact = false }: { compact?: boolean }) {
  const slug = useLiveSlug();
  const k = useApiKey();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [paste, setPaste] = useState('');
  const [reveal, setReveal] = useState(false);
  const inflight = useRef(false);

  async function create() {
    if (inflight.current) return;
    inflight.current = true; setBusy(true); setErr(null);
    const r = await callApi({ method: 'POST', path: '/v1/agent/register', body: { name: `site-${rand()}` } });
    const d = r.data as { agent?: { api_key?: string } } | null;
    if (r.ok && d?.agent?.api_key && await getKeyReady()) {
      // A key appeared while registering (another tab/widget): never overwrite it silently.
      setErr('A key is already saved here. The new agent was created, but its key was not stored or shown. Forget the saved key first if you want a fresh one.');
    } else if (r.ok && d?.agent?.api_key) {
      k.setKey(String(d.agent.api_key));
      track('start_key_created', { surface: `product:${slug}`, outcome: 'ok' });
    } else {
      track('start_key_created', { surface: `product:${slug}`, outcome: r.status === 429 ? 'rate_limited' : 'error' });
      setErr(r.status === 429
        ? `Registration is limited per IP (${r.error}). Wait a minute, or paste a key you already have.`
        : (r.error ?? 'Registration failed.'));
    }
    inflight.current = false; setBusy(false);
  }

  function usePasted(e: React.FormEvent) {
    e.preventDefault();
    const v = paste.trim();
    if (!KEY_RE.test(v)) { setErr('That does not look like a Suwappu key (it starts with suwappu_sk_).'); return; }
    setErr(null); setPaste(''); k.setKey(v);
  }

  if (!k.hydrated) return <div className="lv-key lv-key--skeleton" aria-busy="true" />;

  if (k.key) {
    return (
      <div className={`lv-key lv-key--on${compact ? ' lv-key--compact' : ''}`} role="group" aria-label="Your API key">
        <div className="lv-key__row">
          <span className="lv-key__label">Your key</span>
          <code className="lv-key__code">{reveal ? k.key : maskKey(k.key)}</code>
          <span className={`lv-chip${k.balanceError ? ' lv-chip--bad' : ''}`} role="status" title="Live from GET /v1/agent/billing">
            {k.balance !== null ? `${k.balance} credits` : k.balanceError ?? 'Checking credits…'}
          </span>
        </div>
        <div className="lv-key__row lv-key__row--actions">
          <button type="button" className="lv-btn lv-btn--ghost" onClick={() => setReveal((v) => !v)} aria-pressed={reveal}>{reveal ? 'Hide' : 'Reveal'}</button>
          <CopyBtn text={k.key} label="Copy key" />
          <button type="button" className="lv-btn lv-btn--ghost" onClick={() => { k.refreshBalance(); }}>Refresh credits</button>
          <label className="lv-check">
            <input type="checkbox" checked={k.remember} onChange={(e) => k.setRemember(e.target.checked)} />
            Remember on this device
          </label>
          <button type="button" className="lv-btn lv-btn--danger" onClick={() => { setReveal(false); k.forget(); }}>Forget key</button>
        </div>
        <p className="lv-note">Stored encrypted, only in this browser. It is sent only to api.suwappu.bot, as an Authorization header.</p>
      </div>
    );
  }

  return (
    <div className={`lv-key${compact ? ' lv-key--compact' : ''}`}>
      <div className="lv-key__empty">
        <div>
          <strong>Use your own key</strong>
          <p className="lv-note">Every run below is a real call that spends your credits. 100 free credits, no card. Stored encrypted, only in this browser.</p>
        </div>
        <button type="button" className="lv-btn lv-btn--primary" onClick={create} disabled={busy}>{busy ? 'Creating…' : 'Create a free key'}</button>
      </div>
      <form className="lv-key__paste" onSubmit={usePasted} noValidate>
        <Field name="key" className="lv-field">
          <FieldLabel className="lv-label">Or paste an existing key</FieldLabel>
          <FieldControl className="lv-input" placeholder="suwappu_sk_…" value={paste} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPaste(e.target.value)} autoComplete="off" spellCheck={false} type="password" />
        </Field>
        <button type="submit" className="lv-btn lv-btn--secondary" disabled={!paste.trim()}>Use this key</button>
      </form>
      {err && <p className="lv-error-line" role="alert">{err}</p>}
    </div>
  );
}
