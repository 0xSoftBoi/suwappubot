export interface FeatureItem {
  title: string;
  description: string;
  stat: string;
  color: string;
  iconPath: string;
}

export const FEATURES: FeatureItem[] = [
  {
    title: 'Cross-chain routing',
    description: '9 swap providers across 15 chains. Li.Fi, CoW, and Socket for EVM; Jupiter for Solana; Wormhole and CCTP for bridging. Best rate, every time.',
    stat: '15 chains',
    color: 'from-suwappu-sakura-mid to-suwappu-magenta-mid',
    iconPath: 'M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5',
  },
  {
    title: 'Your keys, your wallet',
    description: 'Wallets are backed by Turnkey TEE hardware. Private keys never leave the secure enclave. 2FA, whitelisting, and spending limits built in.',
    stat: 'Non-custodial',
    color: 'from-suwappu-purple to-suwappu-purple-deep',
    iconPath: 'M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z',
  },
  {
    title: 'MEV protection',
    description: 'CoW Protocol on EVM and Jito bundles on Solana. Your swaps are shielded from frontrunning and sandwich attacks by default.',
    stat: 'MEV-shielded',
    color: 'from-suwappu-magenta to-suwappu-purple',
    iconPath: 'M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z',
  },
  {
    title: 'Advanced orders',
    description: 'Limit orders, DCA scheduling, trailing stop-loss, and multi take-profit targets. Set it and forget it.',
    stat: '5 order types',
    color: 'from-suwappu-purple-deep to-suwappu-purple',
    iconPath: 'M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z',
  },
  {
    title: 'Works where you already are',
    description: 'Telegram bot, Mini App, WhatsApp, Discord, or the iOS app. Same wallet, same funds, pick whichever.',
    stat: '5 interfaces',
    color: 'from-suwappu-magenta-mid to-suwappu-sakura-mid',
    iconPath: 'M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3',
  },
  {
    title: 'Sub-second quotes',
    description: 'Quotes come back in under a second. Prices update live. Hit confirm and the tx goes out immediately.',
    stat: '< 1s',
    color: 'from-suwappu-sakura-mid to-suwappu-magenta',
    iconPath: 'M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z',
  },
];
