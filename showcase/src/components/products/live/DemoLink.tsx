'use client';

import { useLiveSlug } from './ApiKeyProvider';
import { track } from '@/lib/analytics';
import './live.css';

const DEMOS: Record<string, { href: string; label: string; note: string }> = {
  autopilot: { href: '/autopilot', label: 'Open the live paper desk', note: 'Paper money only. Decisions, positions and the journal are read from the production API on that page.' },
  arbiter: { href: '/arbiter', label: 'Open the arbiter and run a checked run', note: 'Preview. The page runs the checked trade run in your browser.' },
  'agent-desk': { href: '/agent-terminal', label: 'Open the agent desk preview', note: 'Preview. Sign-off stays with a human.' },
};

export default function DemoLink() {
  const slug = useLiveSlug();
  const d = DEMOS[slug];
  if (!d) return null;
  return (
    <section className="lv lv-panel">
      <h3>Try it</h3>
      <p className="lv-note" style={{ margin: 0 }}>{d.note}</p>
      <div className="lv-actions"><a className="lv-btn lv-btn--primary" href={d.href} onClick={() => track('widget_run', { slug, widget: 'demo_link', outcome: 'open' })}>{d.label}</a></div>
    </section>
  );
}
