// Display-only chain metadata for the webapp (names, icon fallbacks, explorer links).
// Keep in sync with api-ts/src/config/chains.ts and bot/config/chains.py — this module
// must stay presentation-only (no RPC URLs, no signing logic).

export interface ChainDisplay {
  /** Human-readable chain name */
  name: string
  /** Emoji fallback icon (webapp has no chain image assets) */
  icon: string
  /** Explorer base URL, no trailing slash. Absent when we don't know the chain's explorer. */
  explorerUrl?: string
}

export const CHAIN_DISPLAY: Record<string, ChainDisplay> = {
  ethereum: { name: 'Ethereum', icon: '⟠', explorerUrl: 'https://etherscan.io' },
  optimism: { name: 'Optimism', icon: '\u{1F534}', explorerUrl: 'https://optimistic.etherscan.io' },
  bsc: { name: 'BNB Chain', icon: '\u{1F7E1}', explorerUrl: 'https://bscscan.com' },
  polygon: { name: 'Polygon', icon: '\u{1F7E3}', explorerUrl: 'https://polygonscan.com' },
  base: { name: 'Base', icon: '\u{1F535}', explorerUrl: 'https://basescan.org' },
  'base-sepolia': { name: 'Base Sepolia', icon: '\u{1F9EA}', explorerUrl: 'https://sepolia.basescan.org' },
  arbitrum: { name: 'Arbitrum', icon: '\u{1F537}', explorerUrl: 'https://arbiscan.io' },
  solana: { name: 'Solana', icon: '\u{1F30A}', explorerUrl: 'https://solscan.io' },
  tempo: { name: 'Tempo', icon: '⏱️', explorerUrl: 'https://explore.tempo.xyz' },
  robinhood: { name: 'Robinhood', icon: '🪶', explorerUrl: 'https://robinhoodchain.blockscout.com' },
  plasma: { name: 'Plasma', icon: '⚡', explorerUrl: 'https://plasmascan.to' },
  starknet: { name: 'Starknet', icon: '\u{1F680}', explorerUrl: 'https://voyager.online' },
  goat: { name: 'GOAT Network', icon: '\u{1F410}', explorerUrl: 'https://explorer.goat.network' },
  avalanche: { name: 'Avalanche', icon: '\u{1F53A}', explorerUrl: 'https://snowtrace.io' },
  sepolia: { name: 'Sepolia', icon: '⟠', explorerUrl: 'https://sepolia.etherscan.io' },
  fantom: { name: 'Fantom', icon: '\u{1F47B}', explorerUrl: 'https://ftmscan.com' },
  linea: { name: 'Linea', icon: '\u{1F9F5}', explorerUrl: 'https://lineascan.build' },
  mantle: { name: 'Mantle', icon: '\u{1F3D4}️', explorerUrl: 'https://mantlescan.xyz' },
  gnosis: { name: 'Gnosis', icon: '\u{1F989}', explorerUrl: 'https://gnosisscan.io' },
  scroll: { name: 'Scroll', icon: '\u{1F4DC}', explorerUrl: 'https://scrollscan.com' },
  tron: { name: 'Tron', icon: '\u{1F53B}', explorerUrl: 'https://tronscan.org' },
  rootstock: { name: 'Rootstock', icon: '\u{1FAA8}', explorerUrl: 'https://rootstock.blockscout.com' },
  citrea: { name: 'Citrea', icon: '\u{1F34A}', explorerUrl: 'https://explorer.mainnet.citrea.xyz' },
  sonic: { name: 'Sonic', icon: '\u{1F4A8}', explorerUrl: 'https://sonicscan.org' },
  opbnb: { name: 'opBNB', icon: '\u{1F7E8}', explorerUrl: 'https://opbnb.bscscan.com' },
  fraxtal: { name: 'Fraxtal', icon: '\u{1F9CA}', explorerUrl: 'https://fraxscan.com' },
  zksync: { name: 'zkSync Era', icon: '\u{1F512}', explorerUrl: 'https://explorer.zksync.io' },
  worldchain: { name: 'World Chain', icon: '\u{1F30D}', explorerUrl: 'https://worldscan.org' },
  flow: { name: 'Flow', icon: '\u{1F300}', explorerUrl: 'https://evm.flowscan.io' },
  hyperevm: { name: 'HyperEVM', icon: '\u{1F985}', explorerUrl: 'https://explorer.hyperliquid.xyz' },
  lisk: { name: 'Lisk', icon: '\u{1F331}', explorerUrl: 'https://blockscout.lisk.com' },
  sei: { name: 'Sei', icon: '\u{1F40B}', explorerUrl: 'https://seitrace.com' },
  soneium: { name: 'Soneium', icon: '\u{1F3B5}', explorerUrl: 'https://soneium.blockscout.com' },
  swellchain: { name: 'Swellchain', icon: '\u{1FAE7}', explorerUrl: 'https://explorer.swellnetwork.io' },
  abstract: { name: 'Abstract', icon: '\u{1F3A8}', explorerUrl: 'https://abscan.org' },
  kaia: { name: 'Kaia', icon: '\u{1F33F}', explorerUrl: 'https://kaiascan.io' },
  apechain: { name: 'Apechain', icon: '\u{1F412}', explorerUrl: 'https://apescan.io' },
  mode: { name: 'Mode', icon: '\u{1F39B}️', explorerUrl: 'https://modescan.io' },
  hemi: { name: 'Hemi', icon: '\u{1F317}', explorerUrl: 'https://explorer.hemi.xyz' },
  bob: { name: 'BOB', icon: '\u{1F171}️', explorerUrl: 'https://explorer.gobob.xyz' },
  berachain: { name: 'Berachain', icon: '\u{1F43B}', explorerUrl: 'https://berascan.com' },
  taiko: { name: 'Taiko', icon: '\u{1F941}', explorerUrl: 'https://taikoscan.io' },
  unichain: { name: 'Unichain', icon: '\u{1F984}', explorerUrl: 'https://uniscan.xyz' },
  flare: { name: 'Flare', icon: '\u{1F525}', explorerUrl: 'https://flarescan.com' },
  aurora: { name: 'Aurora', icon: '\u{1F30C}', explorerUrl: 'https://explorer.aurora.dev' },
  blast: { name: 'Blast', icon: '\u{1F4A5}', explorerUrl: 'https://blastscan.io' },
  ink: { name: 'Ink', icon: '\u{1F58B}️', explorerUrl: 'https://explorer.inkonchain.com' },
}

/** Resolve display metadata for a chain key (case-insensitive); falls back to an unbranded entry
 *  with no explorer URL — callers must NOT assume `explorerUrl` is set for unknown chains. */
export function getChainDisplay(chain: string): ChainDisplay {
  const key = chain.toLowerCase().trim()
  return (
    CHAIN_DISPLAY[key] ?? {
      name: chain,
      icon: '\u{1F517}',
    }
  )
}

/*
 * Canonical tx-hash handling. Mirrors bot/utils/tx_hash.py (canonical_tx_hash).
 *
 * swap_transactions.tx_hash holds a MIX of 0x-prefixed and BARE 64-hex hashes
 * (hexbytes 1.x HexBytes.hex() drops the 0x; legacy rows are not rewritten), so
 * readers must tolerate both. Canonical = "0x" + lowercase hex.
 *
 * Chain-aware on purpose: TRON txids are canonically BARE 64-hex (same shape as a
 * bare EVM hash) and Solana signatures are base58 (case-sensitive), so those pass
 * through untouched. A bare hash on an UNKNOWN chain is left alone rather than guessed.
 */
const PASSTHROUGH_CHAINS = new Set(['solana', 'sol', 'tron', 'trx'])
const HEX_PREFIXED_ALIASES = new Set(['eth', 'matic', 'bnb', 'evm'])

function isHexPrefixedChain(chain: string): boolean {
  const key = chain.toLowerCase().trim()
  if (PASSTHROUGH_CHAINS.has(key)) return false
  // Every other entry in CHAIN_DISPLAY is EVM or Starknet (both 0x-prefixed).
  return key in CHAIN_DISPLAY || HEX_PREFIXED_ALIASES.has(key)
}

function hexBody(value: string): string | null {
  const body = /^0x/i.test(value) ? value.slice(2) : value
  return /^[0-9a-fA-F]+$/.test(body) ? body.toLowerCase() : null
}

/** Canonical spelling of a tx hash; returns the input unchanged when it can't be
 *  normalized safely. Never throws. */
export function canonicalTxHash(hash: string, chain?: string | null): string {
  if (typeof hash !== 'string') return hash
  const trimmed = hash.trim()
  if (!trimmed) return hash
  if (chain && PASSTHROUGH_CHAINS.has(chain.toLowerCase().trim())) return trimmed
  const body = hexBody(trimmed)
  if (body === null) return trimmed // base58 or junk
  if (/^0x/i.test(trimmed)) return `0x${body}` // already prefixed: safe on any chain
  if (chain && isHexPrefixedChain(chain)) return `0x${body}`
  return trimmed // bare hex, chain unknown: could be TRON, don't guess
}

/** Display-only shortening. Canonicalizes first (see `canonicalTxHash`), so an EVM hash
 *  renders as `0x1234...abcd` whether stored bare or prefixed. Solana/TRON and
 *  unknown-chain bare values are not given a `0x`. `head`/`tail` count characters of
 *  the canonical string (including any `0x`). */
export function shortTxHash(hash: string, chain?: string | null, head = 6, tail = 4): string {
  const canonical = canonicalTxHash(hash, chain)
  if (canonical.length <= head + tail + 3) return canonical
  return `${canonical.slice(0, head)}...${canonical.slice(-tail)}`
}

/** Build an explorer transaction link for a chain key, or `null` if the chain's explorer
 *  is unknown. Callers must handle the `null` case (e.g. render no link) rather than
 *  falling back to a guessed explorer — a wrong link is worse than no link. */
export function getExplorerTxUrl(chain: string, txHash: string): string | null {
  const { explorerUrl } = getChainDisplay(chain)
  return explorerUrl ? `${explorerUrl}/tx/${canonicalTxHash(txHash, chain)}` : null
}

/** Numeric EVM chain id (as a string) -> CHAIN_DISPLAY key. Only covers chains with a
 *  numeric chain id (EVM chains + the sepolia testnet); non-EVM chains (solana, tron,
 *  starknet) have no numeric id and are looked up by name directly. */
export const CHAIN_ID_TO_KEY: Record<string, string> = {
  '1': 'ethereum',
  '10': 'optimism',
  '14': 'flare',
  '30': 'rootstock',
  '56': 'bsc',
  '100': 'gnosis',
  '130': 'unichain',
  '137': 'polygon',
  '146': 'sonic',
  '204': 'opbnb',
  '250': 'fantom',
  '252': 'fraxtal',
  '324': 'zksync',
  '480': 'worldchain',
  '747': 'flow',
  '999': 'hyperevm',
  '1135': 'lisk',
  '1329': 'sei',
  '1868': 'soneium',
  '1923': 'swellchain',
  '2345': 'goat',
  '2741': 'abstract',
  '4114': 'citrea',
  '4217': 'tempo',
  '4663': 'robinhood',
  '5000': 'mantle',
  '8217': 'kaia',
  '8453': 'base',
  '9745': 'plasma',
  '11155111': 'sepolia',
  '33139': 'apechain',
  '34443': 'mode',
  '42161': 'arbitrum',
  '43111': 'hemi',
  '43114': 'avalanche',
  '57073': 'ink',
  '59144': 'linea',
  '60808': 'bob',
  '80094': 'berachain',
  '81457': 'blast',
  '84532': 'base-sepolia',
  '167000': 'taiko',
  '534352': 'scroll',
  '1313161554': 'aurora',
}

/** Resolve a CHAIN_DISPLAY key from a numeric EVM chain id (string or number). Returns
 *  `undefined` for unknown or non-EVM ids — do NOT default to 'ethereum'. */
export function getChainKeyByChainId(chainId: string | number): string | undefined {
  return CHAIN_ID_TO_KEY[String(chainId)]
}

/** Build an explorer transaction link from a numeric EVM chain id, or `null` if the
 *  chain id is unrecognized or its explorer is unknown. */
export function getExplorerTxUrlByChainId(chainId: string | number, txHash: string): string | null {
  const key = getChainKeyByChainId(chainId)
  return key ? getExplorerTxUrl(key, txHash) : null
}
