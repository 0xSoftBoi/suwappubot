import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useAuth } from '../../contexts/AuthContext'

// Non-custodial sign-in. RainbowKit handles the connect step (MetaMask,
// WalletConnect, Coinbase, …); once a wallet is connected we prove ownership by
// signing a SIWE challenge (signInWithWallet). Google OAuth stays as a fallback
// for users without a browser wallet.
export function WalletConnect() {
  const {
    signInWithWallet,
    signInWithPhantom,
    isPhantomAvailable,
    signInWithGoogle,
    isLoading,
    isHardwareWallet,
    isWalletConnecting,
  } = useAuth()

  return (
    <div className="flex flex-col gap-2">
      <ConnectButton.Custom>
        {({ account, chain, openConnectModal, mounted }) => {
          const connected = mounted && !!account && !!chain
          if (!connected) {
            return (
              <button
                onClick={openConnectModal}
                type="button"
                className="w-full py-3 text-base font-semibold rounded-terminal-control transition-colors
                           bg-sakura-500 hover:bg-sakura-600 text-terminal-on-accent"
              >
                Connect Wallet
              </button>
            )
          }
          // AuthContext auto-fires the SIWE signature the moment the wallet
          // connects (see the auto sign-in effect there), so this button is
          // mainly the fallback for a rejected/failed auto-attempt — clicking it
          // re-runs the same signInWithWallet round-trip.
          const signing = isLoading || isWalletConnecting
          return (
            <button
              onClick={() => void signInWithWallet()}
              disabled={signing}
              type="button"
              className="w-full py-3 text-base font-semibold rounded-terminal-control transition-colors
                         bg-sakura-500 hover:bg-sakura-600 text-terminal-on-accent disabled:opacity-50"
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

      {isPhantomAvailable ? (
        <button
          onClick={() => void signInWithPhantom()}
          disabled={isLoading}
          type="button"
          className="w-full py-3 text-base font-semibold rounded-terminal-control transition-colors
                     bg-transparent hover:bg-terminal-bg-tertiary text-terminal-text
                     border hairline-strong disabled:opacity-50"
        >
          Connect Phantom (Solana)
        </button>
      ) : (
        <a
          href={`https://phantom.app/ul/browse/${encodeURIComponent(window.location.href)}?ref=${encodeURIComponent(window.location.origin)}`}
          className="flex min-h-11 w-full items-center justify-center rounded-terminal-control border hairline-strong
                     bg-transparent px-3 text-center text-base font-semibold text-terminal-text transition-colors
                     hover:bg-terminal-bg-tertiary"
        >
          Open in Phantom
        </a>
      )}

      <button
        onClick={signInWithGoogle}
        type="button"
        className="flex min-h-11 items-center justify-center text-center text-xs text-terminal-text-secondary transition-colors hover:text-terminal-text"
      >
        or continue with Google
      </button>
    </div>
  )
}
