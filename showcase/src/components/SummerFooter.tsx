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
      { label: 'Talk to sales', href: '/contact' },
      { label: 'Telegram', href: TELEGRAM_URL, external: true },
    ],
  },
  {
    title: 'Legal',
    links: [
      { label: 'Terms of Service', href: '/legal/terms' },
      { label: 'Privacy Policy', href: '/legal/privacy' },
      { label: 'Risk Disclosures', href: '/legal/risk' },
    ],
  },
];

export default function SummerFooter() {
  return (
    <footer className="summer-footer" aria-label="Site footer">
      <div className="summer-footer__inner">
        <div className="summer-footer__brand">
          <a href="/" className="summer-footer__logo">
            <img src="/logo.svg" alt="" aria-hidden="true" />
            <span>suwappu</span>
          </a>
          <p>Cross-chain execution for agents and humans — best-price swaps, HyperLiquid perps, and gasless trades across 40+ chains.</p>
          <div className="summer-footer__social">
            <a href={X_URL} target="_blank" rel="noopener noreferrer" aria-label="X (Twitter)">X</a>
            <a href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer" aria-label="Telegram">Telegram</a>
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" aria-label="GitHub">GitHub</a>
          </div>
        </div>

        <nav className="summer-footer__cols" aria-label="Footer navigation">
          {columns.map((col) => (
            <div className="summer-footer__col" key={col.title}>
              <h3>{col.title}</h3>
              <ul>
                {col.links.map((l) => (
                  <li key={l.label}>
                    <a
                      href={l.href}
                      {...(l.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
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

      <div className="summer-footer__bottom">
        <span>&copy; 2026 Suwappu. All rights reserved.</span>
        <span>Non-custodial where you bring your own keys. Crypto trading carries risk.</span>
      </div>
    </footer>
  );
}
