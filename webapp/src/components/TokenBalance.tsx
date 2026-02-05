import type { Token } from '@suwappu/shared'

interface TokenBalanceProps {
  token: Token
}

// Chain icons/colors
const chainConfig: Record<string, { color: string; name: string }> = {
  ethereum: { color: '#627EEA', name: 'ETH' },
  polygon: { color: '#8247E5', name: 'MATIC' },
  arbitrum: { color: '#28A0F0', name: 'ARB' },
  optimism: { color: '#FF0420', name: 'OP' },
  base: { color: '#0052FF', name: 'BASE' },
  bsc: { color: '#F3BA2F', name: 'BSC' },
  avalanche: { color: '#E84142', name: 'AVAX' },
  solana: { color: '#9945FF', name: 'SOL' },
}

export function TokenBalance({ token }: TokenBalanceProps) {
  const chain = chainConfig[token.chain.toLowerCase()] || { color: '#888', name: token.chain }

  return (
    <div className="flex items-center gap-3 p-3 bg-tg-secondary rounded-xl">
      {/* Token Icon */}
      <div className="relative">
        {token.logoUrl ? (
          <img
            src={token.logoUrl}
            alt={token.symbol}
            className="w-10 h-10 rounded-full"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none'
            }}
          />
        ) : (
          <div className="w-10 h-10 rounded-full bg-tg-hint/20 flex items-center justify-center">
            <span className="text-sm font-bold text-tg-text">
              {token.symbol.slice(0, 2)}
            </span>
          </div>
        )}
        {/* Chain badge */}
        <div
          className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-tg-secondary"
          style={{ backgroundColor: chain.color }}
          title={chain.name}
        />
      </div>

      {/* Token Info */}
      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-center">
          <span className="font-medium text-tg-text truncate">{token.symbol}</span>
          <span className="text-tg-text font-medium">
            {parseFloat(token.balance).toLocaleString(undefined, { maximumFractionDigits: 6 })}
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-sm text-tg-hint truncate">{token.name}</span>
          <span className="text-sm text-tg-hint">
            ${token.usdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
      </div>
    </div>
  )
}
