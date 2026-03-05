import { useState, useRef, useEffect } from 'react'
import { useTokenSearch } from '../../hooks/useTokens'
import type { SwapToken } from '../../types/swap'

export interface TokenSelectorProps {
  /** Currently selected token */
  selectedToken: SwapToken | null
  /** Callback when token is selected */
  onSelect: (token: SwapToken) => void
  /** Chain filter */
  chain?: string
  /** Tokens to exclude from list (e.g. already selected) */
  excludeAddresses?: string[]
  /** Label for the selector */
  label?: string
}

export function TokenSelector({
  selectedToken,
  onSelect,
  chain,
  excludeAddresses = [],
  label,
}: TokenSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const dropdownRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const { data: tokens, isLoading, error } = useTokenSearch(search, chain)

  // Filter out excluded tokens
  const filteredTokens = tokens?.filter(
    (t: SwapToken) => !excludeAddresses.includes(t.address)
  )

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Focus input when dropdown opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isOpen])

  const handleSelect = (token: SwapToken) => {
    onSelect(token)
    setIsOpen(false)
    setSearch('')
  }

  const formatBalance = (balance?: string) => {
    if (!balance) return null
    const num = parseFloat(balance)
    if (isNaN(num)) return balance
    if (num === 0) return '0'
    if (num < 0.0001) return '<0.0001'
    return num.toFixed(4)
  }

  return (
    <div className="relative" ref={dropdownRef}>
      {label && (
        <span className="text-xs text-suwappu-text-secondary mb-1 block">{label}</span>
      )}
      
      {/* Selected Token Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 bg-suwappu-sakura-light rounded-suwappu-lg hover:bg-suwappu-sakura-mid/30 transition-colors w-full"
      >
        {selectedToken ? (
          <>
            {selectedToken.logoUrl ? (
              <img 
                src={selectedToken.logoUrl} 
                alt={selectedToken.symbol}
                className="w-6 h-6 rounded-full"
              />
            ) : (
              <div className="w-6 h-6 rounded-full bg-suwappu-gradient flex items-center justify-center text-white text-xs font-bold">
                {selectedToken.symbol.slice(0, 2)}
              </div>
            )}
            <span className="font-heading font-semibold text-sm flex-1 text-left">
              {selectedToken.symbol}
            </span>
          </>
        ) : (
          <span className="font-heading font-semibold text-sm flex-1 text-left text-suwappu-text-secondary">
            Select token
          </span>
        )}
        <svg 
          className={`w-4 h-4 text-suwappu-text-secondary transition-transform ${isOpen ? 'rotate-180' : ''}`} 
          fill="none" 
          stroke="currentColor" 
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-suwappu-lg shadow-suwappu-2 border border-suwappu-sakura-mid/20 z-50 max-h-72 overflow-hidden flex flex-col">
          {/* Search Input */}
          <div className="p-2 border-b border-suwappu-sakura-light">
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or address..."
              className="w-full px-3 py-2 text-sm bg-suwappu-sakura-light/50 rounded-suwappu-md focus:outline-none focus:ring-2 focus:ring-suwappu-magenta-mid/30"
            />
          </div>

          {/* Token List */}
          <div className="overflow-y-auto flex-1">
            {isLoading && (
              <div className="p-4 text-center text-suwappu-text-secondary text-sm">
                Loading tokens...
              </div>
            )}

            {error && (
              <div className="p-4 text-center text-suwappu-error text-sm">
                Failed to load tokens
              </div>
            )}

            {!isLoading && !error && filteredTokens?.length === 0 && (
              <div className="p-4 text-center text-suwappu-text-secondary text-sm">
                No tokens found
              </div>
            )}

            {filteredTokens?.map((token: SwapToken) => (
              <button
                key={`${token.chain}-${token.address}`}
                onClick={() => handleSelect(token)}
                className="w-full flex items-center gap-3 px-3 py-2 hover:bg-suwappu-sakura-light/50 transition-colors"
              >
                {token.logoUrl ? (
                  <img 
                    src={token.logoUrl} 
                    alt={token.symbol}
                    className="w-8 h-8 rounded-full"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-suwappu-gradient flex items-center justify-center text-white text-xs font-bold">
                    {token.symbol.slice(0, 2)}
                  </div>
                )}
                <div className="flex-1 text-left">
                  <div className="font-heading font-semibold text-sm text-suwappu-text">
                    {token.symbol}
                  </div>
                  <div className="text-xs text-suwappu-text-secondary truncate">
                    {token.name}
                  </div>
                </div>
                {token.balance && (
                  <div className="text-right">
                    <div className="text-xs font-medium text-suwappu-text">
                      {formatBalance(token.balance)}
                    </div>
                    {token.balanceUsd !== undefined && token.balanceUsd > 0 && (
                      <div className="text-xs text-suwappu-text-secondary">
                        ${token.balanceUsd.toFixed(2)}
                      </div>
                    )}
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
