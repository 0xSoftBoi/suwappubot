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
    signInWithGoogle,
    signOut,
    clearError,
    error,
    isPasskeySupported,
    isTelegram,
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

  // Google "one-tap" social login. Shown alongside the passkey button only when
  // signed out — passkey stays the primary option. A single icon button keeps
  // the dense terminal header tidy; hands off to the backend OAuth flow.
  const googleButton = !isAuthenticated && !isTelegram ? (
    <button
      type="button"
      onClick={() => signInWithGoogle()}
      disabled={isLoading}
      className="terminal-theme-control flex h-8 items-center gap-1.5 rounded-[7px] px-2.5 text-xs font-semibold text-terminal-text transition-colors hover:text-sakura-700 disabled:cursor-not-allowed disabled:opacity-60"
      title="Continue with Google"
      aria-label="Continue with Google"
    >
      <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.56c2.08-1.92 3.28-4.74 3.28-8.09z" />
        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.76c-.98.66-2.23 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
        <path fill="#FBBC05" d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84z" />
        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.05l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38z" />
      </svg>
      <span className="hidden sm:inline">Google</span>
    </button>
  ) : null

  // Passkey sign-in is server-gated (503) until real WebAuthn assertion
  // verification ships — the old endpoints accepted unverified assertions, so
  // they were disabled rather than left exploitable. Keep the button visible
  // but disabled when signed out; Google sign-in is the working path.
  const authButton = (
    <button
      type="button"
      onClick={handleAuthClick}
      disabled={isLoading || !isAuthenticated}
      className="terminal-theme-control h-8 rounded-[7px] px-3 text-xs font-semibold text-terminal-text transition-colors hover:text-sakura-700 disabled:cursor-not-allowed disabled:opacity-60"
      title={
        isAuthenticated
          ? isTelegram
            ? 'Signed in via Telegram'
            : 'Sign out'
          : 'Passkey sign-in is temporarily unavailable — use Google'
      }
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

        <div className="flex items-center gap-1.5">
          {googleButton}
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

      <div className="flex items-center gap-2">
        {googleButton}
        {authButton}
      </div>
    </header>
  )
}
