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
      className="terminal-theme-control h-8 rounded-[7px] px-3 text-xs font-semibold text-terminal-text transition-colors hover:text-sakura-700 disabled:cursor-not-allowed disabled:opacity-60"
      title={isAuthenticated ? 'Sign out' : 'Create a Turnkey passkey wallet'}
    >
      {authLabel}
    </button>
  )

  const brandLockup = (
    <div className="terminal-theme-panel flex h-10 items-center gap-2 rounded-[8px] px-2.5">
      <div className="flex h-7 w-7 items-center justify-center rounded-[7px] border border-white/70 bg-white/78 shadow-[0_4px_12px_rgba(229,141,43,0.16)]">
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
      <header className="terminal-theme-panel relative flex h-12 shrink-0 items-center justify-between rounded-[10px] px-2.5">
        <div className="flex items-center gap-2">
          {brandLockup}

          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="terminal-theme-control rounded-[7px] p-1 text-[#31576d]"
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
          <div className="terminal-theme-panel absolute left-0 right-0 top-[calc(100%+6px)] z-50 flex flex-col gap-3 rounded-[10px] p-3">
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
    <header className="terminal-theme-panel flex h-12 shrink-0 items-center justify-between rounded-[10px] px-3">
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
