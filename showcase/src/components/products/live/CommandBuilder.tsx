'use client';

import { useMemo, useState } from 'react';
import { TELEGRAM_URL } from '@/lib/links';
import { track } from '@/lib/analytics';
import { useLiveSlug } from './ApiKeyProvider';
import { CopyBtn } from './ui';
import './live.css';

type Cmd = { command: string; does: string };
type Arg = { id: string; label: string; placeholder: string; required: boolean; options?: string[] };
/** Argument syntax is only offered where the page itself states it (products.json). Everything else is the bare command. */
const ARGS: Record<string, { args: Arg[]; warn?: string }> = {
  '/snipe': { args: [{ id: 'contract', label: 'Token contract (optional)', placeholder: 'Solana token address', required: false }] },
  '/twap': {
    args: [
      { id: 'market', label: 'Market', placeholder: 'ETH', required: true },
      { id: 'side', label: 'Side', placeholder: '', required: true, options: ['long', 'short'] },
      { id: 'size', label: 'Size', placeholder: '0.5', required: true },
      { id: 'minutes', label: 'Minutes', placeholder: '30', required: true },
    ],
    warn: 'With all four arguments, /twap submits a live order immediately, with no confirmation step. Bare /twap only lists your running TWAPs.',
  },
};

/** Telegram has no command deep links (only /start <referral>), so this builds the exact text to send. */
export default function CommandBuilder({ commands }: { commands: Cmd[] }) {
  const slug = useLiveSlug();
  const slash = useMemo(() => commands.map((c) => ({ ...c, base: c.command.split(/\s/)[0] })).filter((c) => /^\/[\w-]+$/.test(c.base)), [commands]);
  const [sel, setSel] = useState(slash[0]?.base ?? '');
  const [vals, setVals] = useState<Record<string, string>>({});
  const cur = slash.find((c) => c.base === sel);
  const spec = ARGS[sel];
  const missing = spec?.args.filter((a) => a.required && !vals[a.id]?.trim()) ?? [];
  const partial = spec && spec.args.some((a) => vals[a.id]?.trim()) && missing.length > 0;
  const text = [sel, ...(spec?.args.map((a) => vals[a.id]?.trim()).filter(Boolean) ?? [])].join(' ');
  const okToCopy = !partial;
  if (!cur) return null;

  return (
    <section className="lv lv-panel">
      <h3>Build the command</h3>
      <div className="lv-grid lv-grid--2">
        <div className="lv-field"><label className="lv-label" htmlFor="lv-cmd">Command</label>
          <select id="lv-cmd" className="lv-select" value={sel} onChange={(e) => { setSel(e.target.value); setVals({}); }}>
            {slash.map((c) => <option key={c.base} value={c.base}>{c.base}: {c.does.replace(/\.$/, '').slice(0, 60)}</option>)}
          </select></div>
        {spec?.args.map((a) => (
          <div className="lv-field" key={a.id}>
            <label className="lv-label" htmlFor={`lv-a-${a.id}`}>{a.label}</label>
            {a.options ? (
              <select id={`lv-a-${a.id}`} className="lv-select" value={vals[a.id] ?? ''} onChange={(e) => setVals({ ...vals, [a.id]: e.target.value })}><option value="">Choose…</option>{a.options.map((o) => <option key={o}>{o}</option>)}</select>
            ) : (
              <input id={`lv-a-${a.id}`} className="lv-input" value={vals[a.id] ?? ''} placeholder={a.placeholder} onChange={(e) => setVals({ ...vals, [a.id]: e.target.value })} autoComplete="off" spellCheck={false} />
            )}
          </div>
        ))}
      </div>
      <p className="lv-note">{cur.does}</p>
      {spec?.warn && <p className="lv-error" role="note" style={{ marginTop: '.75rem' }}>{spec.warn}</p>}
      {partial && <p className="lv-error-line" role="alert" style={{ marginTop: '.75rem' }}>Fill every field ({missing.map((m) => m.label).join(', ')}) or clear them to send the bare command.</p>}
      <p className="lv-label" style={{ margin: '1rem 0 .4rem' }}>Send this to the bot</p>
      <pre className="lv-pre" tabIndex={0}>{okToCopy ? text : '…'}</pre>
      <div className="lv-actions">
        {okToCopy && <CopyBtn text={text} label="Copy command" slug={slug} what="bot_command" />}
        <a className="lv-btn lv-btn--primary" href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer" onClick={() => track('widget_run', { slug, widget: 'bot_command', outcome: 'open_bot' })}>Open the bot</a>
        <span className="lv-cost">Telegram cannot prefill a command, so paste it in the chat.</span>
      </div>
    </section>
  );
}
