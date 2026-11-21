'use client';

import { useState } from 'react';
import { Accordion, AccordionHeader, AccordionItem, AccordionPanel, AccordionTrigger } from '@ui-sdk/react/accordion';
import { track } from '@/lib/analytics';
import type { CallResult } from './api';

export function CopyBtn({ text, label = 'Copy', slug, what }: { text: string; label?: string; slug?: string; what?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button" className="lv-btn lv-btn--ghost"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true); setTimeout(() => setDone(false), 1600);
          if (slug) track('solve_snippet_copied', { slug, lang: what ?? 'live', surface: 'product' });
        } catch { /* selectable text remains */ }
      }}
    ><span aria-hidden={done || undefined}>{done ? 'Copied' : label}</span><span className="sr-only" role="status" aria-live="polite">{done ? 'Copied' : ''}</span></button>
  );
}

export function Json({ data, label = 'Raw JSON', open = false }: { data: unknown; label?: string; open?: boolean }) {
  const full = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  const text = full.length > 120000 ? `${full.slice(0, 120000)}\n… truncated (${full.length} characters in total)` : full;
  return (
    <Accordion defaultValue={open ? ['j'] : []} multiple className="lv-acc">
      <AccordionItem value="j" className="lv-acc__item">
        <AccordionHeader className="lv-acc__h">
          <AccordionTrigger className="lv-acc__trigger">
            <span>{label}</span>
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M5 8l5 5 5-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </AccordionTrigger>
        </AccordionHeader>
        <AccordionPanel className="lv-acc__panel"><pre className="lv-pre" tabIndex={0}>{text}</pre></AccordionPanel>
      </AccordionItem>
    </Accordion>
  );
}

/** Status line for any real call: code, time, the credits header if the browser could read one. */
export function ResultMeta({ r }: { r: CallResult }) {
  return (
    <p className={`lv-meta ${r.ok ? 'lv-meta--ok' : 'lv-meta--bad'}`} role="status">
      <strong>{r.status === 0 ? 'No response' : `HTTP ${r.status}`}</strong>
      <span>{r.ms} ms</span>
    </p>
  );
}

export function ErrorBox({ r, onRetry, children }: { r: CallResult; onRetry?: () => void; children?: React.ReactNode }) {
  return (
    <div className="lv-error" role="alert">
      <strong>{r.status === 0 ? 'Request failed' : `The API returned ${r.status}`}</strong>
      <p>{r.error}</p>
      {children}
      {onRetry && <button type="button" className="lv-btn lv-btn--ghost" onClick={onRetry}>Retry</button>}
    </div>
  );
}
