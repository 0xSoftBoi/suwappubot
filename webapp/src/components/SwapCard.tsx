import type { Swap } from '../types/api'

interface SwapCardProps {
  swap: Swap
}

const statusConfig: Record<string, { color: string; label: string }> = {
  pending: { color: 'bg-yellow-500', label: 'Pending' },
  completed: { color: 'bg-green-500', label: 'Completed' },
  failed: { color: 'bg-red-500', label: 'Failed' },
  cancelled: { color: 'bg-gray-500', label: 'Cancelled' },
}

const chainConfig: Record<string, string> = {
  ethereum: 'ETH',
  polygon: 'MATIC',
  arbitrum: 'ARB',
  optimism: 'OP',
  base: 'BASE',
  bsc: 'BSC',
  avalanche: 'AVAX',
  solana: 'SOL',
}

export function SwapCard({ swap }: SwapCardProps) {
  const status = statusConfig[swap.status] || { color: 'bg-gray-500', label: swap.status }
  const fromChain = chainConfig[swap.fromChain.toLowerCase()] || swap.fromChain
  const toChain = chainConfig[swap.toChain.toLowerCase()] || swap.toChain

  const explorerUrl = swap.txHash ? getExplorerUrl(swap.fromChain, swap.txHash) : null

  return (
    <div className="bg-tg-secondary rounded-xl p-4">
      <div className="flex justify-between items-start mb-3">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${status.color}`} />
          <span className="text-sm text-tg-hint">{status.label}</span>
        </div>
        <span className="text-xs text-tg-hint">
          {new Date(swap.createdAt).toLocaleDateString()}
        </span>
      </div>

      {/* Swap Details */}
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <p className="text-tg-text font-medium">
            {parseFloat(swap.fromAmount).toLocaleString(undefined, { maximumFractionDigits: 6 })} {swap.fromToken}
          </p>
          <p className="text-xs text-tg-hint">{fromChain}</p>
        </div>

        <svg className="w-5 h-5 text-tg-hint" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
        </svg>

        <div className="flex-1 text-right">
          <p className="text-tg-text font-medium">
            {swap.toAmount ? parseFloat(swap.toAmount).toLocaleString(undefined, { maximumFractionDigits: 6 }) : '...'} {swap.toToken}
          </p>
          <p className="text-xs text-tg-hint">{toChain}</p>
        </div>
      </div>

      {/* Explorer Link */}
      {explorerUrl && (
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 text-xs text-tg-link flex items-center gap-1"
        >
          View on Explorer
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
      )}
    </div>
  )
}

function getExplorerUrl(chain: string, txHash: string): string {
  const explorers: Record<string, string> = {
    ethereum: 'https://etherscan.io/tx/',
    polygon: 'https://polygonscan.com/tx/',
    arbitrum: 'https://arbiscan.io/tx/',
    optimism: 'https://optimistic.etherscan.io/tx/',
    base: 'https://basescan.org/tx/',
    bsc: 'https://bscscan.com/tx/',
    avalanche: 'https://snowtrace.io/tx/',
    solana: 'https://solscan.io/tx/',
  }

  const baseUrl = explorers[chain.toLowerCase()] || 'https://etherscan.io/tx/'
  return `${baseUrl}${txHash}`
}
