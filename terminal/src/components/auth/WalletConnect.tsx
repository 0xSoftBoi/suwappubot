import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useAuth } from '../../contexts/AuthContext'
import { useIsMobile } from '../../hooks/useIsMobile'
import { metamaskDappUrl, phantomBrowseUrl } from '../../lib/walletLinks'

interface WalletConnectProps {
  preferredChain?: string
  showGoogle?: boolean
}

// Route the primary action to the wallet that can actually sign the spend
// chain. Inside wallet browsers we use the injected capability first; normal
// mobile browsers get the provider's universal-link fallback.
export function WalletConnect({ preferredChain = 'ethereum', showGoogle = true }: WalletConnectProps) {
  const {
    signInWithWallet,
    signInWithPhantom,
    isPhantomAvailable,
    signInWithGoogle,
    isLoading,
    isHardwareWallet,
    isWalletConnecting,
    isWalletAuthAvailable,
  } = useAuth()
  const isMobile = useIsMobile()
  const prefersSolana = preferredChain === 'solana'
  const currentUrl = typeof window !== 'undefined' ? window.location.href : 'https://terminal.suwappu.bot/'
  const currentOrigin = typeof window !== 'undefined' ? window.location.origin : 'https://terminal.suwappu.bot'

  const primary = prefersSolana ? (
    isPhantomAvailable ? (
      <button
        onClick={() => void signInWithPhantom()}
        disabled={isLoading}
        type="button"
        className="w-full rounded-terminal-control border hairline-strong bg-transparent py-3 text-base font-semibold text-terminal-text transition-colors hover:bg-terminal-bg-tertiary disabled:opacity-50"
      >
        {isLoading ? 'Check Phantom…' : 'Connect Phantom'}
      </button>
    ) : (
      <a
        href={phantomBrowseUrl(currentUrl, currentOrigin)}
        className="flex min-h-11 w-full items-center justify-center rounded-terminal-control border hairline-strong bg-transparent px-3 text-center text-base font-semibold text-terminal-text transition-colors hover:bg-terminal-bg-tertiary"
      >
        Open in Phantom
      </a>
    )
  ) : (
    <ConnectButton.Custom>
      {({ account, chain, mounted }) => {
        const connected = mounted && !!account && !!chain
        if (!connected) {
          return (
            <button
              onClick={() => void signInWithWallet()}
              disabled={!isWalletAuthAvailable}
              type="button"
              className="w-full rounded-terminal-control bg-sakura-500 py-3 text-base font-semibold text-terminal-on-accent transition-colors hover:bg-sakura-600 disabled:opacity-50"
            >
              {isWalletAuthAvailable ? 'Connect Wallet' : 'Wallet sign-in unavailable'}
            </button>
          )
        }

        const signing = isLoading || isWalletConnecting
        return (
          <button
            onClick={() => void signInWithWallet()}
            disabled={signing || !isWalletAuthAvailable}
            type="button"
            className="w-full rounded-terminal-control bg-sakura-500 py-3 text-base font-semibold text-terminal-on-accent transition-colors hover:bg-sakura-600 disabled:opacity-50"
          >
            {signing
              ? isHardwareWallet
                ? 'Confirm on your Ledger…'
                : 'Check your wallet…'
              : `Sign in as ${account.displayName}`}
          </button>
        )
      }}
    </ConnectButton.Custom>
  )

  return (
    <div className="flex flex-col gap-2">
      {primary}

      {isMobile && !prefersSolana && (
        <a
          href={metamaskDappUrl(currentUrl)}
          className="flex min-h-11 items-center justify-center rounded-terminal-control border hairline-strong px-3 text-sm font-semibold text-terminal-text-secondary transition-colors hover:text-terminal-text"
        >
          Open in MetaMask
        </a>
      )}

      {showGoogle && (
        <button
          onClick={signInWithGoogle}
          type="button"
          className="flex min-h-11 items-center justify-center text-center text-xs text-terminal-text-secondary transition-colors hover:text-terminal-text"
        >
          or continue with Google
        </button>
      )}
    </div>
  )
}
