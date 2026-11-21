'use client';

import dynamic from 'next/dynamic';
import ApiKeyProvider from './live/ApiKeyProvider';
import type { WidgetId } from './tryConfig';

const Loading = () => <div className="lv-panel" style={{ minHeight: '14rem' }} aria-busy="true"><p className="lv-empty">Loading…</p></div>;
const load = (p: Promise<{ default: React.ComponentType }>) => p;
const Console = dynamic(() => load(import('./live/LiveConsole')), { ssr: false, loading: Loading });
const KeyOnly = dynamic(() => import('./live/KeyBar'), { ssr: false, loading: Loading });

const Mcp = dynamic(() => import('./live/McpBrowser'), { ssr: false, loading: Loading });
const Policy = dynamic(() => import('./live/PolicyBuilder'), { ssr: false, loading: Loading });
const Billing = dynamic(() => import('./live/BillingPanel'), { ssr: false, loading: Loading });
const Terminal = dynamic(() => import('./live/TerminalLinkBuilder'), { ssr: false, loading: Loading });
const Fees = dynamic(() => import('./live/FeesPanel'), { ssr: false, loading: Loading });
const Demo = dynamic(() => import('./live/DemoLink'), { ssr: false, loading: Loading });
const Command = dynamic(() => import('./live/CommandBuilder'), { ssr: false, loading: Loading });

const MAP: Partial<Record<WidgetId, React.ComponentType>> = {
  console: Console,
  keyonly: KeyOnly,
  mcp: Mcp, policy: Policy, billing: Billing, terminal: Terminal, fees: Fees, demo: Demo,
};

/** Client boundary: widgets load only on pages that use them, so product pages stay static. */
export default function TryLoader({ slug, widgets, commands }: { slug: string; widgets: WidgetId[]; commands?: { command: string; does: string }[] }) {
  return (
    <ApiKeyProvider slug={slug}>
      <div className="lv-stack">
        {widgets.map((w) => {
          if (w === 'command') return commands?.length ? <Command key={w} commands={commands} /> : null;
          const C = MAP[w];
          return C ? <C key={w} /> : null;
        })}
      </div>
    </ApiKeyProvider>
  );
}
