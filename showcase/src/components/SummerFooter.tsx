import { TELEGRAM_URL } from '@/lib/links';
import FooterNewsletterForm from './FooterNewsletterForm';
import stats from '@/data/stats.generated.json';

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
      { label: 'Enterprise', href: '/enterprise' },
      { label: 'Trading agents', href: '/solutions/trading-agents' },
      { label: 'Portfolio agents', href: '/solutions/portfolio-agents' },
      { label: 'Agent payments', href: '/solutions/agent-payments' },
      { label: 'Embedded wallets', href: '/solutions/embedded-wallets' },
      { label: 'Compare', href: '/compare' },
    ],
  },
  {
    title: 'Developers',
    links: [
      { label: 'Documentation', href: '/docs' },
      { label: 'API Reference', href: '/docs/api-reference/overview' },
      { label: 'Architecture', href: '/architecture' },
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
          <p>Cross-chain execution for agents and humans: routed swaps, HyperLiquid perps, and gas-sponsored Tempo trades across {stats.platformChains} platform chains.</p>
          <div className="summer-footer__social">
            <a href={X_URL} target="_blank" rel="noopener noreferrer" aria-label="X (Twitter)">X</a>
            <a href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer" aria-label="Telegram">Telegram</a>
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" aria-label="GitHub">GitHub</a>
          </div>
          <FooterNewsletterForm />
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

      {/* Legal line: prose only. No compliance badges we do not actually hold. */}
      <div className="summer-footer__legal">
        <p>
          Suwappu is execution software, not a broker, exchange, investment adviser, or custodian.
          Connect your own wallet and you keep your keys; we never take discretionary control of your
          funds and we do not provide financial, tax, or legal advice. Digital-asset trading carries
          risk of total loss. See our{' '}
          <a href="/legal/risk">risk disclosures</a>, <a href="/legal/terms">terms</a>, and{' '}
          <a href="/legal/privacy">privacy policy</a>.
        </p>
        <p>
          Legal enquiries <a href="mailto:legal@suwappu.bot">legal@suwappu.bot</a> · Security disclosure{' '}
          <a href="mailto:security@suwappu.bot">security@suwappu.bot</a> · Sales{' '}
          <a href="/contact">contact form</a>
        </p>
      </div>

      <div className="summer-footer__bottom">
        <span>&copy; 2026 Suwappu. All rights reserved.</span>
        <span>You sign every swap by default; bring your own keys for full self-custody. Crypto trading carries risk.</span>
      </div>
    </footer>
  );
}
