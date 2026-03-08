export interface ChainItem {
  name: string;
  type: 'chain' | 'partner';
}

export const CHAINS: ChainItem[] = [
  { name: 'Ethereum', type: 'chain' },
  { name: 'BSC', type: 'chain' },
  { name: 'Polygon', type: 'chain' },
  { name: 'Arbitrum', type: 'chain' },
  { name: 'Optimism', type: 'chain' },
  { name: 'Base', type: 'chain' },
  { name: 'Avalanche', type: 'chain' },
  { name: 'Fantom', type: 'chain' },
  { name: 'Linea', type: 'chain' },
  { name: 'Mantle', type: 'chain' },
  { name: 'Gnosis', type: 'chain' },
  { name: 'Scroll', type: 'chain' },
  { name: 'Solana', type: 'chain' },
  { name: 'Sui', type: 'chain' },
  { name: 'TON', type: 'chain' },
  { name: 'Li.Fi', type: 'partner' },
  { name: 'Jupiter', type: 'partner' },
  { name: 'CoW Protocol', type: 'partner' },
  { name: 'Wormhole', type: 'partner' },
  { name: 'Turnkey', type: 'partner' },
];
