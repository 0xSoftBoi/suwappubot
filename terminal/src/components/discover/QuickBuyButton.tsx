import { useState, useRef, useEffect } from 'react'

const PRESET_AMOUNTS = [0.01, 0.05, 0.1, 0.5]

interface QuickBuyButtonProps {
  tokenSymbol: string
  tokenAddress: string
  onBuy?: (amount: number, tokenAddress: string) => void
  glowOnHover?: boolean
}

export function QuickBuyButton({ tokenSymbol, tokenAddress, onBuy, glowOnHover }: QuickBuyButtonProps) {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`px-2 py-0.5 text-[10px] font-semibold rounded bg-sakura-600/20 text-sakura-400 border border-sakura-600/30 hover:bg-sakura-600/30 transition-all ${glowOnHover ? 'hover:shadow-[0_0_8px_rgba(236,72,153,0.4)]' : ''}`}
      >
        Buy
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-terminal-bg-secondary border border-terminal-border rounded shadow-lg min-w-[140px]">
          <div className="px-2 py-1.5 text-[10px] text-terminal-text-muted border-b border-terminal-border">
            Buy {tokenSymbol}
          </div>
          {PRESET_AMOUNTS.map(amount => (
            <button
              key={amount}
              onClick={() => {
                onBuy?.(amount, tokenAddress)
                setIsOpen(false)
              }}
              className="w-full text-left px-2 py-1.5 text-xs text-terminal-text hover:bg-terminal-bg-tertiary transition-colors"
            >
              {amount} ETH
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
