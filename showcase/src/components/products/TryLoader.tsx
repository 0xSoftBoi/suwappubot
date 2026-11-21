'use client';

import dynamic from 'next/dynamic';
import ApiKeyProvider from './live/ApiKeyProvider';
import type { WidgetId } from './tryConfig';

const load = (p: Promise<{ default: React.ComponentType }>) => p;
const Console = dynamic(() => load(import('./live/LiveConsole')), { ssr: false, loading: () => <p className="lv-empty">Loading…</p> });
const KeyOnly = dynamic(() => import('./live/KeyBar'), { ssr: false });

const MAP: Partial<Record<WidgetId, React.ComponentType>> = {
  console: Console,
  keyonly: KeyOnly,
};

/** Client boundary: widgets load only on pages that use them, so product pages stay static. */
export default function TryLoader({ slug, widgets }: { slug: string; widgets: WidgetId[] }) {
  return (
    <ApiKeyProvider slug={slug}>
      <div className="lv-stack">
        {widgets.map((w) => { const C = MAP[w]; return C ? <C key={w} /> : null; })}
      </div>
    </ApiKeyProvider>
  );
}
