// Data fetching hooks
export { usePortfolio } from './usePortfolio'
export { useSwapHistory, useSwap } from './useSwapHistory'
export { useTokenPrices, useTokenPrice, type TokenPrice } from './useTokenPrices'
export { useLinkedWallets, useLinkWallet, useUnlinkWallet, useWalletChallenge } from './useLinkedWallets'
export { useQuote, useTokens, formatTokenAmount } from './useQuote'
export type { QuoteResponse, TokenListResponse } from '../lib/api'

// Auth hooks
export { useAuth } from './useAuth'
export { useTelegram } from './useTelegram'
export {
  useAuthSession,
  useAuthState,
  usePasskeySupport,
  useAuthLinkedWallets,
  useAuthTurnkeyWallets,
  usePasskeyRegister,
  usePasskeyAuthenticate,
  useCreateTurnkeyWallet,
  useLogout,
  authKeys,
  type AuthSession,
} from './useAuthQuery'

// Wallet hooks
export { useWalletConnection } from './useWalletConnection'
export { usePasskey } from './usePasskey'
