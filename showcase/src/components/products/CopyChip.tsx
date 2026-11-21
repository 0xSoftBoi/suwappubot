'use client';

import { useState } from 'react';
import { track } from '@/lib/analytics';

/** Small copy button for one command or path in a reference table. */
export default function CopyChip({ text, slug, lang }: { text: string; slug: string; lang: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
      track('solve_snippet_copied', { slug, lang, surface: 'product' });
    } catch { /* clipboard unavailable: the text is selectable */ }
  };
  return (
    <button type="button" className="pd-copy" onClick={copy} aria-label={`Copy ${text}`}>
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}
