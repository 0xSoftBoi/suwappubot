import type { Metadata } from 'next';
import SummerNav from '@/components/SummerNav';
import SummerFooter from '@/components/SummerFooter';
import StatusBoard from './StatusBoard';
import { TELEGRAM_URL, TERMINAL_URL } from '@/lib/links';
import { Reveal, V3Section, SectionHead, Backdrop } from '@/components/v3';
import '../content-v3.css';

export const metadata: Metadata = {
  title: 'Status',
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
    <div className="summer-page docs-shell institutional-page v3-tone-light cv3-page">
      <SummerNav />
      <main id="main-content">
        <div className="cv3-hero cv3-hero--solo">
          <Backdrop kind="mesh" />
          <Backdrop kind="grid" />
          <div className="v3-wrap">
            <header>
              <p className="v3-kicker">System status</p>
              <h1>Suwappu Status</h1>
              <p className="cv3-lead">
                Live API-origin checks plus an honest map of surfaces that are not independently
                probed here.
              </p>
            </header>
            <div className="cv3-status-board"><StatusBoard /></div>
          </div>
        </div>

        <V3Section tone="light" className="cv3-sec cv3-pad-bottom" labelledBy="status-surfaces">
          <SectionHead title="Surfaces" id="status-surfaces" />
          <Reveal stagger className="cv3-num-grid cv3-num-grid--5">
            {SURFACES.map((s) => {
              const external = s.href.startsWith('http');
              return (
                <a
                  className="cv3-num cv3-num--link"
                  href={s.href}
                  key={s.name}
                  target={external ? '_blank' : undefined}
                  rel={external ? 'noopener noreferrer' : undefined}
                >
                  <h3>
                    {s.name}
                    {external && (
                      <>
                        <span aria-hidden="true"> ↗</span>
                        <span className="sr-only"> (opens in a new tab)</span>
                      </>
                    )}
                  </h3>
                  <p>{s.desc}</p>
                </a>
              );
            })}
          </Reveal>
        </V3Section>
      </main>
      <SummerFooter />
    </div>
  );
}
