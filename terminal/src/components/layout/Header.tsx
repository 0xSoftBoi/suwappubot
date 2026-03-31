import { useState } from 'react'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { ChainSelector } from './ChainSelector'
import { PairSelector } from './PairSelector'
import { usePair } from '../../contexts/PairContext'
import { useIsMobile } from '../../hooks/useIsMobile'

export function Header() {
  const { selectedChain, setSelectedChain, selectedPair, setSelectedPair } = usePair()
  const isMobile = useIsMobile()
  const [menuOpen, setMenuOpen] = useState(false)

  if (isMobile) {
    return (
      <header className="relative flex items-center justify-between h-10 px-3 border-b border-terminal-border bg-terminal-panel shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sakura-400 font-bold text-base tracking-tight">SUWAPPU</span>

          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="p-1 rounded hover:bg-terminal-bg-tertiary transition-colors"
            title="Select chain & pair"
          >
            <svg className="w-5 h-5 text-terminal-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              {menuOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        </div>

        <div className="flex items-center">
          <ConnectButton
            chainStatus="none"
            accountStatus="avatar"
            showBalance={false}
          />
        </div>

        {menuOpen && (
          <div className="absolute top-10 left-0 right-0 z-50 bg-terminal-bg-secondary border-b border-terminal-border p-3 flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <span className="text-xs text-terminal-text-muted w-12 shrink-0">Chain</span>
              <ChainSelector selected={selectedChain} onSelect={(chain) => { setSelectedChain(chain); }} />
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-terminal-text-muted w-12 shrink-0">Pair</span>
              <PairSelector
                chain={selectedChain}
                selected={selectedPair}
                onSelect={(pair) => { setSelectedPair(pair); setMenuOpen(false); }}
              />
            </div>
          </div>
        )}
      </header>
    )
  }

  return (
    <header className="flex items-center justify-between h-10 px-4 border-b border-terminal-border bg-terminal-panel shrink-0">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sakura-400 font-bold text-lg tracking-tight">SUWAPPU</span>
          <span className="text-terminal-text-muted text-xs font-mono">TERMINAL</span>
        </div>

        <div className="w-px h-6 bg-terminal-border" />

        <ChainSelector selected={selectedChain} onSelect={setSelectedChain} />

        <PairSelector
          chain={selectedChain}
          selected={selectedPair}
          onSelect={setSelectedPair}
        />
      </div>

      <div className="flex items-center gap-3">
        <ConnectButton
          chainStatus="icon"
          accountStatus="address"
          showBalance={false}
        />
      </div>
    </header>
  )
}
