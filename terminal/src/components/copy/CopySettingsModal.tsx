import { useState, useEffect } from 'react'
import type { FollowSettings, CopyMode } from '../../types/api'

const CHAINS = [
  { id: 'ethereum', label: 'ETH' },
  { id: 'arbitrum', label: 'ARB' },
  { id: 'base', label: 'BASE' },
  { id: 'solana', label: 'SOL' },
]

interface CopySettingsModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (settings: FollowSettings) => void
  initialSettings?: FollowSettings
  traderName?: string
}

export function CopySettingsModal({ isOpen, onClose, onSave, initialSettings, traderName }: CopySettingsModalProps) {
  const [copyMode, setCopyMode] = useState<CopyMode>(initialSettings?.copyMode || 'notify')
  const [fixedAmount, setFixedAmount] = useState(initialSettings?.fixedAmount?.toString() || '100')
  const [percentageAmount, setPercentageAmount] = useState(initialSettings?.percentageAmount?.toString() || '10')
  const [maxPerTrade, setMaxPerTrade] = useState(initialSettings?.maxPerTrade?.toString() || '500')
  const [dailyLimit, setDailyLimit] = useState(initialSettings?.dailyLimit?.toString() || '2000')
  const [autoSellEnabled, setAutoSellEnabled] = useState(initialSettings?.autoSellEnabled ?? true)
  const [stopLossPercent, setStopLossPercent] = useState(initialSettings?.stopLossPercent ?? 15)
  const [takeProfitPercent, setTakeProfitPercent] = useState(initialSettings?.takeProfitPercent ?? 50)
  const [chainFilter, setChainFilter] = useState<string[]>(initialSettings?.chainFilter || ['ethereum', 'arbitrum', 'base', 'solana'])
  const [maxSlippage, setMaxSlippage] = useState(initialSettings?.maxSlippage?.toString() || '1')

  useEffect(() => {
    if (initialSettings) {
      setCopyMode(initialSettings.copyMode || 'notify')
      setFixedAmount(initialSettings.fixedAmount?.toString() || '100')
      setPercentageAmount(initialSettings.percentageAmount?.toString() || '10')
      setMaxPerTrade(initialSettings.maxPerTrade?.toString() || '500')
      setDailyLimit(initialSettings.dailyLimit?.toString() || '2000')
      setAutoSellEnabled(initialSettings.autoSellEnabled ?? true)
      setStopLossPercent(initialSettings.stopLossPercent ?? 15)
      setTakeProfitPercent(initialSettings.takeProfitPercent ?? 50)
      setChainFilter(initialSettings.chainFilter || ['ethereum', 'arbitrum', 'base', 'solana'])
      setMaxSlippage(initialSettings.maxSlippage?.toString() || '1')
    }
  }, [initialSettings])

  if (!isOpen) return null

  const toggleChain = (chainId: string) => {
    setChainFilter(prev =>
      prev.includes(chainId) ? prev.filter(c => c !== chainId) : [...prev, chainId]
    )
  }

  const handleSave = () => {
    onSave({
      copyMode,
      fixedAmount: parseFloat(fixedAmount) || undefined,
      percentageAmount: parseFloat(percentageAmount) || undefined,
      maxPerTrade: parseFloat(maxPerTrade) || undefined,
      dailyLimit: parseFloat(dailyLimit) || undefined,
      autoSellEnabled,
      stopLossPercent,
      takeProfitPercent,
      chainFilter,
      maxSlippage: parseFloat(maxSlippage) || undefined,
    })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-terminal-panel border border-terminal-border rounded-xl w-full max-w-md max-h-[85vh] overflow-auto p-5 space-y-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-terminal-text">
            {traderName ? `Copy Settings — ${traderName}` : 'Copy Settings'}
          </h3>
          <button onClick={onClose} className="text-terminal-text-muted hover:text-terminal-text text-lg leading-none">&times;</button>
        </div>

        {/* Copy Mode */}
        <div>
          <label className="text-xs text-terminal-text-secondary mb-2 block">Copy Mode</label>
          <div className="space-y-1.5">
            {([
              { value: 'notify' as CopyMode, label: 'Notify Only', desc: 'Get alerts when this trader makes a move' },
              { value: 'fixed' as CopyMode, label: 'Fixed Amount', desc: 'Copy every trade with a fixed USD amount' },
              { value: 'percentage' as CopyMode, label: 'Percentage', desc: 'Copy as a percentage of the trader\'s size' },
            ]).map(mode => (
              <label
                key={mode.value}
                className={`flex items-start gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                  copyMode === mode.value
                    ? 'border-sakura-600 bg-sakura-900/10'
                    : 'border-terminal-border hover:border-terminal-border-active'
                }`}
              >
                <input
                  type="radio"
                  name="copyMode"
                  value={mode.value}
                  checked={copyMode === mode.value}
                  onChange={() => setCopyMode(mode.value)}
                  className="mt-0.5 accent-sakura-500"
                />
                <div>
                  <div className="text-xs font-semibold text-terminal-text">{mode.label}</div>
                  <div className="text-[10px] text-terminal-text-muted">{mode.desc}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Amount input (conditional) */}
        {copyMode === 'fixed' && (
          <div>
            <label className="text-xs text-terminal-text-secondary mb-1 block">Fixed Amount (USD)</label>
            <input
              type="text"
              value={fixedAmount}
              onChange={e => setFixedAmount(e.target.value)}
              placeholder="100"
              className="terminal-input w-full font-mono"
            />
          </div>
        )}
        {copyMode === 'percentage' && (
          <div>
            <label className="text-xs text-terminal-text-secondary mb-1 block">Percentage (%)</label>
            <input
              type="text"
              value={percentageAmount}
              onChange={e => setPercentageAmount(e.target.value)}
              placeholder="10"
              className="terminal-input w-full font-mono"
            />
          </div>
        )}

        {/* Max per trade */}
        {copyMode !== 'notify' && (
          <>
            <div>
              <label className="text-xs text-terminal-text-secondary mb-1 block">Max Per Trade (USD)</label>
              <input
                type="text"
                value={maxPerTrade}
                onChange={e => setMaxPerTrade(e.target.value)}
                placeholder="500"
                className="terminal-input w-full font-mono"
              />
            </div>

            <div>
              <label className="text-xs text-terminal-text-secondary mb-1 block">Daily Limit (USD)</label>
              <input
                type="text"
                value={dailyLimit}
                onChange={e => setDailyLimit(e.target.value)}
                placeholder="2000"
                className="terminal-input w-full font-mono"
              />
            </div>

            {/* Max Slippage */}
            <div>
              <label className="text-xs text-terminal-text-secondary mb-1 block">Max Slippage (%)</label>
              <input
                type="text"
                value={maxSlippage}
                onChange={e => setMaxSlippage(e.target.value)}
                placeholder="1"
                className="terminal-input w-full font-mono"
              />
            </div>
          </>
        )}

        {/* TP/SL sliders */}
        {copyMode !== 'notify' && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={autoSellEnabled}
                onChange={e => setAutoSellEnabled(e.target.checked)}
                className="accent-sakura-500"
              />
              <label className="text-xs text-terminal-text-secondary">Auto sell (TP/SL)</label>
            </div>

            {autoSellEnabled && (
              <>
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-xs text-terminal-text-secondary">Stop Loss</label>
                    <span className="text-xs font-mono text-bear">{stopLossPercent}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={stopLossPercent}
                    onChange={e => setStopLossPercent(parseInt(e.target.value))}
                    className="w-full accent-bear"
                  />
                  <div className="flex justify-between text-[10px] text-terminal-text-muted">
                    <span>0%</span>
                    <span>100%</span>
                  </div>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-xs text-terminal-text-secondary">Take Profit</label>
                    <span className="text-xs font-mono text-bull">{takeProfitPercent}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={takeProfitPercent}
                    onChange={e => setTakeProfitPercent(parseInt(e.target.value))}
                    className="w-full accent-bull"
                  />
                  <div className="flex justify-between text-[10px] text-terminal-text-muted">
                    <span>0%</span>
                    <span>100%</span>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Chain filter */}
        <div>
          <label className="text-xs text-terminal-text-secondary mb-2 block">Chain Filter</label>
          <div className="flex flex-wrap gap-2">
            {CHAINS.map(chain => (
              <label
                key={chain.id}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded border cursor-pointer text-xs transition-colors ${
                  chainFilter.includes(chain.id)
                    ? 'border-sakura-600 bg-sakura-900/10 text-terminal-text'
                    : 'border-terminal-border text-terminal-text-muted hover:border-terminal-border-active'
                }`}
              >
                <input
                  type="checkbox"
                  checked={chainFilter.includes(chain.id)}
                  onChange={() => toggleChain(chain.id)}
                  className="accent-sakura-500 w-3 h-3"
                />
                {chain.label}
              </label>
            ))}
          </div>
        </div>

        {/* Buttons */}
        <div className="flex gap-2 pt-2">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded text-sm font-semibold bg-terminal-bg-tertiary border border-terminal-border text-terminal-text-secondary hover:text-terminal-text transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="flex-1 py-2.5 rounded text-sm font-semibold bg-sakura-600 hover:bg-sakura-700 text-white transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
