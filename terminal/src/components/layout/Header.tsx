import { ConnectButton } from '@rainbow-me/rainbowkit'
import { ChainSelector } from './ChainSelector'
import { PairSelector } from './PairSelector'
import { useSelectedPair } from '../../hooks/useSelectedPair'

export function Header() {
  const { selectedChain, setSelectedChain, selectedPair, setSelectedPair } = useSelectedPair()

  return (
    <header className="flex items-center justify-between h-12 px-4 border-b border-terminal-border bg-terminal-panel shrink-0">
      <div className="flex items-center gap-4">
        {/* Logo */}
        <div className="flex items-center gap-2">
          <span className="text-sakura-400 font-bold text-lg tracking-tight">SUWAPPU</span>
          <span className="text-terminal-text-muted text-xs font-mono">TERMINAL</span>
        </div>

        <div className="w-px h-6 bg-terminal-border" />

        {/* Chain selector */}
        <ChainSelector selected={selectedChain} onSelect={setSelectedChain} />

        {/* Pair selector */}
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
