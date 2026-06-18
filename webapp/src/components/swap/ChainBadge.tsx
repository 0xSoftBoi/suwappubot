import React from 'react'

export interface ChainBadgeProps {
  chainId: string
  size?: 'sm' | 'md' | 'lg'
  showLabel?: boolean
  className?: string
}

interface ChainInfo {
  name: string
  abbreviation: string
  colorClass: string
}

const CHAIN_MAP: Record<string, ChainInfo> = {
  ethereum: { name: 'Ethereum', abbreviation: 'ET', colorClass: 'bg-chain-ethereum' },
  bsc: { name: 'BNB Chain', abbreviation: 'BN', colorClass: 'bg-chain-bsc' },
  polygon: { name: 'Polygon', abbreviation: 'MA', colorClass: 'bg-chain-polygon' },
  arbitrum: { name: 'Arbitrum', abbreviation: 'AR', colorClass: 'bg-chain-arbitrum' },
  optimism: { name: 'Optimism', abbreviation: 'OP', colorClass: 'bg-chain-optimism' },
  base: { name: 'Base', abbreviation: 'BA', colorClass: 'bg-chain-base' },
  avalanche: { name: 'Avalanche', abbreviation: 'AV', colorClass: 'bg-chain-avalanche' },
  fantom: { name: 'Fantom', abbreviation: 'FT', colorClass: 'bg-chain-fantom' },
  linea: { name: 'Linea', abbreviation: 'ET', colorClass: 'bg-chain-linea' },
  mantle: { name: 'Mantle', abbreviation: 'MN', colorClass: 'bg-chain-mantle' },
  gnosis: { name: 'Gnosis', abbreviation: 'xD', colorClass: 'bg-chain-gnosis' },
  scroll: { name: 'Scroll', abbreviation: 'ET', colorClass: 'bg-chain-scroll' },
  solana: { name: 'Solana', abbreviation: 'SO', colorClass: 'bg-chain-solana' },
  sui: { name: 'Sui', abbreviation: 'SU', colorClass: 'bg-chain-sui' },
  ton: { name: 'TON', abbreviation: 'TO', colorClass: 'bg-chain-ton' },
  tempo: { name: 'Tempo', abbreviation: 'TE', colorClass: 'bg-chain-tempo' },
}

const SIZE_CONFIG = {
  sm: { dimension: 'w-[14px] h-[14px]', text: 'text-[8px]' },
  md: { dimension: 'w-[18px] h-[18px]', text: 'text-[10px]' },
  lg: { dimension: 'w-[22px] h-[22px]', text: 'text-xs' },
} as const

export const ChainBadge = React.memo(function ChainBadge({
  chainId,
  size = 'md',
  showLabel = false,
  className = '',
}: ChainBadgeProps) {
  const chain = CHAIN_MAP[chainId]
  if (!chain) return null

  const { dimension, text } = SIZE_CONFIG[size]

  // For scroll chain, the bg is light so use dark text
  const textColor = chainId === 'scroll' ? 'text-amber-900' : 'text-white'

  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <span
        className={`${dimension} ${chain.colorClass} ${textColor} ${text} rounded-suwappu-pill ring-1 ring-white inline-flex items-center justify-center font-bold leading-none shrink-0`}
      >
        {chain.abbreviation}
      </span>
      {showLabel && (
        <span className="text-xs text-suwappu-text-secondary">{chain.name}</span>
      )}
    </span>
  )
})
