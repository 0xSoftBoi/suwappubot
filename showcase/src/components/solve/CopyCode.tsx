'use client';

import { useState } from 'react';
import { track } from '@/lib/analytics';

/**
 * Designed code panel with a Copy button. `telegram` snippets render as a chat
 * (one outgoing message per line) because that is how a person uses them.
 * Copy fires `solve_snippet_copied` with the page slug and language only.
 */
export default function CopyCode({
  code, lang, label, slug, surface,
}: { code: string; lang: string; label: string; slug: string; surface?: string }) {
  const [copied, setCopied] = useState(false);
  const chat = lang === 'telegram';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
      track('solve_snippet_copied', surface ? { slug, lang, surface } : { slug, lang });
    } catch { /* clipboard unavailable: the text is selectable */ }
  };

  return (
    <figure className={`sv-code${chat ? ' sv-code--chat' : ''}`}>
      <figcaption className="sv-code__bar">
        <span className="sv-code__lang">{chat ? 'Telegram' : lang}</span>
        <span className="sv-code__label">{label}</span>
        <button type="button" className="sv-code__copy" onClick={copy} aria-label={`Copy ${label}`}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </figcaption>
      {chat ? (
        <div className="sv-chat" role="group" aria-label="Messages to send to the Suwappu bot">
          <span className="sv-chat__who">Suwappu bot</span>
          {code.split('\n').filter(Boolean).map((line, i) => (
            <code key={i} className="sv-chat__msg">{line}</code>
          ))}
        </div>
      ) : (
        <pre className="sv-code__pre" tabIndex={0}><code>{code}</code></pre>
      )}
      <span className="sv-sr" role="status" aria-live="polite">{copied ? 'Copied to clipboard' : ''}</span>
    </figure>
  );
}
