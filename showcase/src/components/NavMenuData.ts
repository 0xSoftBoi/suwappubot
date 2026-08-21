import {
  TELEGRAM_URL,
  TERMINAL_URL,
  MINI_APP_URL,
  GITHUB_URL,
} from '@/lib/links';

/** One product map for every public header. If a capability ships but is not
 * reachable from here (or /products), it is not discoverable enough to count. */
export type MenuItem = { key: string; href: string; external?: boolean };
export type MenuGroup = { key: string; items: MenuItem[] };
export type MenuPanel = { key: string; id: string; groups: MenuGroup[] };

export const MENU_PANELS: MenuPanel[] = [
  {
    key: 'products', id: 'products', groups: [
      { key: 'grpTrade', items: [
        { key: 'terminal', href: TERMINAL_URL, external: true },
        { key: 'bot', href: TELEGRAM_URL, external: true },
        { key: 'miniApp', href: MINI_APP_URL, external: true },
      ]},
      { key: 'grpMarkets', items: [
        { key: 'swaps', href: '/#engine' },
        { key: 'perps', href: '/#hyperliquid' },
        { key: 'tempo', href: '/#tempo' },
        { key: 'signals', href: '/signals' },
      ]},
    ],
  },
  {
    key: 'developers', id: 'developers', groups: [
      { key: 'grpBuild', items: [
        { key: 'agentApi', href: '/agents' },
        { key: 'mcp', href: '/docs/quick-start/mcp-clients' },
        { key: 'sdks', href: '/docs/quick-start/sdk-examples' },
      ]},
      { key: 'grpReference', items: [
        { key: 'docs', href: '/docs' },
        { key: 'apiRef', href: '/docs/api-reference/overview' },
        { key: 'architecture', href: '/architecture' },
        { key: 'github', href: GITHUB_URL, external: true },
      ]},
    ],
  },
  {
    key: 'company', id: 'company', groups: [
      { key: 'grpWhy', items: [
        { key: 'enterprise', href: '/enterprise' },
        { key: 'solutions', href: '/solutions' },
        { key: 'compare', href: '/compare' },
        { key: 'security', href: '/security' },
      ]},
      { key: 'grpMore', items: [
        { key: 'research', href: '/research' },
        { key: 'changelog', href: '/changelog' },
        { key: 'status', href: '/status' },
      ]},
    ],
  },
];
