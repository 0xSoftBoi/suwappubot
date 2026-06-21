import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useAuth } from '../../contexts/AuthContext'

// Non-custodial sign-in. RainbowKit handles the connect step (MetaMask,
// WalletConnect, Coinbase, …); once a wallet is connected we prove ownership by
// signing a SIWE challenge (signInWithWallet). Google OAuth stays as a fallback
// for users without a browser wallet.
export function WalletConnect() {
  const { signInWithWallet, signInWithGoogle, isLoading } = useAuth()

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
                className="w-full py-3 text-base font-semibold rounded transition-colors
                           bg-sakura-600 hover:bg-sakura-500 text-white"
              >
                Connect Wallet
              </button>
            )
          }
          return (
            <button
              onClick={() => void signInWithWallet()}
              disabled={isLoading}
              type="button"
              className="w-full py-3 text-base font-semibold rounded transition-colors
                         bg-sakura-600 hover:bg-sakura-500 text-white disabled:opacity-50"
            >
              {isLoading ? 'Check your wallet…' : `Sign in as ${account.displayName}`}
            </button>
          )
        }}
      </ConnectButton.Custom>

      <button
        onClick={signInWithGoogle}
        type="button"
        className="text-xs text-terminal-text-secondary hover:text-terminal-text-primary
                   transition-colors text-center"
      >
        or continue with Google
      </button>
    </div>
  )
}
