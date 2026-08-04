import { TELEGRAM_URL } from '@/lib/links';

const TERMINAL_URL = 'https://terminal.suwappu.bot';
const GITHUB_URL = 'https://github.com/0xSoftBoi/suwappubot';
const X_URL = 'https://x.com/suwappubot';

const columns: { title: string; links: { label: string; href: string; external?: boolean }[] }[] = [
  {
    title: 'Product',
    links: [
      { label: 'Terminal', href: TERMINAL_URL, external: true },
      { label: 'Telegram Bot', href: TELEGRAM_URL, external: true },
      { label: 'Agent API', href: '/docs/api-reference/overview' },
      { label: 'TypeScript SDK', href: '/docs/quick-start/sdk-examples' },
      { label: 'MCP Server', href: '/docs/protocols/mcp' },
      { label: 'Pricing', href: '/pricing' },
    ],
  },
  {
    title: 'Solutions',
    links: [
      { label: 'Trading agents', href: '/solutions#trading' },
      { label: 'Portfolio agents', href: '/solutions#portfolio' },
      { label: 'Payment & commerce agents', href: '/solutions#payments' },
      { label: 'Embedded wallets', href: '/solutions#wallets' },
      { label: 'Compare', href: '/compare' },
    ],
  },
  {
    title: 'Developers',
    links: [
      { label: 'Documentation', href: '/docs' },
      { label: 'API Reference', href: '/docs/api-reference/overview' },
      { label: 'Changelog', href: '/changelog' },
      { label: 'Research', href: '/research' },
      { label: 'llms.txt', href: '/llms.txt', external: true },
      { label: 'Status', href: '/status' },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'About', href: '/about' },
      { label: 'Security', href: '/security' },
      { label: 'Careers', href: '/careers' },
      { label: 'GitHub', href: GITHUB_URL, external: true },
      { label: 'Contact', href: TELEGRAM_URL, external: true },
    ],
  },
  {
    title: 'Legal',
    links: [
      { label: 'Terms of Service', href: '/legal/terms' },
      { label: 'Privacy Policy', href: '/legal/privacy' },
      { label: 'Risk Disclosures', href: '/legal/terms#risk' },
    ],
  },
];

export default function SummerFooter() {
  return (
    <footer aria-label="Site footer" className="border-t border-white/10 bg-[var(--canvas-1)]">
      <div className="mx-auto grid max-w-7xl gap-12 px-6 py-16 md:grid-cols-[1.3fr_2.7fr] md:gap-8">
        <div className="flex flex-col gap-4">
          <a href="/" className="flex items-center gap-2 font-display text-lg font-medium text-[var(--ink-0)]">
            <img src="/logo.svg" alt="" aria-hidden="true" className="h-6 w-6" />
            <span>suwappu</span>
          </a>
          <p className="max-w-xs text-sm leading-relaxed text-[var(--ink-1)]">
            Cross-chain execution for agents and humans — best-price swaps, HyperLiquid perps, and
            gasless trades across 40+ chains.
          </p>
          <div className="flex gap-4 text-sm text-[var(--ink-1)]">
            <a href={X_URL} target="_blank" rel="noopener noreferrer" aria-label="X (Twitter)" className="hover:text-[var(--ink-0)]">X</a>
            <a href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer" aria-label="Telegram" className="hover:text-[var(--ink-0)]">Telegram</a>
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" aria-label="GitHub" className="hover:text-[var(--ink-0)]">GitHub</a>
          </div>
        </div>

        <nav aria-label="Footer navigation" className="grid grid-cols-2 gap-8 sm:grid-cols-3 md:grid-cols-5">
          {columns.map((col) => (
            <div key={col.title}>
              <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-[var(--ink-1)]">
                {col.title}
              </h3>
              <ul className="flex flex-col gap-2">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <a
                      href={l.href}
                      {...(l.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                      className="text-sm text-[var(--ink-0)] transition-colors hover:text-[var(--accent)]"
                    >
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>

      <div className="mx-auto flex max-w-7xl flex-col gap-2 border-t border-white/5 px-6 py-6 text-xs text-[var(--ink-1)] md:flex-row md:justify-between">
        <span>&copy; 2026 Suwappu. All rights reserved.</span>
        <span>Non-custodial where you bring your own keys. Crypto trading carries risk.</span>
      </div>
    </footer>
  );
}
