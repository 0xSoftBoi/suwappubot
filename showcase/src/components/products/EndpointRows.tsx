'use client';

import { useRef, useState } from 'react';
import CopyChip from './CopyChip';
import ApiKeyProvider from './live/ApiKeyProvider';
import KeyBar from './live/KeyBar';
import { callApi, type CallResult } from './live/api';
import { getStoredKey } from './live/keyStore';
import { CREDIT_COST, DEFAULT_BODY, KEYLESS, hasPathParam, isRunnable, routeId } from './live/allowlist';
import { CopyBtn, ErrorBox, Json, ResultMeta } from './live/ui';
import { curlSnippet } from './live/snippets';
import { track } from '@/lib/analytics';
import './live/live.css';

type Ep = { method: string; path: string; does: string };

function Row({ slug, e }: { slug: string; e: Ep }) {
  const id = routeId(e.method, e.path);
  const body = DEFAULT_BODY[id];
  const canRun = isRunnable(e.method, e.path) && !hasPathParam(e.path) && id !== 'POST /v1/agent/register' && id !== 'POST /mcp';
  const needsId = isRunnable(e.method, e.path) && hasPathParam(e.path);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<CallResult | null>(null);
  const lock = useRef(false);

  async function run() {
    if (lock.current) return;
    setOpen(true);
    const key = getStoredKey();
    if (!key && !KEYLESS.has(id)) { setRes(null); return; }
    lock.current = true; setBusy(true);
    const r = await callApi({ method: e.method as 'GET' | 'POST', path: e.path, body, key });
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
          {canRun && <button type="button" className="lv-btn lv-btn--ghost pd-run" onClick={run} disabled={busy} aria-expanded={open}>{busy ? 'Running…' : 'Run'}</button>}
          {canRun && cost !== undefined && <span className="pd-run__lock">{cost} credit{cost === 1 ? '' : 's'}</span>}
          {needsId && <span className="pd-run__lock">Needs an id: run from your code</span>}
          {!canRun && !needsId && e.method !== 'TOOL' && <span className="pd-run__lock" title="Moves funds, writes, or needs a signature"><svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ marginRight: 4, verticalAlign: '-1px' }}><rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.4" /><path d="M5.5 7V5a2.5 2.5 0 015 0v2" stroke="currentColor" strokeWidth="1.4" /></svg>Runs only from your own code</span>}
        </td>
        <td>{e.does}</td>
      </tr>
      {open && (
        <tr className="lv-rowpanel">
          <td colSpan={3}>
            <div className="lv-panel v3-tone-light" aria-live="polite" aria-busy={busy}>
              {busy && <div className="lv-loading" aria-label="Running"><i /><i /><i /></div>}
              {!busy && !res && !getStoredKey() && !KEYLESS.has(id) && (
                <><p className="lv-note" style={{ marginBottom: '.75rem' }}>This route needs a key. Create one or paste yours, then press Run again.</p><KeyBar compact /></>
              )}
              {!busy && res && (
                <>
                  {res.ok ? <ResultMeta r={res} /> : <ErrorBox r={res} onRetry={run}>{res.status === 401 && <KeyBar compact />}</ErrorBox>}
                  {res.data != null && <Json data={res.data} label={res.ok ? 'Response' : 'Raw response'} open />}
                  <div style={{ marginTop: '.75rem' }} className="lv-codewrap"><pre className="lv-pre" tabIndex={0}>{curlSnippet(e.method, e.path, body)}</pre><CopyBtn text={curlSnippet(e.method, e.path, body)} slug={slug} what="request_curl" /></div>
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
