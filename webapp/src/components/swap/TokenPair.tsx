import React from 'react'
import { ChainBadge } from './ChainBadge'

export interface TokenPairToken {
  symbol: string
  logoUrl?: string
  name?: string
}

export interface TokenPairProps {
  fromToken: TokenPairToken
  toToken: TokenPairToken
  fromChain?: string
  toChain?: string
  size?: 'sm' | 'md' | 'lg'
  showArrow?: boolean
  showNames?: boolean
  className?: string
}

const SIZE_CONFIG = {
  sm: { icon: 'w-5 h-5', text: 'text-[8px]', nameText: 'text-[10px]', arrowText: 'text-xs' },
  md: { icon: 'w-7 h-7', text: 'text-[10px]', nameText: 'text-xs', arrowText: 'text-sm' },
  lg: { icon: 'w-9 h-9', text: 'text-xs', nameText: 'text-sm', arrowText: 'text-base' },
} as const

const CHAIN_BADGE_SIZE_MAP = {
  sm: 'sm',
  md: 'sm',
  lg: 'md',
} as const

function TokenIcon({
  token,
  chainId,
  size,
}: {
  token: TokenPairToken
  chainId?: string
  size: 'sm' | 'md' | 'lg'
}) {
  const { icon, text } = SIZE_CONFIG[size]
  const badgeSize = CHAIN_BADGE_SIZE_MAP[size]
  const fallbackLabel = token.symbol.slice(0, 2).toUpperCase()

  return (
    <span className="relative inline-block shrink-0">
      {token.logoUrl ? (
        <img
          src={token.logoUrl}
          alt={token.symbol}
          className={`${icon} rounded-suwappu-pill object-cover`}
        />
      ) : (
        <span
          className={`${icon} ${text} rounded-suwappu-pill bg-suwappu-gradient text-white inline-flex items-center justify-center font-bold leading-none`}
        >
          {fallbackLabel}
        </span>
      )}
      {chainId && (
        <span className="absolute -bottom-1 -right-1">
          <ChainBadge chainId={chainId} size={badgeSize} />
        </span>
      )}
    </span>
  )
}

export const TokenPair = React.memo(function TokenPair({
  fromToken,
  toToken,
  fromChain,
  toChain,
  size = 'md',
  showArrow = true,
  showNames = false,
  className = '',
}: TokenPairProps) {
  const { arrowText, nameText } = SIZE_CONFIG[size]
  const isCrossChain = fromChain && toChain && fromChain !== toChain

  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      {/* From token */}
      <span className="inline-flex flex-col items-center gap-0.5">
        <TokenIcon token={fromToken} chainId={fromChain} size={size} />
        {showNames && (
          <>
            <span className={`${nameText} font-medium text-suwappu-text leading-tight`}>
              {fromToken.symbol}
            </span>
            {fromToken.name && (
              <span className="text-[10px] text-suwappu-text-secondary leading-tight">
                {fromToken.name}
              </span>
            )}
          </>
        )}
      </span>

      {/* Arrow */}
      {showArrow && (
        <span
          className={`${arrowText} text-suwappu-text-secondary select-none ${showNames ? 'self-start mt-1' : ''}`}
        >
          {isCrossChain ? '\u27F7' : '\u2192'}
        </span>
      )}

      {/* To token */}
      <span className="inline-flex flex-col items-center gap-0.5">
        <TokenIcon token={toToken} chainId={toChain} size={size} />
        {showNames && (
          <>
            <span className={`${nameText} font-medium text-suwappu-text leading-tight`}>
              {toToken.symbol}
            </span>
            {toToken.name && (
              <span className="text-[10px] text-suwappu-text-secondary leading-tight">
                {toToken.name}
              </span>
            )}
          </>
        )}
      </span>
    </span>
  )
})
