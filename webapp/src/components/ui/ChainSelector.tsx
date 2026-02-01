export interface Chain {
  id: string
  name: string
  icon: string
}

export interface ChainSelectorProps {
  chains?: Chain[]
  selected: string
  onSelect?: (chainId: string) => void
}

// Default chains matching SUPPORTED_CHAINS in useTokens
export const defaultChains: Chain[] = [
  { id: '1', name: 'Ethereum', icon: 'Ξ' },
  { id: '137', name: 'Polygon', icon: '⬡' },
  { id: '42161', name: 'Arbitrum', icon: '🔵' },
  { id: '10', name: 'Optimism', icon: '🔴' },
  { id: '8453', name: 'Base', icon: '🔷' },
]

export function ChainSelector({ chains = defaultChains, selected, onSelect }: ChainSelectorProps) {
  return (
    <div className="w-full">
      <div className="flex gap-1.5 flex-wrap">
        {chains.map((chain) => (
          <button
            key={chain.id}
            onClick={() => onSelect?.(chain.id)}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-heading font-medium transition-colors ${
              selected === chain.id
                ? 'bg-suwappu-gradient text-white'
                : 'bg-white text-suwappu-text-secondary border border-suwappu-sakura-mid/30'
            }`}
          >
            <span className="text-sm">{chain.icon}</span>
            <span>{chain.name}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
