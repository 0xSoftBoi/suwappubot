'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Accordion, AccordionHeader, AccordionItem, AccordionPanel, AccordionTrigger } from '@ui-sdk/react/accordion';
import { Tabs, TabsList, TabsPanel, TabsTab } from '@ui-sdk/react/tabs';
import { callApi, type CallResult } from './api';
import { maskKey, useApiKey } from './keyStore';
import { useLiveSlug } from './ApiKeyProvider';
import KeyBar from './KeyBar';
import { CopyBtn, ErrorBox } from './ui';
import { track } from '@/lib/analytics';
import './live.css';

type Tool = { name: string; description?: string; inputSchema?: unknown };
const MCP_URL = 'https://api.suwappu.bot/mcp';

/** Client configs. `k` is the key text to embed (placeholder, masked, or real). */
function configs(k: string): { id: string; label: string; file: string; text: string }[] {
  const auth = `Bearer ${k}`;
  return [
    { id: 'desktop', label: 'Claude Desktop', file: 'claude_desktop_config.json', text: JSON.stringify({ mcpServers: { suwappu: { command: 'npx', args: ['@suwappu/mcp-server'], env: { SUWAPPU_API_KEY: k } } } }, null, 2) },
    { id: 'code', label: 'Claude Code', file: 'terminal', text: `claude mcp add --transport http suwappu ${MCP_URL} \\\n  --header "Authorization: ${auth}"` },
    { id: 'cursor', label: 'Cursor', file: '~/.cursor/mcp.json', text: JSON.stringify({ mcpServers: { suwappu: { url: MCP_URL, headers: { Authorization: auth } } } }, null, 2) },
    { id: 'vscode', label: 'VS Code', file: '.vscode/mcp.json', text: JSON.stringify({ servers: { suwappu: { type: 'http', url: MCP_URL, headers: { Authorization: auth } } } }, null, 2) },
  ];
}

export default function McpBrowser() {
  const slug = useLiveSlug();
  const { key } = useApiKey();
  const [tools, setTools] = useState<Tool[] | null>(null);
  const [err, setErr] = useState<CallResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [reveal, setReveal] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    const r = await callApi({
      method: 'POST', path: '/mcp', body: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      headers: { Accept: 'application/json, text/event-stream' }, refresh: false,
    });
    const list = (r.data as { result?: { tools?: Tool[] } } | null)?.result?.tools;
    if (r.ok && Array.isArray(list)) { setTools(list); track('widget_run', { slug, widget: 'mcp_tools_list', outcome: 'ok' }); }
    else { setErr(r); track('widget_run', { slug, widget: 'mcp_tools_list', outcome: String(r.status) }); }
    setLoading(false);
  }, [slug]);
  useEffect(() => { void load(); }, [load]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (tools ?? []).filter((t) => !s || t.name.toLowerCase().includes(s) || (t.description ?? '').toLowerCase().includes(s));
  }, [tools, q]);

  const display = key ? (reveal ? key : maskKey(key)) : 'suwappu_sk_YOUR_KEY';
  const real = key ?? 'suwappu_sk_YOUR_KEY';

  return (
    <div className="lv lv-stack">
      <section className="lv-panel" aria-busy={loading}>
        <h3>{tools ? `${tools.length} tools, read live from ${MCP_URL.replace('https://', '')}` : 'Tools'}</h3>
        <label className="lv-label" htmlFor="lv-toolq">Search tools</label>
        <input id="lv-toolq" className="lv-input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="quote, wallet, predict…" autoComplete="off" disabled={!tools} />
        <p className="lv-note" role="status">{tools ? `${shown.length} of ${tools.length} shown. Listing tools is keyless and costs no credits.` : loading ? 'Calling tools/list…' : ''}</p>
        {loading && <div className="lv-loading" aria-label="Loading tools"><i /><i /><i /></div>}
        {err && <ErrorBox r={err} onRetry={load} />}
        {tools && shown.length === 0 && <p className="lv-empty">No tool matches “{q}”.</p>}
        {tools && shown.length > 0 && (
          <Accordion multiple className="lv-toollist">
            {shown.map((t) => (
              <AccordionItem key={t.name} value={t.name} className="lv-tool">
                <AccordionHeader className="lv-acc__h">
                  <AccordionTrigger className="lv-acc__trigger">
                    <span><code>{t.name}</code><br /><span className="lv-hint">{(t.description ?? '').split(/(?<=\.)\s/)[0].slice(0, 140)}</span></span>
                    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M5 8l5 5 5-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </AccordionTrigger>
                </AccordionHeader>
                <AccordionPanel className="lv-acc__panel">
                  <p className="lv-note">{t.description}</p>
                  <p className="lv-label" style={{ margin: '.6rem 0 .3rem' }}>Input schema</p>
                  <pre className="lv-pre" tabIndex={0}>{JSON.stringify(t.inputSchema ?? {}, null, 2)}</pre>
                </AccordionPanel>
              </AccordionItem>
            ))}
          </Accordion>
        )}
      </section>

      <section className="lv-panel">
        <h3>Connect your client</h3>
        <KeyBar compact />
        <div style={{ marginTop: '1rem' }}>
          <Tabs defaultValue="desktop" className="lv-tabs">
            <TabsList aria-label="MCP client">
              {configs('x').map((c) => <TabsTab key={c.id} value={c.id}>{c.label}</TabsTab>)}
            </TabsList>
            {configs(display).map((c) => {
              const copy = configs(real).find((x) => x.id === c.id)!.text;
              return (
                <TabsPanel key={c.id} value={c.id}>
                  <p className="lv-note" style={{ margin: '0 0 .4rem' }}>{c.file}</p>
                  <div className="lv-codewrap"><pre className="lv-pre" tabIndex={0}>{c.text}</pre><CopyBtn text={copy} label={key ? 'Copy with key' : 'Copy'} slug={slug} what={`mcp_${c.id}`} /></div>
                </TabsPanel>
              );
            })}
          </Tabs>
          <div className="lv-actions">
            {key && <button type="button" className="lv-btn lv-btn--ghost" aria-pressed={reveal} onClick={() => setReveal((v) => !v)}>{reveal ? 'Hide key in config' : 'Reveal key in config'}</button>}
            <span className="lv-cost">{key ? 'The key is masked on screen; Copy still copies the real value.' : 'Add a key above and it is inserted here.'}</span>
          </div>
        </div>
      </section>
    </div>
  );
}
