import { useTrading, type TradingMode } from '../../contexts/TradingContext'

const MODES: { id: TradingMode; label: string; hint: string }[] = [
  { id: 'spot', label: 'Spot', hint: 'Cross-chain swaps' },
  { id: 'perps', label: 'Perps', hint: 'HyperLiquid perpetuals' },
  { id: 'predict', label: 'Predict', hint: 'Polymarket prediction markets' },
]

// Top-level workspace switcher. Lives in the Header and flips the entire
// TradingLayout between the spot swap desk, the HyperLiquid perps desk, and the
// Polymarket prediction desk. A segmented control keeps it dense + glanceable.
export function ModeSwitch({ className = '' }: { className?: string }) {
  const { tradingMode, setTradingMode } = useTrading()

  return (
    <div
      role="tablist"
      aria-label="Trading mode"
      className={`terminal-theme-inset flex items-center gap-0.5 rounded-[8px] p-0.5 ${className}`}
    >
      {MODES.map((mode) => {
        const active = tradingMode === mode.id
        return (
          <button
            key={mode.id}
            role="tab"
            aria-selected={active}
            onClick={() => setTradingMode(mode.id)}
            title={mode.hint}
            className={`terminal-theme-control rounded-[6px] px-3 py-1 text-xs transition-colors
              ${
                active
                  ? 'terminal-theme-control-active accent-wash font-semibold text-terminal-text'
                  : 'font-medium text-terminal-text-secondary hover:text-terminal-text'
              }`}
          >
            {mode.label}
          </button>
        )
      })}
    </div>
  )
}
