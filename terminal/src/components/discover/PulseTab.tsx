import { useState, useRef, useCallback, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { PulseToken } from '../../types/api'
import { usePulse } from '../../hooks/usePulse'
import { PulseFilters } from './PulseFilters'
import { PulseTokenRow } from './PulseTokenRow'
import { TerminalSkeletonRows } from '../foundation'

const SUB_TABS = [
  { id: 'new' as const, label: 'New Creations' },
  { id: 'final_stretch' as const, label: 'Final Stretch' },
  { id: 'migrated' as const, label: 'Migrated' },
]

interface PulseTabProps {
  onSelectToken?: (token: PulseToken) => void
  onBuy?: (amount: number, tokenAddress: string) => void
}

export function PulseTab({ onSelectToken, onBuy }: PulseTabProps) {
  const {
    activeStage, setActiveStage,
    tokens, filters, setFilters, resetFilters,
    isLoading, isError, stageUnavailable,
    lastUpdated,
  } = usePulse()

  const [soundEnabled, setSoundEnabled] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const prevTokenCountRef = useRef(tokens.length)
  const queryClient = useQueryClient()

  const handleRetry = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['pulse-feed'] })
    queryClient.invalidateQueries({ queryKey: ['pulse-final-stretch'] })
  }, [queryClient])

  const timeSince = Math.floor((Date.now() - lastUpdated) / 1000)
  const hasBondingCol = activeStage === 'final_stretch'

  // Auto-scroll to top when new tokens arrive (unless hovered)
  useEffect(() => {
    if (tokens.length > prevTokenCountRef.current && !isHovered && scrollRef.current) {
      scrollRef.current.scrollTo({ top: 0, behavior: 'smooth' })
    }
    prevTokenCountRef.current = tokens.length
  }, [tokens.length, isHovered])

  const handleMouseEnter = useCallback(() => setIsHovered(true), [])
  const handleMouseLeave = useCallback(() => setIsHovered(false), [])

  return (
    <div className="flex flex-col h-full" data-testid="pulse-tab">
      {/* Sub-tabs */}
      <div className="flex items-center justify-between border-b border-terminal-border px-2 py-1 bg-terminal-bg-secondary/30">
        <div className="flex items-center gap-1">
          {SUB_TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveStage(tab.id)}
              className={`px-2 py-1 text-[10px] font-medium rounded transition-colors ${
                activeStage === tab.id
                  ? 'bg-sakura-600/20 text-sakura-400 border border-sakura-600/30'
                  : 'text-terminal-text-muted hover:text-terminal-text hover:bg-terminal-bg-tertiary'
              }`}
              data-testid={`pulse-subtab-${tab.id}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {/* Sound toggle */}
          <button
            onClick={() => setSoundEnabled(!soundEnabled)}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] border transition-colors ${
              soundEnabled
                ? 'bg-sakura-600/15 text-sakura-400 border-sakura-600/30'
                : 'text-terminal-text-muted border-terminal-border hover:border-terminal-border-active'
            }`}
            title={soundEnabled ? 'Mute new token alerts' : 'Enable sound for new tokens'}
            aria-label={soundEnabled ? 'Mute new token alerts' : 'Enable sound for new tokens'}
          >
            {soundEnabled ? (
              <svg className="w-3 h-3" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M8 2.81v10.38c0 .67-.81 1-1.28.53L3.78 10.8H1.5A.5.5 0 011 10.3V5.7a.5.5 0 01.5-.5h2.28l2.94-2.92A.75.75 0 018 2.81zM11.5 5a.5.5 0 01.36.15 4.98 4.98 0 010 5.7.5.5 0 01-.72-.7 3.98 3.98 0 000-4.3.5.5 0 01.36-.85zM13 3.5a.5.5 0 01.36.15 7.48 7.48 0 010 8.7.5.5 0 01-.72-.7 6.48 6.48 0 000-7.3A.5.5 0 0113 3.5z" />
              </svg>
            ) : (
              <svg className="w-3 h-3" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M8 2.81v10.38c0 .67-.81 1-1.28.53L3.78 10.8H1.5A.5.5 0 011 10.3V5.7a.5.5 0 01.5-.5h2.28l2.94-2.92A.75.75 0 018 2.81zM12.2 5.2a.5.5 0 01.7 0l1.1 1.1 1.1-1.1a.5.5 0 01.7.7L14.7 7l1.1 1.1a.5.5 0 01-.7.7L14 7.7l-1.1 1.1a.5.5 0 01-.7-.7L13.3 7l-1.1-1.1a.5.5 0 010-.7z" />
              </svg>
            )}
            <span>{soundEnabled ? 'On' : 'Off'}</span>
          </button>

          {/* Pause indicator */}
          {isHovered && (
            <span className="flex items-center gap-1 text-[9px] text-terminal-warn">
              <svg className="w-2.5 h-2.5" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true">
                <rect x="2" y="1" width="2" height="8" rx="0.5" />
                <rect x="6" y="1" width="2" height="8" rx="0.5" />
              </svg>
              Paused
            </span>
          )}

          {/* Live indicator */}
          <span className="flex items-center gap-1 text-[9px] text-terminal-text-muted" role="status">
            <span className={`w-1.5 h-1.5 rounded-full ${isHovered ? 'bg-terminal-warn' : 'bg-bull pulse-live'}`} />
            {timeSince < 5 ? 'Live' : `${timeSince}s ago`}
          </span>
        </div>
      </div>

      {/* Filters */}
      <PulseFilters filters={filters} onChange={setFilters} onReset={resetFilters} />

      {/* Table */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <table className="w-full text-xs">
          <thead>
            <tr className="text-terminal-text-muted border-b border-terminal-border sticky top-0 bg-terminal-bg z-10">
              <th className="text-left py-1 px-2 font-medium text-[10px]">Age</th>
              <th className="text-left py-1 px-2 font-medium text-[10px]">Token</th>
              <th className="text-left py-1 px-2 font-medium text-[10px]">Chain</th>
              <th className="text-right py-1 px-2 font-medium text-[10px]">MCap</th>
              <th className="text-right py-1 px-2 font-medium text-[10px]">Vol</th>
              <th className="text-left py-1 px-2 font-medium text-[10px]">Chart</th>
              <th className="text-right py-1 px-2 font-medium text-[10px]">5m</th>
              <th className="text-right py-1 px-2 font-medium text-[10px]">1h</th>
              <th className="text-right py-1 px-2 font-medium text-[10px]">24h</th>
              <th className="text-right py-1 px-2 font-medium text-[10px]">Holders</th>
              <th className="text-right py-1 px-2 font-medium text-[10px]">Txns</th>
              <th className="text-center py-1 px-2 font-medium text-[10px]">Safety</th>
              {hasBondingCol && (
                <th className="text-left py-1 px-2 font-medium text-[10px]">Bond%</th>
              )}
              <th className="text-right py-1 px-2 font-medium text-[10px]"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && tokens.length === 0 ? (
              <tr>
                <td colSpan={hasBondingCol ? 14 : 13} className="p-0">
                  <TerminalSkeletonRows rows={6} columns={7} className="p-3" label="Loading live tokens" />
                </td>
              </tr>
            ) : tokens.length === 0 ? (
              <tr>
                <td colSpan={hasBondingCol ? 14 : 13} className="text-center text-terminal-text-muted text-sm py-8">
                  <div className="flex flex-col items-center gap-2">
                    <span>
                      {stageUnavailable
                        ? 'Final Stretch needs a pump.fun bonding feed — coming soon.'
                        : isError
                          ? 'Could not reach the live feed.'
                          : 'No tokens match your filters'}
                    </span>
                    {isError && !stageUnavailable && (
                      <button
                        type="button"
                        onClick={handleRetry}
                        className="terminal-button-secondary px-3 py-1 text-xs"
                      >
                        Retry
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ) : (
              tokens.map((token, idx) => (
                <PulseTokenRow
                  key={token.address}
                  token={token}
                  isNew={idx === 0}
                  onSelect={onSelectToken}
                  onBuy={onBuy}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
