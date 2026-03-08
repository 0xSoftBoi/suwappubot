import React, { useState, useCallback } from 'react'

export interface SwapSettings {
  slippage: number
  slippageMode: 'auto' | 'custom'
  mevProtection: boolean
  gasPriority: 'slow' | 'normal' | 'fast'
  deadline: number
}

export interface SlippageControlProps {
  settings: SwapSettings
  onChange: (settings: SwapSettings) => void
  chainType?: 'evm' | 'solana' | 'sui'
  className?: string
  defaultExpanded?: boolean
}

const SLIPPAGE_PRESETS = [0.1, 0.5, 1.0]
const DEADLINE_PRESETS = [10, 20, 30]

const GAS_OPTIONS = [
  { value: 'slow' as const, label: 'Slow', time: '~30s', cost: '$0.50' },
  { value: 'normal' as const, label: 'Normal', time: '~15s', cost: '$1.20' },
  { value: 'fast' as const, label: 'Fast', time: '~5s', cost: '$3.40' },
]

function Toggle({
  enabled,
  onToggle,
}: {
  enabled: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`relative w-11 h-6 rounded-suwappu-pill transition-colors ${
        enabled ? 'bg-suwappu-magenta' : 'bg-suwappu-text-secondary/30'
      }`}
      role="switch"
      aria-checked={enabled}
    >
      <div
        className={`absolute top-1 w-4 h-4 rounded-suwappu-pill bg-white shadow transition-transform ${
          enabled ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  )
}

function SlippageWarning({ slippage }: { slippage: number }) {
  if (slippage < 0.1) {
    return (
      <div className="mt-2 px-3 py-2 rounded-suwappu-lg bg-yellow-50 border border-yellow-200 text-xs text-yellow-700">
        Transaction may fail due to low slippage
      </div>
    )
  }
  if (slippage > 10) {
    return (
      <div className="mt-2 px-3 py-2 rounded-suwappu-lg bg-red-50 border border-red-200 text-xs text-impact-severe flex items-center gap-1.5">
        <svg
          className="w-3.5 h-3.5 shrink-0"
          viewBox="0 0 16 16"
          fill="currentColor"
        >
          <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 2a1 1 0 011 1v4a1 1 0 01-2 0V4a1 1 0 011-1zm0 8a1 1 0 100-2 1 1 0 000 2z" />
        </svg>
        Extremely high slippage
      </div>
    )
  }
  if (slippage > 3) {
    return (
      <div className="mt-2 px-3 py-2 rounded-suwappu-lg bg-orange-50 border border-orange-200 text-xs text-impact-high">
        High slippage — you may receive significantly less
      </div>
    )
  }
  return null
}

export const SlippageControl = React.memo(function SlippageControl({
  settings,
  onChange,
  chainType = 'evm',
  className = '',
  defaultExpanded = false,
}: SlippageControlProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  const updateSettings = useCallback(
    (patch: Partial<SwapSettings>) => {
      onChange({ ...settings, ...patch })
    },
    [settings, onChange],
  )

  const handleSlippagePreset = useCallback(
    (value: number) => {
      updateSettings({ slippage: value, slippageMode: 'custom' })
    },
    [updateSettings],
  )

  const handleCustomSlippage = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = parseFloat(e.target.value)
      if (!isNaN(value) && value >= 0) {
        updateSettings({ slippage: value, slippageMode: 'custom' })
      }
    },
    [updateSettings],
  )

  const handleAutoToggle = useCallback(() => {
    updateSettings({
      slippageMode: settings.slippageMode === 'auto' ? 'custom' : 'auto',
      slippage: settings.slippageMode === 'auto' ? 0.5 : settings.slippage,
    })
  }, [updateSettings, settings.slippageMode, settings.slippage])

  const handleMevToggle = useCallback(() => {
    updateSettings({ mevProtection: !settings.mevProtection })
  }, [updateSettings, settings.mevProtection])

  const handleGasPriority = useCallback(
    (value: SwapSettings['gasPriority']) => {
      updateSettings({ gasPriority: value })
    },
    [updateSettings],
  )

  const handleDeadline = useCallback(
    (value: number) => {
      updateSettings({ deadline: value })
    },
    [updateSettings],
  )

  const isPresetSelected = SLIPPAGE_PRESETS.includes(settings.slippage) && settings.slippageMode === 'custom'
  const showEvmOptions = chainType === 'evm'

  // Collapsed summary
  const summaryParts: string[] = []
  if (settings.slippageMode === 'auto') {
    summaryParts.push('Auto')
  } else {
    summaryParts.push(`${settings.slippage}%`)
  }
  if (showEvmOptions && settings.mevProtection) {
    summaryParts.push('MEV Protected')
  }
  if (showEvmOptions) {
    const gasLabel = GAS_OPTIONS.find((g) => g.value === settings.gasPriority)?.label ?? 'Normal'
    summaryParts.push(gasLabel)
  }

  return (
    <div className={`bg-white rounded-suwappu-xl shadow-suwappu-2 ${className}`}>
      {/* Collapsed header */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm text-suwappu-text-secondary"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-2">
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
          <span className="font-body">
            {summaryParts.join(' | ')}
            {showEvmOptions && settings.mevProtection && (
              <span className="ml-1" aria-label="Shield">
                &#x1F6E1;&#xFE0F;
              </span>
            )}
          </span>
        </div>
        <svg
          className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {/* Expanded panel */}
      {expanded && (
        <div className="px-4 pb-4 animate-slide-up space-y-5">
          {/* Section 1: Slippage Tolerance */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="font-heading font-semibold text-sm text-suwappu-text">
                Slippage Tolerance
              </span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-suwappu-text-secondary">Auto</span>
                <Toggle
                  enabled={settings.slippageMode === 'auto'}
                  onToggle={handleAutoToggle}
                />
              </div>
            </div>

            <div className={`flex items-center gap-2 ${settings.slippageMode === 'auto' ? 'opacity-40 pointer-events-none' : ''}`}>
              {SLIPPAGE_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => handleSlippagePreset(preset)}
                  className={`px-3 py-1.5 rounded-suwappu-pill text-sm font-medium transition-colors ${
                    settings.slippage === preset && settings.slippageMode === 'custom'
                      ? 'bg-suwappu-magenta text-white'
                      : 'bg-suwappu-sakura-light text-suwappu-text hover:bg-suwappu-sakura-light/80'
                  }`}
                >
                  {preset}%
                </button>
              ))}
              <div className="relative flex items-center">
                <input
                  type="number"
                  min="0"
                  max="50"
                  step="0.1"
                  value={!isPresetSelected && settings.slippageMode === 'custom' ? settings.slippage : ''}
                  placeholder="Custom"
                  onChange={handleCustomSlippage}
                  className={`w-20 px-2 py-1.5 rounded-suwappu-pill text-sm text-center border transition-colors outline-none ${
                    !isPresetSelected && settings.slippageMode === 'custom'
                      ? 'border-suwappu-magenta bg-suwappu-magenta/5 text-suwappu-text'
                      : 'border-suwappu-text-secondary/20 bg-suwappu-sakura-light text-suwappu-text'
                  }`}
                />
                <span className="absolute right-2.5 text-xs text-suwappu-text-secondary pointer-events-none">
                  %
                </span>
              </div>
            </div>

            {settings.slippageMode === 'auto' && (
              <div className="mt-2 text-xs text-suwappu-magenta font-medium">
                Auto — slippage adjusted dynamically
              </div>
            )}

            {settings.slippageMode === 'custom' && (
              <SlippageWarning slippage={settings.slippage} />
            )}
          </div>

          {/* Section 2: MEV Protection (EVM only) */}
          {showEvmOptions && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="font-heading font-semibold text-sm text-suwappu-text">
                  MEV Protection
                </span>
                <Toggle
                  enabled={settings.mevProtection}
                  onToggle={handleMevToggle}
                />
              </div>
              <p className="text-xs text-suwappu-text-secondary">
                Protects against front-running via CoW Protocol
              </p>
              {!settings.mevProtection && (
                <p className="mt-1 text-xs text-yellow-600">
                  Your transaction may be front-run
                </p>
              )}
            </div>
          )}

          {/* Section 3: Gas Priority (EVM only) */}
          {showEvmOptions && (
            <div>
              <span className="font-heading font-semibold text-sm text-suwappu-text block mb-2">
                Gas Priority
              </span>
              <div className="flex gap-2">
                {GAS_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => handleGasPriority(option.value)}
                    className={`flex-1 flex flex-col items-center gap-0.5 px-3 py-2 rounded-suwappu-xl text-sm transition-all ${
                      settings.gasPriority === option.value
                        ? 'ring-2 ring-suwappu-magenta bg-suwappu-magenta/5 text-suwappu-text'
                        : 'bg-suwappu-sakura-light text-suwappu-text hover:bg-suwappu-sakura-light/80'
                    }`}
                  >
                    <span className="font-medium">
                      {option.label} {option.time}
                    </span>
                    <span className="text-xs text-suwappu-text-secondary">
                      {option.cost}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Section 4: Transaction Deadline */}
          <div>
            <span className="font-heading font-semibold text-sm text-suwappu-text block mb-2">
              Expires in
            </span>
            <div className="flex gap-2">
              {DEADLINE_PRESETS.map((minutes) => (
                <button
                  key={minutes}
                  type="button"
                  onClick={() => handleDeadline(minutes)}
                  className={`px-3 py-1.5 rounded-suwappu-pill text-sm font-medium transition-colors ${
                    settings.deadline === minutes
                      ? 'bg-suwappu-magenta text-white'
                      : 'bg-suwappu-sakura-light text-suwappu-text hover:bg-suwappu-sakura-light/80'
                  }`}
                >
                  {minutes}m
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
})
