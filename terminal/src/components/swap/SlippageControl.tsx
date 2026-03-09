import { useState } from 'react'

interface Props {
  value: number
  onChange: (value: number) => void
}

const PRESETS = [0.1, 0.5, 1.0, 3.0]

export function SlippageControl({ value, onChange }: Props) {
  const [custom, setCustom] = useState(false)

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-terminal-text-secondary shrink-0">Slippage</span>
      <div className="flex gap-1 flex-1">
        {PRESETS.map(preset => (
          <button
            key={preset}
            onClick={() => { onChange(preset); setCustom(false) }}
            className={`flex-1 py-1 rounded text-xs font-mono transition-colors
              ${!custom && value === preset
                ? 'bg-sakura-600/20 text-sakura-400 border border-sakura-600'
                : 'bg-terminal-bg border border-terminal-border text-terminal-text-secondary hover:text-terminal-text'
              }`}
          >
            {preset}%
          </button>
        ))}
        <div className="relative flex-1">
          <input
            type="text"
            value={custom ? value : ''}
            onChange={e => {
              const val = parseFloat(e.target.value)
              if (!isNaN(val) && val >= 0 && val <= 50) {
                onChange(val)
                setCustom(true)
              }
            }}
            onFocus={() => setCustom(true)}
            placeholder="Custom"
            className={`w-full py-1 rounded text-xs font-mono text-center
              bg-terminal-bg border transition-colors outline-none
              ${custom
                ? 'border-sakura-600 text-sakura-400'
                : 'border-terminal-border text-terminal-text-secondary'
              }`}
          />
        </div>
      </div>
    </div>
  )
}
