import { useState, useRef, useEffect } from 'react'

const CHAINS = [
  { id: 'ethereum', name: 'Ethereum', icon: '⟠', color: '#627EEA' },
  { id: 'arbitrum', name: 'Arbitrum', icon: '◆', color: '#28A0F0' },
  { id: 'base', name: 'Base', icon: '●', color: '#0052FF' },
  { id: 'optimism', name: 'Optimism', icon: '⊕', color: '#FF0420' },
  { id: 'polygon', name: 'Polygon', icon: '⬡', color: '#8247E5' },
  { id: 'bsc', name: 'BSC', icon: '◉', color: '#F0B90B' },
  { id: 'avalanche', name: 'Avalanche', icon: '▲', color: '#E84142' },
  { id: 'solana', name: 'Solana', icon: '◎', color: '#9945FF' },
]

interface Props {
  selected: string
  onSelect: (chain: string) => void
}

export function ChainSelector({ selected, onSelect }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', handler)
    return () => document.removeEventListener('pointerdown', handler)
  }, [])

  const current = CHAINS.find(c => c.id === selected) || CHAINS[0]

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex min-h-11 items-center gap-1.5 px-2 py-1 rounded text-sm font-medium
                   hover:bg-terminal-bg-tertiary transition-colors"
      >
        <span style={{ color: current.color }}>{current.icon}</span>
        <span>{current.name}</span>
        <svg className="w-3 h-3 text-terminal-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="terminal-theme-overlay absolute left-0 top-full z-50 mt-1 w-48 overflow-hidden">
          {CHAINS.map(chain => (
            <button
              key={chain.id}
              onClick={() => { onSelect(chain.id); setOpen(false) }}
              className={`flex min-h-11 w-full items-center gap-2 px-3 py-2 text-sm hover:bg-terminal-bg-tertiary transition-colors
                ${chain.id === selected ? 'text-sakura-400' : 'text-terminal-text'}`}
            >
              <span style={{ color: chain.color }}>{chain.icon}</span>
              <span>{chain.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
