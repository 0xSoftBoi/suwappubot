import {
  TELEGRAM_URL,
  TERMINAL_URL,
  MINI_APP_URL,
  GITHUB_URL,
} from '@/lib/links';

/**
 * The mega-menu contents.
 *
 * Every entry points at something that actually ships today. Descriptions are
 * short on purpose: the menu is a directory, not a feature page. Labels are
 * resolved through next-intl (`nav.menu.*`) so the menu translates with the
 * rest of the site.
 */

export type MenuItem = {
  /** i18n key suffix under `nav.menu`. */
  key: string;
  href: string;
  external?: boolean;
};

export type MenuGroup = {
  /** i18n key suffix under `nav.menu` for the column heading. */
  key: string;
  items: MenuItem[];
};

export type MenuPanel = {
  /** i18n key suffix under `nav.menu` for the trigger label. */
  key: string;
  id: string;
  groups: MenuGroup[];
};

export const MENU_PANELS: MenuPanel[] = [
  {
    key: 'products',
    id: 'products',
    groups: [
      {
        key: 'grpTrade',
        items: [
          { key: 'terminal', href: TERMINAL_URL, external: true },
          { key: 'bot', href: TELEGRAM_URL, external: true },
          { key: 'miniApp', href: MINI_APP_URL, external: true },
        ],
      },
      {
        key: 'grpMarkets',
        items: [
          { key: 'swaps', href: '/#engine' },
          { key: 'perps', href: '/#hyperliquid' },
          { key: 'tempo', href: '/#tempo' },
        ],
      },
    ],
  },
  {
    key: 'developers',
    id: 'developers',
    groups: [
      {
        key: 'grpBuild',
        items: [
          { key: 'agentApi', href: '/agents' },
          { key: 'mcp', href: '/docs/quick-start/mcp-clients' },
          { key: 'sdks', href: '/docs/quick-start/sdk-examples' },
        ],
      },
      {
        key: 'grpReference',
        items: [
          { key: 'docs', href: '/docs' },
          { key: 'apiRef', href: '/docs/api-reference/overview' },
          { key: 'github', href: GITHUB_URL, external: true },
        ],
      },
    ],
  },
  {
    key: 'company',
    id: 'company',
    groups: [
      {
        key: 'grpWhy',
        items: [
          { key: 'solutions', href: '/solutions' },
          { key: 'compare', href: '/compare' },
          { key: 'security', href: '/security' },
        ],
      },
      {
        key: 'grpMore',
        items: [
          { key: 'research', href: '/research' },
          { key: 'changelog', href: '/changelog' },
          { key: 'status', href: '/status' },
        ],
      },
    ],
  },
];
