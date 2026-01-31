/**
 * Authentication types for Suwappu
 * Extracted from webapp/src/types/auth.ts for cross-platform use
 */

export type AuthMethod = 'telegram' | 'wallet' | 'passkey' | 'oauth' | null

export interface TelegramUser {
  id: number
  first_name: string
  last_name?: string
  username?: string
  language_code?: string
  photo_url?: string
  is_premium?: boolean
}

export interface AuthChallenge {
  challenge: string
  nonce: string
  expiresAt: string
}

export interface AuthUser {
  id: number
  telegramId?: number
  address?: string
  username?: string
  firstName?: string
  lastName?: string
}

export interface AuthSession {
  success: boolean
  token: string
  user: AuthUser | null
  expiresAt: string
}

export interface AuthStatus {
  authenticated: boolean
  address?: string
  userId?: number
  telegramId?: number
  authMethod?: AuthMethod
}

export interface PasskeyRegistration {
  success: boolean
  userId: number
  walletAddress: string
  subOrgId: string
  error?: string
}

export interface PasskeyAuthResult {
  success: boolean
  token: string
  userId: number
  walletAddress: string
  expiresAt: string
  error?: string
}

export interface LinkedWallet {
  address: string
  chainType: 'evm' | 'solana'
  linkedAt: string
  provider: 'local' | 'turnkey' | 'external'
  name?: string
}

export interface LinkWalletRequest {
  address: string
  signature: string
  nonce: string
}

export interface LinkWalletResponse {
  success: boolean
  walletAddress?: string
  message?: string
}

export interface RegistrationInitResponse {
  challenge: string
  userId: string
  userName: string
  rpId: string
  rpName: string
  attestation: 'none' | 'indirect' | 'direct'
}

export interface AuthenticationInitResponse {
  challenge: string
  rpId: string
  allowCredentials?: {
    id: string
    type: 'public-key'
  }[]
}
