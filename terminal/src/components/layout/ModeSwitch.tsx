import { useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTrading, type TradingMode } from '../../contexts/TradingContext'

const MODES: { id: TradingMode; label: string; hint: string }[] = [
  { id: 'spot', label: 'Spot', hint: 'Cross-chain swaps' },
  { id: 'bridge', label: 'Bridge', hint: 'Move funds between chains' },
  { id: 'perps', label: 'Perps', hint: 'HyperLiquid perpetuals' },
  { id: 'predict', label: 'Predict', hint: 'Polymarket prediction markets' },
]

// Top-level workspace switcher. Lives in the Header and flips the entire
// TradingLayout between the spot swap desk, the HyperLiquid perps desk, and the
// Polymarket prediction desk. A segmented control keeps it dense + glanceable.
export function ModeSwitch({ className = '' }: { className?: string }) {
  const { tradingMode, setTradingMode } = useTrading()
  const tabsRef = useRef<(HTMLButtonElement | null)[]>([])
  const location = useLocation()
  const navigate = useNavigate()

  // The bridge is also mounted on its own deep-link routes (/bridge,
  // /terminal/bridge), outside TradingLayout. On those URLs the persisted
  // tradingMode still says whatever it last was — usually "spot" — so without
  // this the switcher highlights the wrong tab AND its clicks do nothing (the
  // URL keeps rendering BridgeRoute regardless of mode). Derive the active tab
  // from the URL, and leave the standalone route when another tab is chosen.
  const onStandaloneBridge = /(^|\/)bridge\/?$/.test(location.pathname)
  const activeMode: TradingMode = onStandaloneBridge ? 'bridge' : tradingMode

  const selectMode = (mode: TradingMode) => {
    setTradingMode(mode)
    if (onStandaloneBridge && mode !== 'bridge') navigate('/')
  }

  // A tablist has to answer the arrow keys, or the ARIA role is a lie to screen
  // readers. Roving tabindex: one stop in the tab order, arrows move within.
  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    const delta =
      event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    let next = index
    if (delta !== 0) next = (index + delta + MODES.length) % MODES.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = MODES.length - 1
    else return

    event.preventDefault()
    selectMode(MODES[next].id)
    tabsRef.current[next]?.focus()
  }

  return (
    <div
      role="tablist"
      aria-label="Trading mode"
      className={`terminal-theme-inset flex items-center gap-0.5 rounded-[8px] p-0.5 ${className}`}
    >
      {MODES.map((mode, index) => {
        const active = activeMode === mode.id
        return (
          <button
            key={mode.id}
            ref={(el) => {
              tabsRef.current[index] = el
            }}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onKeyDown={(event) => onKeyDown(event, index)}
            onClick={() => selectMode(mode.id)}
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
