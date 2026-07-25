// Display-only chain metadata for the webapp (names, icon fallbacks, explorer links).
// Keep in sync with api-ts/src/config/chains.ts — this module must stay presentation-only
// (no RPC URLs, no signing logic).

export interface ChainDisplay {
  /** Human-readable chain name */
  name: string
  /** Emoji fallback icon (webapp has no chain image assets) */
  icon: string
  /** Explorer base URL, no trailing slash */
  explorerUrl: string
}

export const CHAIN_DISPLAY: Record<string, ChainDisplay> = {
  ethereum: { name: 'Ethereum', icon: '⟠', explorerUrl: 'https://etherscan.io' },
  optimism: { name: 'Optimism', icon: '\u{1F534}', explorerUrl: 'https://optimistic.etherscan.io' },
  bsc: { name: 'BNB Chain', icon: '\u{1F7E1}', explorerUrl: 'https://bscscan.com' },
  polygon: { name: 'Polygon', icon: '\u{1F7E3}', explorerUrl: 'https://polygonscan.com' },
  base: { name: 'Base', icon: '\u{1F535}', explorerUrl: 'https://basescan.org' },
  arbitrum: { name: 'Arbitrum', icon: '\u{1F537}', explorerUrl: 'https://arbiscan.io' },
  solana: { name: 'Solana', icon: '\u{1F30A}', explorerUrl: 'https://solscan.io' },
  tempo: { name: 'Tempo', icon: '⏱️', explorerUrl: 'https://explore.tempo.xyz' },
  plasma: { name: 'Plasma', icon: '⚡', explorerUrl: 'https://plasmascan.to' },
  starknet: { name: 'Starknet', icon: '\u{1F680}', explorerUrl: 'https://voyager.online' },
  goat: { name: 'GOAT Network', icon: '\u{1F410}', explorerUrl: 'https://explorer.goat.network' },
  avalanche: { name: 'Avalanche', icon: '\u{1F53A}', explorerUrl: 'https://snowtrace.io' },
}

/** Resolve display metadata for a chain key (case-insensitive); falls back to the raw key. */
export function getChainDisplay(chain: string): ChainDisplay {
  const key = chain.toLowerCase().trim()
  return (
    CHAIN_DISPLAY[key] ?? {
      name: chain,
      icon: '\u{1F517}',
      explorerUrl: 'https://etherscan.io',
    }
  )
}

/** Build an explorer transaction link for a chain key. */
export function getExplorerTxUrl(chain: string, txHash: string): string {
  return `${getChainDisplay(chain).explorerUrl}/tx/${txHash}`
}
