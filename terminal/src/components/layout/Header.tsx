import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ChainSelector } from './ChainSelector'
import { ModeSwitch } from './ModeSwitch'
import { MarketSearchButton } from '../command/MarketSearchButton'
import { openCommandPalette } from '../command/CommandPalette'
import { useTrading } from '../../contexts/TradingContext'
import { usePair } from '../../contexts/PairContext'
import { useAuth } from '../../contexts/AuthContext'
import { useIsMobile } from '../../hooks/useIsMobile'
import { useCoinbaseFeed } from '../../hooks/useCoinbaseFeed'
import { usePoints } from '../../hooks/usePoints'
import { cexSymbol, coinbaseProductId } from '../../lib/marketSupport'
import { PersimmonMark } from '../brand/PersimmonLogo'

// Compact "connected" indicator for the live market-data feed backing the
// current pair. Reflects the real Coinbase WS state (connecting/live/error) —
// no fabricated uptime numbers. Pairs without a public Coinbase market show a
// neutral dot rather than pretending to be live.
function ConnectionDot() {
  const { selectedPair, selectedChain } = usePair()
  const symbol = cexSymbol(selectedPair.base?.address, selectedChain, selectedPair.base?.symbol)
  const productId = coinbaseProductId(symbol)
  const feed = useCoinbaseFeed(productId)

  const { color, label, pulse } = useMemo(() => {
    if (!productId || !feed) {
      return { color: 'bg-terminal-text-muted', label: 'No live market feed for this pair', pulse: false }
    }
    if (feed.status === 'live') return { color: 'bg-terminal-up', label: 'Live market data', pulse: true }
    if (feed.status === 'error') return { color: 'bg-terminal-down', label: 'Market data disconnected', pulse: false }
    return { color: 'bg-terminal-warn', label: 'Connecting to market data…', pulse: false }
  }, [feed, productId])

  return (
    <span
      role="status"
      aria-label={label}
      title={label}
      className={`h-1.5 w-1.5 shrink-0 rounded-full ${color} ${pulse ? 'pulse-live' : ''}`}
    />
  )
}

// Compact season/points chip — read-only usePoints, hidden when signed out.
// Static "S1" reflects the current (first) points season; the count is real
// XP from the backend, never invented.
function SeasonPointsChip() {
  const { isAuthenticated } = useAuth()
  const { data: profile } = usePoints()
  if (!isAuthenticated) return null

  return (
    <Link
      to="/points"
      className="terminal-theme-control hidden h-8 items-center gap-1.5 rounded-[7px] px-2.5 text-xs font-semibold text-terminal-text transition-colors hover:text-terminal-accent sm:flex"
      title="View your season points"
    >
      <span className="terminal-theme-caption text-[10px] uppercase text-terminal-accent">S1</span>
      <span className="tnum font-mono text-terminal-text">
        {profile ? profile.xp.toLocaleString() : '—'} pts
      </span>
    </Link>
  )
}

export function Header() {
  const { selectedChain, setSelectedChain } = usePair()
  const { tradingMode } = useTrading()
  const {
    isAuthenticated,
    walletAddress,
    isLoading,
    signIn,
    signInWithGoogle,
    signInWithWallet,
    signInWithPhantom,
    isPhantomAvailable,
    signOut,
    clearError,
    error,
    isTelegram,
    isWalletConnecting,
    isWalletAuthAvailable,
  } = useAuth()
  const isMobile = useIsMobile()
  const [menuOpen, setMenuOpen] = useState(false)

  const shortAddress = walletAddress
    ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`
    : ''

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

  // On Solana, an injected Phantom provider is the shortest and most reliable
  // path inside Phantom's mobile browser. EVM wallets stay inside wagmi /
  // RainbowKit so injected EIP-1193/EIP-6963 state and signing never diverge.
  const useInjectedPhantom = selectedChain === 'solana' && isPhantomAvailable
  const walletAuthBlocked = !useInjectedPhantom && !isWalletAuthAvailable
  const walletWorking = isLoading || (!useInjectedPhantom && isWalletConnecting)
  const handleWalletSignIn = () => {
    if (useInjectedPhantom) {
      void signInWithPhantom()
      return
    }
    void signInWithWallet()
  }

  const walletButton = !isAuthenticated && !isTelegram ? (
    <button
      type="button"
      data-testid="connect-wallet"
      onClick={handleWalletSignIn}
      disabled={walletWorking || walletAuthBlocked}
      className="terminal-theme-control flex h-10 min-w-10 items-center justify-center gap-1.5 rounded-[7px] px-2.5 text-xs font-semibold text-terminal-text transition-colors hover:text-sakura-700 disabled:cursor-not-allowed disabled:opacity-60 sm:h-8 sm:min-w-0 sm:justify-start sm:px-3"
      title={
        walletAuthBlocked
          ? 'Wallet sign-in is not available on this server yet'
          : useInjectedPhantom
            ? 'Connect Phantom for Solana'
            : 'Connect a wallet and sign in'
      }
      aria-label={useInjectedPhantom ? 'Connect Phantom for Solana' : 'Connect wallet'}
    >
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 7h18v10H3z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M16 12h2M3 7l3-3h11l1 3" />
      </svg>
      <span className="whitespace-nowrap">
        {walletWorking ? 'Signing…' : useInjectedPhantom ? 'Phantom' : isMobile ? 'Connect' : 'Connect wallet'}
      </span>
    </button>
  ) : null

  // Passkey sign-in is server-gated (503) until real WebAuthn assertion
  // verification ships — the old endpoints accepted unverified assertions, so
  // they were disabled rather than left exploitable. When signed out, the
  // primary paths (wallet, Google) carry sign-in, so the only button rendered
  // here is the signed-in identity chip (shows the address, click to sign out).
  // signIn() stays wired for the day the passkey backend re-enables.
  const authButton = isAuthenticated ? (
    <button
      type="button"
      onClick={handleAuthClick}
      disabled={isLoading}
      className="terminal-theme-control h-10 max-w-[108px] truncate rounded-[7px] px-2.5 text-xs font-semibold text-terminal-text transition-colors hover:text-sakura-700 disabled:cursor-not-allowed disabled:opacity-60 sm:h-8 sm:max-w-none sm:px-3"
      title={isTelegram ? 'Signed in via Telegram' : 'Sign out'}
    >
      {shortAddress || 'Signed in'}
    </button>
  ) : (
    <button
      type="button"
      onClick={() => void signIn()}
      disabled
      className="terminal-theme-control h-8 rounded-[7px] px-3 text-xs font-semibold text-terminal-text transition-colors disabled:cursor-not-allowed disabled:opacity-60"
      title="Passkey sign-in is temporarily unavailable — use a wallet or Google"
    >
      {isLoading ? 'Connecting' : 'Passkey'}
    </button>
  )

  const brandLockup = (
    <div className="terminal-theme-panel flex h-9 items-center gap-2 rounded-[8px] px-2.5">
      <div className="flex h-6 w-6 items-center justify-center rounded-[7px] border border-terminal-hairline-strong bg-terminal-bg-secondary">
        <PersimmonMark
          size={20}
          palette="sunrise"
          variant="slice"
          shell="coin"
          cutoutMode="none"
          withGlow={false}
          leafCount={4}
        />
      </div>
      <div className="flex items-baseline gap-1.5 leading-none">
        <span className="font-display text-[16px] font-semibold tracking-normal text-terminal-text">
          SUWAPPU
        </span>
        <span className="terminal-theme-caption hidden font-mono text-[10px] uppercase text-terminal-text-muted sm:inline">
          Terminal
        </span>
      </div>
      <ConnectionDot />
    </div>
  )

  if (isMobile) {
    return (
      <header className="terminal-mobile-header terminal-theme-panel hairline-b relative z-[60] flex h-12 shrink-0 items-center justify-between rounded-[10px] px-1.5">
        <div className="flex min-w-0 items-center gap-1.5">
          {brandLockup}

          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            className="terminal-theme-control flex h-11 w-11 shrink-0 items-center justify-center rounded-[7px] text-terminal-text-secondary"
            title="Terminal menu"
            aria-label="Open terminal menu"
            aria-expanded={menuOpen}
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              {menuOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {isAuthenticated ? authButton : walletButton}
        </div>

        {menuOpen && (
          <div className="terminal-mobile-header-menu terminal-theme-overlay absolute left-0 right-0 top-[calc(100%+6px)] z-[80] flex flex-col gap-3 overflow-y-auto p-3">
            <ModeSwitch className="terminal-mobile-mode-switch w-full justify-between" />

            <button
              type="button"
              onClick={() => {
                setMenuOpen(false)
                openCommandPalette()
              }}
              className="terminal-theme-control flex min-h-11 items-center gap-2 rounded-[8px] px-3 text-base text-terminal-text-secondary"
            >
              <span className="text-terminal-text-muted" aria-hidden="true">⌕</span>
              Search markets & tokens
            </button>

            <div className="flex min-h-11 items-center gap-3">
              <span className="terminal-theme-caption w-12 shrink-0 text-[10px] uppercase">Chain</span>
              <ChainSelector selected={selectedChain} onSelect={setSelectedChain} />
            </div>

            {!isAuthenticated && !isTelegram && (
              <div className="grid grid-cols-2 gap-2 border-t border-terminal-border pt-3">
                {isPhantomAvailable ? (
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false)
                      void signInWithPhantom()
                    }}
                    disabled={isLoading}
                    className="terminal-theme-control min-h-11 px-3 text-sm font-semibold text-terminal-text disabled:opacity-60"
                  >
                    Phantom
                  </button>
                ) : (
                  <a
                    href={`https://phantom.app/ul/browse/${encodeURIComponent(window.location.href)}?ref=${encodeURIComponent(window.location.origin)}`}
                    className="terminal-theme-control flex min-h-11 items-center justify-center px-3 text-center text-sm font-semibold text-terminal-text"
                  >
                    Open in Phantom
                  </a>
                )}
                <a
                  href={`https://link.metamask.io/dapp/${window.location.href.replace('https://', '').replace('http://', '')}`}
                  className="terminal-theme-control flex min-h-11 items-center justify-center px-3 text-center text-sm font-semibold text-terminal-text"
                >
                  Open in MetaMask
                </a>
                <button
                  type="button"
                  onClick={() => signInWithGoogle()}
                  disabled={isLoading}
                  className="terminal-theme-control col-span-2 min-h-11 px-3 text-sm font-semibold text-terminal-text disabled:opacity-60"
                >
                  Google
                </button>
              </div>
            )}
          </div>
        )}
      </header>
    )
  }

  return (
    <header className="terminal-theme-panel hairline-b flex h-11 shrink-0 items-center justify-between rounded-[10px] px-3">
      <div className="flex items-center gap-4">
        {brandLockup}

        <div className="h-6 w-px bg-terminal-hairline-strong" />

        <ModeSwitch />

        {/* Universal search/switcher — opens the command palette (⌘K). Always
            available so you can jump to any token, mode, or panel from anywhere. */}
        <MarketSearchButton />

        {tradingMode === 'spot' && (
          <ChainSelector selected={selectedChain} onSelect={setSelectedChain} />
        )}
      </div>

      <div className="flex items-center gap-2">
        <a
          href="https://app.suwappu.bot/enterprise"
          target="_blank"
          rel="noopener noreferrer"
          className="terminal-theme-control hidden lg:flex h-8 items-center gap-1.5 rounded-[7px] px-2.5 text-xs font-semibold text-terminal-text-secondary transition-colors hover:text-sakura-700"
          title="Get an API key for programmatic access"
        >
          API Keys
        </a>
        <SeasonPointsChip />
        {walletButton}
        {googleButton}
        {authButton}
      </div>
    </header>
  )
}
