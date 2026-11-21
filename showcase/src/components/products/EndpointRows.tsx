'use client';

import { useRef, useState } from 'react';
import CopyChip from './CopyChip';
import ApiKeyProvider from './live/ApiKeyProvider';
import KeyBar from './live/KeyBar';
import { callApi, type CallResult } from './live/api';
import { getKeyReady, useApiKey } from './live/keyStore';
import { CREDENTIAL_NOTE, CREDIT_COST, DEFAULT_BODY, KEYLESS, NEEDS_WALLET, PARAMS, hasPathParam, isRunnable, routeId, validateParam } from './live/allowlist';
import { CopyBtn, ErrorBox, Json, ResultMeta } from './live/ui';
import { curlSnippet } from './live/snippets';
import { track } from '@/lib/analytics';
import './live/live.css';

type Ep = { method: string; path: string; does: string };

function Row({ slug, e }: { slug: string; e: Ep }) {
  const id = routeId(e.method, e.path);
  const body = DEFAULT_BODY[id];
  const canRun = !CREDENTIAL_NOTE[id] && !hasPathParam(e.path) && isRunnable(e.method, e.path) && !hasPathParam(e.path) && id !== 'POST /v1/agent/register' && id !== 'POST /mcp';
  const needsId = e.method === 'GET' && hasPathParam(e.path);
  const note = CREDENTIAL_NOTE[id];
  const params = PARAMS[id];
  const { key: storedKey, hydrated } = useApiKey();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<CallResult | null>(null);
  const [noWallet, setNoWallet] = useState(false);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [perr, setPerr] = useState<string | null>(null);
  const [sentPath, setSentPath] = useState(e.path);
  const lock = useRef(false);
  const needsKey = !KEYLESS.has(id);

  async function run(fromForm = false) {
    if (lock.current) return;
    setOpen(true);
    const key = await getKeyReady();
    if (!key && needsKey) { setRes(null); return; }
    // Routes with required query params: reveal inputs first; a metered route is never sent without them.
    let path = e.path;
    if (params) {
      if (!fromForm) { setRes(null); return; }
      const bad = params.map((p) => validateParam(p, vals[p.name] ?? '')).find(Boolean);
      if (bad) { setPerr(bad); return; }
      setPerr(null);
      path = `${e.path}?${new URLSearchParams(params.map((p) => [p.name, (vals[p.name] ?? '').trim()])).toString()}`;
    }
    lock.current = true; setBusy(true); setNoWallet(false); setSentPath(path);
    if (NEEDS_WALLET.has(id)) {
      // Free pre-check: never call a wallet-scoped route for a key with no managed wallet.
      const w = await callApi({ path: '/v1/agent/wallets', key });
      const list = (w.data as { wallets?: unknown[] } | null)?.wallets;
      if (!w.ok || !Array.isArray(list) || list.length === 0) { setRes(w.ok ? null : w); setNoWallet(w.ok); setBusy(false); lock.current = false; return; }
    }
    const r = await callApi({ method: e.method as 'GET' | 'POST', path, body, key });
    setRes(r); setBusy(false); lock.current = false;
    track('widget_run', { slug, widget: 'endpoint_run', outcome: r.ok ? 'ok' : r.status === 0 ? 'network' : String(r.status) });
  }

  const cost = CREDIT_COST[id];
  return (
    <>
      <tr>
        <td><span className={`pd-method pd-method--${e.method.toLowerCase()}`}>{e.method}</span></td>
        <td className="pd-path">
          <code>{e.path}</code><CopyChip text={e.path} slug={slug} lang="path" />
          {canRun && <button type="button" className="lv-btn lv-btn--ghost pd-run" onClick={() => run()} disabled={busy} aria-expanded={open}>{busy ? 'Running…' : 'Run'}</button>}
          {canRun && cost !== undefined && <span className="pd-run__lock">{cost} credit{cost === 1 ? '' : 's'}</span>}
          {note && <span className="pd-run__lock">{note.href ? <>{note.text}: <a href={note.href}>open the dashboard</a></> : note.text}</span>}
          {needsId && <span className="pd-run__lock">Needs an id: run from your code</span>}
          {!canRun && !needsId && !note && e.method !== 'TOOL' && <span className="pd-run__lock" title="Moves funds, writes, or needs a signature"><svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ marginRight: 4, verticalAlign: '-1px' }}><rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.4" /><path d="M5.5 7V5a2.5 2.5 0 015 0v2" stroke="currentColor" strokeWidth="1.4" /></svg>Runs only from your own code</span>}
        </td>
        <td>{e.does}</td>
      </tr>
      {open && (
        <tr className="lv-rowpanel">
          <td colSpan={3}>
            <div className="lv-panel v3-tone-light" aria-live="polite" aria-busy={busy}>
              {busy && <div className="lv-loading" aria-label="Running"><i /><i /><i /></div>}
              {!busy && !res && hydrated && !storedKey && needsKey && (
                <><p className="lv-note" style={{ marginBottom: '.75rem' }}>This route needs a key. Create one or paste yours, then press Run again.</p><KeyBar compact /></>
              )}
              {!busy && params && !res && !noWallet && (hydrated && (storedKey || !needsKey)) && (
                <form onSubmit={(ev) => { ev.preventDefault(); void run(true); }} noValidate>
                  <p className="lv-note" style={{ marginBottom: '.75rem' }}>This route needs {params.length === 1 ? 'a parameter' : 'parameters'} before it can be sent{cost ? `, and it costs ${cost} credit` : ''}. Nothing is sent until it validates.</p>
                  {params.map((p) => (
                    <div className="lv-field" key={p.name}>
                      <label className="lv-label" htmlFor={`pp-${id}-${p.name}`}>{p.label}</label>
                      <input id={`pp-${id}-${p.name}`} className="lv-input lv-input--mono" value={vals[p.name] ?? ''} onChange={(ev) => setVals({ ...vals, [p.name]: ev.target.value })} placeholder={p.placeholder} autoComplete="off" spellCheck={false} />
                    </div>
                  ))}
                  {perr && <p className="lv-error-line" role="alert" style={{ marginTop: '.5rem' }}>{perr}</p>}
                  <div className="lv-actions"><button type="submit" className="lv-btn lv-btn--primary">Send request</button></div>
                </form>
              )}
              {!busy && noWallet && <p className="lv-note">Create a managed wallet first (from your own code). This key has none yet, so no call was made to this route.</p>}
              {!busy && res && (
                <>
                  {res.ok ? <ResultMeta r={res} /> : <ErrorBox r={res} onRetry={() => run(Boolean(params))}>{res.status === 401 && <KeyBar compact />}</ErrorBox>}
                  {res.data != null && <Json data={res.data} label={res.ok ? 'Response' : 'Raw response'} open />}
                  <div style={{ marginTop: '.75rem' }} className="lv-codewrap"><pre className="lv-pre" tabIndex={0}>{curlSnippet(e.method, sentPath, body)}</pre><CopyBtn text={curlSnippet(e.method, sentPath, body)} slug={slug} what="request_curl" /></div>
                </>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/** Endpoint reference rows with a real Run button on the safe ones (see live/allowlist.ts). */
export default function EndpointRows({ slug, endpoints }: { slug: string; endpoints: Ep[] }) {
  return (
    <ApiKeyProvider slug={slug}>
      <tbody>{endpoints.map((e) => <Row key={`${e.method} ${e.path}`} slug={slug} e={e} />)}</tbody>
    </ApiKeyProvider>
  );
}
