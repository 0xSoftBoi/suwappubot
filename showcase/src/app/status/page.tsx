import type { Metadata } from 'next';
import Navigation from '@/components/Navigation';
import SummerFooter from '@/components/SummerFooter';
import StatusBoard from './StatusBoard';
import { TELEGRAM_URL } from '@/lib/links';
import styles from './status.module.css';

export const metadata: Metadata = {
  title: 'Status — Suwappu',
  description:
    'Live health checks for the Suwappu API, plus how the MCP server, A2A protocol, Telegram bot, and trading terminal map onto that same backend.',
};

// Surfaces that ride on top of the API checked live above. MCP and A2A are
// the same Hono process as the REST API (no separate health endpoint to
// poll), so their status mirrors it 1:1. The bot and terminal are Telegram
// clients, not independently pollable services — linked here for reference
// rather than faked with a synthetic health dot.
const SURFACES = [
  {
    name: 'REST API',
    desc: 'v1/agent/* — checked live below against api.suwappu.bot/health.',
    href: '/docs/api-reference/overview',
  },
  {
    name: 'MCP server',
    desc: 'POST /mcp on the same backend process as the API — healthy whenever the API above is.',
    href: '/docs/protocols/mcp',
  },
  {
    name: 'A2A protocol',
    desc: 'POST /a2a, also served from the API process — same uptime as the API above.',
    href: '/docs/protocols/mcp',
  },
  {
    name: 'Telegram bot',
    desc: 'Runs as a single polling instance against the API. Not independently health-checked here.',
    href: TELEGRAM_URL,
  },
  {
    name: 'Trading terminal',
    desc: 'Executes through the same API and wallet infrastructure as everything else on this page.',
    href: TELEGRAM_URL,
  },
];

export default function StatusPage() {
  return (
    <main id="main-content" className="summer-page docs-shell">
      <Navigation />
      <div className="summer-shell mkt-page">
        <header className="mkt-hero mkt-hero--center">
          <p className="summer-kicker">System status</p>
          <h1>Suwappu Status</h1>
          <p className="mkt-hero__lead">
            Live checks against the API that every surface below is built on, plus an honest map
            of how MCP, A2A, the bot, and the terminal relate to it.
          </p>
        </header>

        <StatusBoard />

        <section className="status-surfaces" aria-label="Surfaces">
          <h2 className="mkt-h2">Surfaces</h2>
          <div className={`sw-rows ${styles.surfaces}`}>
            {SURFACES.map((s) => {
              const external = s.href.startsWith('http');
              return (
                <a
                  className={`sw-row ${styles.row}`}
                  href={s.href}
                  key={s.name}
                  target={external ? '_blank' : undefined}
                  rel={external ? 'noopener noreferrer' : undefined}
                >
                  <h3>
                    {s.name}
                    {external && (
                      <>
                        <span className={styles.external} aria-hidden="true"> ↗</span>
                        <span className="sr-only"> (opens in a new tab)</span>
                      </>
                    )}
                  </h3>
                  <p>{s.desc}</p>
                </a>
              );
            })}
          </div>
        </section>
      </div>
      <SummerFooter />
    </main>
  );
}
