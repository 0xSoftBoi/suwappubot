'use client';

import { useState } from 'react';

/**
 * CopyInstall — the developer entry point in the hero. Click-to-copy the
 * install command. Implicit CTA (a signal, not a button) per the hero's
 * one-primary-action hierarchy.
 */
export default function CopyInstall({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable — no-op */
    }
  };

  return (
    <button
      type="button"
      className="summer-install summer-install--copy"
      onClick={copy}
      aria-label={`Copy install command: ${text}`}
    >
      <span className="summer-install__prompt" aria-hidden="true">$</span>
      <code>{text}</code>
      <span className="summer-install__hint" aria-hidden="true">{copied ? 'copied ✓' : 'copy'}</span>
    </button>
  );
}
