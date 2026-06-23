import { getDefaultConfig } from '@rainbow-me/rainbowkit'
import {
  metaMaskWallet,
  coinbaseWallet,
  walletConnectWallet,
  rainbowWallet,
  injectedWallet,
} from '@rainbow-me/rainbowkit/wallets'
import { mainnet, arbitrum, optimism, polygon, base, avalanche, bsc } from 'wagmi/chains'
import { ledgerConnectKitWallet } from './ledgerConnectKit'

// A real WalletConnect project id is required for WalletConnect AND as the Ledger
// fallback transport: Ledger's Connect Kit prefers the Ledger browser Extension, but
// falls back to Ledger Live over WalletConnect, which needs a real project id (the
// 'demo' fallback can't complete that pairing). Set VITE_WC_PROJECT_ID to enable
// hardware-wallet sign-in fully.
const projectId = import.meta.env.VITE_WC_PROJECT_ID || 'demo'

export const config = getDefaultConfig({
  appName: 'Suwappu Terminal',
  projectId,
  chains: [mainnet, arbitrum, optimism, polygon, base, avalanche, bsc],
  // Explicit wallet list so the Ledger hardware wallet (via Ledger's official
  // Connect Kit — see ./ledgerConnectKit) is always offered in the connect modal
  // alongside the software wallets. Ledger is fully non-custodial: the device holds
  // the keys and signs every SIWE challenge and swap transaction itself — the same
  // client-signing build/record path MetaMask uses, so no server change is needed
  // for it to sign. We never see a private key.
  wallets: [
    {
      groupName: 'Recommended',
      wallets: [
        metaMaskWallet,
        () => ledgerConnectKitWallet({ projectId }),
        coinbaseWallet,
        walletConnectWallet,
      ],
    },
    {
      groupName: 'More',
      wallets: [rainbowWallet, injectedWallet],
    },
  ],
  ssr: false,
})
