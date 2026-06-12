/**
 * Authentication types for Suwappu webapp
 */

// Auth methods supported
export type AuthMethod = 'telegram' | 'wallet' | 'passkey' | 'oauth' | null

// Telegram user from initData
export interface TelegramUser {
  id: number
  first_name: string
  last_name?: string
  username?: string
  language_code?: string
  photo_url?: string
  is_premium?: boolean
}

// Turnkey auth challenge
export interface AuthChallenge {
  challenge: string
  nonce: string
  expiresAt: string
}

// Authenticated user
export interface AuthUser {
  id: number
  telegramId?: number
  address?: string
  username?: string
  firstName?: string
  lastName?: string
}

// Auth session from JWT
export interface AuthSession {
  success: boolean
  token: string
  user: AuthUser | null
  expiresAt: string
}

// Auth status check response
export interface AuthStatus {
  authenticated: boolean
  address?: string
  userId?: number
  telegramId?: number
  authMethod?: AuthMethod
}

// Passkey registration result
export interface PasskeyRegistration {
  success: boolean
  userId: number
  walletAddress: string
  subOrgId: string
  error?: string
}

// Passkey auth result
export interface PasskeyAuthResult {
  success: boolean
  token: string
  userId: number
  walletAddress: string
  expiresAt: string
  error?: string
}

// Linked wallet info
export interface LinkedWallet {
  address: string
  chainType: 'evm' | 'solana'
  linkedAt: string
  provider: 'local' | 'turnkey' | 'external'
  name?: string
}

// Wallet link request
export interface LinkWalletRequest {
  address: string
  signature: string
  nonce: string
}

// Wallet link response
export interface LinkWalletResponse {
  success: boolean
  walletAddress?: string
  message?: string
}

// Registration init response from backend
export interface RegistrationInitResponse {
  challenge: string
  userId: string
  userName: string
  rpId: string
  rpName: string
  attestation: 'none' | 'indirect' | 'direct'
}

// Authentication init response from backend
export interface AuthenticationInitResponse {
  challenge: string
  rpId: string
  allowCredentials?: {
    id: string
    type: 'public-key'
  }[]
}
