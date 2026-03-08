export interface FAQItem {
  q: string;
  a: string;
}

export const FAQ_ITEMS: FAQItem[] = [
  { q: 'Is it really non-custodial?', a: 'Yes. Wallets run inside Turnkey TEE hardware. Your private keys never leave the secure enclave \u2014 not even we can access them. You can export your wallet at any time.' },
  { q: 'What chains does it support?', a: '15 chains: Ethereum, BSC, Polygon, Arbitrum, Optimism, Base, Avalanche, Fantom, Linea, Mantle, Gnosis, Scroll, Solana, Sui, and TON. EVM chains route through Li.Fi, CoW, and Socket; Solana through Jupiter; cross-chain via Wormhole and CCTP.' },
  { q: 'How does routing work?', a: 'When you send /s [amount] [from] [to], the bot queries 9 swap providers \u2014 Li.Fi, CoW Protocol, Socket, Jupiter, CCTP, Across, Wormhole, LayerZero, and Chainlink CCIP \u2014 picks the best rate, and shows it to you. You see the exact output and fee before confirming.' },
  { q: 'What does it cost?', a: '0.3% per swap. No subscription, no hidden fees. Gas is paid from your wallet as usual.' },
  { q: 'Do I need to install anything?', a: 'No. The Telegram, WhatsApp, and Discord bots work in-app \u2014 just search @suwappu_bot. The Mini App runs inside Telegram too. Only the iOS app requires a download.' },
  { q: 'How fast is it?', a: 'Quotes arrive in under a second. After you confirm, the tx is submitted immediately. Settlement depends on the chain \u2014 a few seconds on L2s, ~15s on Ethereum.' },
];
