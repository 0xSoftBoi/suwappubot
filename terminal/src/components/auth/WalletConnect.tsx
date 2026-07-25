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

      <button
        onClick={() => void signInWithPhantom()}
        disabled={isLoading}
        type="button"
        className="w-full py-3 text-base font-semibold rounded-terminal-control transition-colors
                   bg-[#ab9ff2] hover:bg-[#9a8ce8] text-black disabled:opacity-50"
      >
        {isPhantomAvailable ? 'Connect Phantom (Solana)' : 'Get Phantom for Solana'}
      </button>

      <button
        onClick={signInWithGoogle}
        type="button"
        className="text-xs text-terminal-text-secondary hover:text-terminal-text
                   transition-colors text-center"
      >
        or continue with Google
      </button>
    </div>
  )
}
