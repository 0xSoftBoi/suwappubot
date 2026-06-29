export interface Chain {
  id: string
  name: string
  icon: string
}

export interface ChainSelectorProps {
  chains: Chain[]
  selected: string
  onSelect?: (chainId: string) => void
}

const defaultChains: Chain[] = [
  { id: 'eth', name: 'Ethereum', icon: 'Ξ' },
  { id: 'base', name: 'Base', icon: '🔵' },
  { id: 'bsc', name: 'BSC', icon: '🔶' },
  { id: 'polygon', name: 'Polygon', icon: '⬡' },
  { id: 'arb', name: 'Arbitrum', icon: '🔷' },
  { id: 'sol', name: 'Solana', icon: '◎' },
  { id: 'tempo', name: 'Tempo', icon: '⏱️' },
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
