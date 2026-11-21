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

/** Conventional shape: Products / Solutions / Developers / Resources, then
 * Pricing as a flat link (see SummerNav). Every public route lives in exactly
 * one of these panels; a few appear in two where both audiences look for them. */
export const MENU_PANELS: MenuPanel[] = [
  {
    key: 'products', id: 'products', groups: [
      { key: 'grpTrade', items: [
        { key: 'terminal', href: TERMINAL_URL, external: true },
        { key: 'bot', href: TELEGRAM_URL, external: true },
        { key: 'miniApp', href: MINI_APP_URL, external: true },
        { key: 'autopilot', href: '/autopilot' },
      ]},
      { key: 'grpMarkets', items: [
        { key: 'swaps', href: '/#engine' },
        { key: 'perps', href: '/#hyperliquid' },
        { key: 'tempo', href: '/#tempo' },
        { key: 'curve', href: '/#curve' },
        { key: 'signals', href: '/signals' },
      ]},
      { key: 'grpAgents', items: [
        { key: 'agentApi', href: '/agents' },
        { key: 'agentDesk', href: '/agent-terminal' },
        { key: 'passport', href: '/passport' },
        { key: 'arbiter', href: '/arbiter' },
      ]},
    ],
  },
  {
    key: 'solutions', id: 'solutions', groups: [
      { key: 'grpAudience', items: [
        { key: 'forTraders', href: '/solve#trader' },
        { key: 'forBuilders', href: '/solve#developer' },
        { key: 'forDesks', href: '/solve#desk' },
      ]},
      { key: 'grpExplore', items: [
        { key: 'solve', href: '/solve' },
        { key: 'solutions', href: '/solutions' },
        { key: 'enterprise', href: '/enterprise' },
        { key: 'government', href: '/government' },
      ]},
    ],
  },
  {
    key: 'developers', id: 'developers', groups: [
      { key: 'grpBuild', items: [
        { key: 'start', href: '/start' },
        { key: 'agentApi', href: '/agents' },
        { key: 'mcp', href: '/docs/quick-start/mcp-clients' },
        { key: 'sdks', href: '/docs/quick-start/sdk-examples' },
      ]},
      { key: 'grpReference', items: [
        { key: 'docs', href: '/docs' },
        { key: 'apiRef', href: '/docs/api-reference/overview' },
        { key: 'openapi', href: 'https://api.suwappu.bot/v1/agent/openapi', external: true },
        { key: 'status', href: '/status' },
        { key: 'github', href: GITHUB_URL, external: true },
      ]},
    ],
  },
  {
    key: 'resources', id: 'resources', groups: [
      { key: 'grpLearn', items: [
        { key: 'research', href: '/research' },
        { key: 'changelog', href: '/changelog' },
        { key: 'security', href: '/security' },
        { key: 'architecture', href: '/architecture' },
        { key: 'compare', href: '/compare' },
      ]},
      { key: 'grpCompany', items: [
        { key: 'about', href: '/about' },
        { key: 'careers', href: '/careers' },
        { key: 'contact', href: '/contact' },
      ]},
    ],
  },
];
