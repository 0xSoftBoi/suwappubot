import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { ChainSelector } from './ChainSelector'
import { PairSelector } from './PairSelector'
import { usePair } from '../../contexts/PairContext'
import { useAuth } from '../../contexts/AuthContext'
import { useIsMobile } from '../../hooks/useIsMobile'
import { PersimmonMark } from '../brand/PersimmonLogo'

export function Header() {
  const { selectedChain, setSelectedChain, selectedPair, setSelectedPair } = usePair()
  const {
    isAuthenticated,
    walletAddress,
    isLoading,
    signIn,
    signOut,
    clearError,
    error,
    isPasskeySupported,
  } = useAuth()
  const isMobile = useIsMobile()
  const [menuOpen, setMenuOpen] = useState(false)

  const authLabel = isAuthenticated && walletAddress
    ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`
    : isLoading
      ? 'Connecting'
      : 'Turnkey'

  const handleAuthClick = () => {
    if (isAuthenticated) {
      signOut()
      return
    }
    void signIn()
  }

  useEffect(() => {
    if (!error) return
    toast.error(error)
    clearError()
  }, [clearError, error])

  const authButton = (
    <button
      type="button"
      onClick={handleAuthClick}
      disabled={isLoading || (!isAuthenticated && !isPasskeySupported)}
      className="h-7 rounded border border-terminal-border bg-terminal-bg px-2.5 text-xs font-semibold text-terminal-text transition-colors hover:border-sakura-400 hover:text-sakura-300 disabled:cursor-not-allowed disabled:opacity-60"
      title={isAuthenticated ? 'Sign out' : 'Create a Turnkey passkey wallet'}
    >
      {authLabel}
    </button>
  )

  const brandLockup = (
    <div className="flex h-9 items-center gap-2 rounded-[10px] border border-white/70 bg-cyan/70 px-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_10px_24px_rgba(70,150,170,0.14)]">
      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-white/70 shadow-[0_4px_12px_rgba(229,141,43,0.16)]">
        <PersimmonMark
          size={24}
          palette="sunrise"
          variant="slice"
          shell="coin"
          cutoutMode="none"
          withGlow={false}
          leafCount={4}
        />
      </div>
      <div className="flex items-baseline gap-1.5 leading-none">
        <span className="font-display text-[19px] font-bold tracking-normal text-[#169fe0]">
          SUWAPPU
        </span>
        <span className="font-mono text-[10px] uppercase tracking-normal text-[#6b8ca0]">
          Terminal
        </span>
      </div>
    </div>
  )

  if (isMobile) {
    return (
      <header className="relative flex h-12 shrink-0 items-center justify-between border-b border-white/70 bg-[linear-gradient(90deg,rgba(237,248,251,0.96),rgba(255,253,248,0.94))] px-2.5 shadow-[0_1px_0_rgba(120,178,196,0.18)]">
        <div className="flex items-center gap-2">
          {brandLockup}

          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="rounded border border-white/70 bg-white/58 p-1 text-[#31576d] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] transition-colors hover:bg-white"
            title="Select chain & pair"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              {menuOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        </div>

        <div className="flex items-center">
          {authButton}
        </div>

        {menuOpen && (
          <div className="absolute left-0 right-0 top-12 z-50 flex flex-col gap-3 border-b border-terminal-border bg-terminal-bg-secondary p-3">
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
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-white/70 bg-[linear-gradient(90deg,rgba(237,248,251,0.96),rgba(255,253,248,0.94))] px-3 shadow-[0_1px_0_rgba(120,178,196,0.18)]">
      <div className="flex items-center gap-4">
        {brandLockup}

        <div className="h-7 w-px bg-white/80 shadow-[1px_0_0_rgba(100,150,170,0.16)]" />

        <ChainSelector selected={selectedChain} onSelect={setSelectedChain} />

        <PairSelector
          chain={selectedChain}
          selected={selectedPair}
          onSelect={setSelectedPair}
        />
      </div>

      <div className="flex items-center gap-3">
        {authButton}
      </div>
    </header>
  )
}
