'use client';

import { useRef, useState } from 'react';
import { Tabs, TabsList, TabsPanel, TabsTab } from '@ui-sdk/react/tabs';
import { track } from '@/lib/analytics';
import { API_BASE_URL } from '@/lib/links';
import CopyCode from './CopyCode';

const NAME_RE = /^[A-Za-z0-9_-]{3,50}$/;

/**
 * /start: copy-paste register call in three languages, plus an in-page
 * "Create my key" form that calls the same public endpoint from the browser
 * (no secret involved; api-ts CORS allows https://suwappu.bot by default).
 *
 * The key lives ONLY in this component's React state: it is never logged,
 * never sent to analytics (events carry outcome only), never written to
 * storage, and is dropped on "I've stored it".
 */
export default function StartKey({ bash, ts, python }: { bash: string; ts: string; python: string }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const [credits, setCredits] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const inFlight = useRef(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (inFlight.current) return;
    setError(null);
    if (!NAME_RE.test(name)) {
      setError('Name must be 3-50 characters: letters, digits, _ and -.');
      return;
    }
    inFlight.current = true;
    setBusy(true);
    track('cta_clicked', { surface: 'start', slug: 'start', dest: 'register_form', kind: 'primary' });
    try {
      const res = await fetch(`${API_BASE_URL}/v1/agent/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'omit',
        body: JSON.stringify({ name, ...(description.trim() ? { description: description.trim() } : {}) }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.agent?.api_key) {
        setKey(String(data.agent.api_key));
        setCredits(typeof data.credits?.starting_balance === 'number' ? data.credits.starting_balance : null);
        track('start_key_created', { surface: 'start', outcome: 'ok' });
      } else if (res.status === 429) {
        setError('Registration is limited to 5 requests per minute per IP. Wait a minute and try again, or use the copy-paste command.');
        track('start_key_created', { surface: 'start', outcome: 'rate_limited' });
      } else {
        const msg = data?.fields ? Object.values(data.fields).flat().join(' ') : data?.error || data?.message;
        setError(typeof msg === 'string' && msg ? msg : 'Registration failed. Use the copy-paste command above, which calls the same endpoint.');
        track('start_key_created', { surface: 'start', outcome: 'error' });
      }
    } catch {
      setError('Could not reach the API from the browser. Use the copy-paste command above, which calls the same endpoint.');
      track('start_key_created', { surface: 'start', outcome: 'network' });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function copyKey() {
    if (!key) return;
    try {
      await navigator.clipboard.writeText(key);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* the key is selectable text */ }
  }

  return (
    <div className="sv-start">
      <Tabs defaultValue="bash" className="sv-tabs">
        <TabsList aria-label="Language for the register call">
          <TabsTab value="bash">curl</TabsTab>
          <TabsTab value="ts">TypeScript</TabsTab>
          <TabsTab value="python">Python</TabsTab>
        </TabsList>
        <TabsPanel value="bash"><CopyCode code={bash} lang="bash" label="Register an agent" slug="start" /></TabsPanel>
        <TabsPanel value="ts"><CopyCode code={ts} lang="ts" label="Register an agent" slug="start" /></TabsPanel>
        <TabsPanel value="python"><CopyCode code={python} lang="python" label="Register an agent" slug="start" /></TabsPanel>
      </Tabs>

      {key ? (
        <div className="sv-keybox" role="region" aria-label="Your new API key">
          <strong>Store this now. We cannot show it again.</strong>
          <code>{key}</code>
          <p className="sv-note">
            Suwappu keeps only a hash. Put it in <code style={{ display: 'inline', padding: '0 4px', margin: 0 }}>SUWAPPU_API_KEY</code> and send it as <code style={{ display: 'inline', padding: '0 4px', margin: 0 }}>Authorization: Bearer</code>.
            {credits !== null ? ` Starter credits granted: ${credits}.` : ''}
          </p>
          <div className="sv-actions">
            <button type="button" className="summer-button summer-button--primary" onClick={copyKey}>{copied ? 'Copied' : 'Copy key'}</button>
            <button type="button" className="summer-button summer-button--secondary" onClick={() => { setKey(null); setName(''); setDescription(''); }}>I have stored it</button>
          </div>
        </div>
      ) : (
        <form className="sv-form" onSubmit={submit} noValidate>
          <label>
            Agent name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="my-agent" autoComplete="off" spellCheck={false} maxLength={50} required />
            <small>3-50 characters: letters, digits, _ and -. Must be unique.</small>
          </label>
          <label>
            Description <small>(optional)</small>
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Quote bot" autoComplete="off" maxLength={500} />
          </label>
          {error && <p className="sv-error" role="alert">{error}</p>}
          <div className="sv-actions">
            <button type="submit" className="summer-button summer-button--primary" disabled={busy}>{busy ? 'Creating…' : 'Create my key'}</button>
          </div>
          <p className="sv-note">Calls the same public endpoint as the command above. No card, no email.</p>
        </form>
      )}
    </div>
  );
}
