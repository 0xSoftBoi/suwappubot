import type { Metadata } from 'next';
import Navigation from '@/components/Navigation';
import SummerFooter from '@/components/SummerFooter';
import StatusBoard from './StatusBoard';
import { TELEGRAM_URL, TERMINAL_URL } from '@/lib/links';
import styles from './status.module.css';

export const metadata: Metadata = {
  title: 'Status | Suwappu',
  description:
    'Live health checks for Suwappu API origins plus an explicit map of interfaces that are not independently probed here.',
};

// Only the API origins receive live health dots. The remaining surfaces are
// linked for topology/reference and deliberately do not inherit API uptime.
const SURFACES = [
  {
    name: 'REST API',
    desc: 'Production API origin health is checked live below at api.suwappu.bot/health; individual v1/agent routes are not exercised.',
    href: '/docs/api-reference/overview',
  },
  {
    name: 'MCP server',
    desc: 'Hosted at api.suwappu.bot/mcp. This page does not run a dedicated MCP protocol check.',
    href: '/docs/protocols/mcp',
  },
  {
    name: 'A2A protocol',
    desc: 'Hosted at api.suwappu.bot/a2a. This page does not run a dedicated A2A protocol check.',
    href: '/docs/protocols/mcp',
  },
  {
    name: 'Telegram bot',
    desc: 'Separate bot surface. It is linked for reference and is not independently health-checked here.',
    href: TELEGRAM_URL,
  },
  {
    name: 'Trading terminal',
    desc: 'Hosted trading surface at terminal.suwappu.bot. It is not independently health-checked here.',
    href: TERMINAL_URL,
  },
];

export default function StatusPage() {
  return (
    <div className="summer-page docs-shell sw-dark">
      <Navigation />
      <main id="main-content">
        <div className="summer-shell mkt-page">
          <header className="mkt-hero mkt-hero--center">
            <p className="summer-kicker">System status</p>
            <h1>Suwappu Status</h1>
            <p className="mkt-hero__lead">
              Live API-origin checks plus an honest map of surfaces that are not independently
              probed here.
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
      </main>
      <SummerFooter />
    </div>
  );
}
