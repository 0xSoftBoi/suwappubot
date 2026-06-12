import React from 'react'

export type SwapProvider =
  | 'cow'
  | 'jupiter'
  | 'socket'
  | 'cctp'
  | 'across'
  | 'wormhole'
  | 'lifi'
  | 'layerzero'
  | 'ccip'

interface ProviderInfo {
  name: string
  abbr: string
  description: string
  colorClass: string
}

const PROVIDER_MAP: Record<SwapProvider, ProviderInfo> = {
  cow: {
    name: 'CoW Protocol',
    abbr: 'CoW',
    description: 'MEV-protected, batch auctions',
    colorClass: 'bg-provider-cow',
  },
  jupiter: {
    name: 'Jupiter',
    abbr: 'JUP',
    description: 'Solana DEX aggregator',
    colorClass: 'bg-provider-jupiter',
  },
  socket: {
    name: 'Socket',
    abbr: 'SOC',
    description: 'Cross-chain aggregator',
    colorClass: 'bg-provider-socket',
  },
  cctp: {
    name: 'Circle CCTP',
    abbr: 'CC',
    description: 'Native USDC bridging',
    colorClass: 'bg-provider-cctp',
  },
  across: {
    name: 'Across',
    abbr: 'ACR',
    description: 'Fast EVM bridging',
    colorClass: 'bg-provider-across',
  },
  wormhole: {
    name: 'Wormhole',
    abbr: 'WH',
    description: 'Cross-chain messaging',
    colorClass: 'bg-provider-wormhole',
  },
  lifi: {
    name: 'Li.Fi',
    abbr: 'LF',
    description: 'Multi-bridge aggregator',
    colorClass: 'bg-provider-lifi',
  },
  layerzero: {
    name: 'LayerZero',
    abbr: 'LZ',
    description: 'Omnichain protocol',
    colorClass: 'bg-provider-layerzero',
  },
  ccip: {
    name: 'Chainlink CCIP',
    abbr: 'CL',
    description: 'Cross-chain interop',
    colorClass: 'bg-provider-ccip',
  },
}

const SIZE_CONFIG = {
  sm: { box: 'w-5 h-5', text: 'text-[8px]', nameText: 'text-xs' },
  md: { box: 'w-7 h-7', text: 'text-[10px]', nameText: 'text-sm' },
  lg: { box: 'w-9 h-9', text: 'text-xs', nameText: 'text-base' },
} as const

export interface ProviderLogoProps {
  provider: SwapProvider | (string & {})
  size?: 'sm' | 'md' | 'lg'
  showName?: boolean
  className?: string
}

function FallbackIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7 16l-4-4 4-4" />
      <path d="M17 8l4 4-4 4" />
    </svg>
  )
}

export const ProviderLogo = React.memo(function ProviderLogo({
  provider,
  size = 'md',
  showName = false,
  className = '',
}: ProviderLogoProps) {
  const info = PROVIDER_MAP[provider as SwapProvider]
  const sizeConfig = SIZE_CONFIG[size]

  const isKnown = !!info

  // Determine if text should be dark (for light backgrounds)
  const needsDarkText = provider === 'jupiter' || provider === 'across'

  const logo = (
    <div
      className={`
        ${sizeConfig.box}
        ${isKnown ? info.colorClass : 'bg-gray-400'}
        rounded-suwappu-sm
        flex items-center justify-center
        flex-shrink-0
      `.trim()}
    >
      {isKnown ? (
        <span
          className={`
            ${sizeConfig.text}
            ${needsDarkText ? 'text-suwappu-text' : 'text-white'}
            font-bold leading-none select-none
          `.trim()}
        >
          {info.abbr}
        </span>
      ) : (
        <FallbackIcon
          className={`${size === 'sm' ? 'w-3 h-3' : size === 'md' ? 'w-4 h-4' : 'w-5 h-5'} text-white`}
        />
      )}
    </div>
  )

  if (!showName) {
    return <div className={className}>{logo}</div>
  }

  return (
    <div className={`flex items-center gap-2 ${className}`.trim()}>
      {logo}
      <span className={`${sizeConfig.nameText} font-medium text-suwappu-text`}>
        {isKnown ? info.name : provider}
      </span>
    </div>
  )
})

/** Utility to get provider metadata for external use */
export function getProviderInfo(provider: SwapProvider): ProviderInfo | undefined {
  return PROVIDER_MAP[provider]
}
