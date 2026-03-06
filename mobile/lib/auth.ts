/**
 * Authentication token storage for React Native.
 *
 * Uses expo-secure-store (iOS Keychain / Android Keystore) for
 * sensitive data. Keeps an in-memory cache so getAuthToken() is synchronous,
 * which the API client needs for building request headers.
 */
import * as SecureStore from 'expo-secure-store'

const TOKEN_KEY = 'suwappu_auth_token'
const TOKEN_EXPIRY_KEY = 'suwappu_auth_expiry'
const AUTH_METHOD_KEY = 'suwappu_auth_method'
const WALLET_ADDRESS_KEY = 'suwappu_wallet_address'

// In-memory cache so getAuthToken() can be called synchronously
let cachedToken: string | null = null
let cachedExpiry: string | null = null
let cachedMethod: string | null = null
let cachedWalletAddress: string | null = null

/**
 * Persist a JWT token along with metadata.
 * Call this after successful passkey/OAuth authentication.
 */
export async function saveAuthToken(
  token: string,
  expiresAt: string,
  method: 'passkey' | 'oauth' | 'telegram',
  walletAddress?: string,
): Promise<void> {
  try {
    await SecureStore.setItemAsync(TOKEN_KEY, token)
    await SecureStore.setItemAsync(TOKEN_EXPIRY_KEY, expiresAt)
    await SecureStore.setItemAsync(AUTH_METHOD_KEY, method)
    if (walletAddress) {
      await SecureStore.setItemAsync(WALLET_ADDRESS_KEY, walletAddress)
    }

    // Update in-memory cache
    cachedToken = token
    cachedExpiry = expiresAt
    cachedMethod = method
    if (walletAddress) {
      cachedWalletAddress = walletAddress
    }
  } catch (e) {
    console.error('Failed to save auth token:', e)
  }
}

/**
 * Load token from SecureStore into memory cache on app startup.
 * Returns the token if valid, or null if missing/expired.
 */
export async function loadAuthToken(): Promise<string | null> {
  try {
    const token = await SecureStore.getItemAsync(TOKEN_KEY)
    const expiry = await SecureStore.getItemAsync(TOKEN_EXPIRY_KEY)
    const method = await SecureStore.getItemAsync(AUTH_METHOD_KEY)
    const wallet = await SecureStore.getItemAsync(WALLET_ADDRESS_KEY)

    if (!token || !expiry) {
      return null
    }

    // Check if expired
    if (new Date(expiry) < new Date()) {
      await clearAuthToken()
      return null
    }

    // Populate in-memory cache
    cachedToken = token
    cachedExpiry = expiry
    cachedMethod = method
    cachedWalletAddress = wallet

    return token
  } catch (e) {
    console.error('Failed to load auth token:', e)
    return null
  }
}

/**
 * Remove all auth data from SecureStore and memory.
 */
export async function clearAuthToken(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(TOKEN_KEY)
    await SecureStore.deleteItemAsync(TOKEN_EXPIRY_KEY)
    await SecureStore.deleteItemAsync(AUTH_METHOD_KEY)
    await SecureStore.deleteItemAsync(WALLET_ADDRESS_KEY)
  } catch (e) {
    console.error('Failed to clear auth token:', e)
  }

  cachedToken = null
  cachedExpiry = null
  cachedMethod = null
  cachedWalletAddress = null
}

/**
 * Synchronously get the cached JWT token.
 * Returns null if not loaded yet or expired.
 */
export function getAuthToken(): string | null {
  if (!cachedToken || !cachedExpiry) return null

  if (new Date(cachedExpiry) < new Date()) {
    // Token expired — clear cache (fire-and-forget the async store cleanup)
    cachedToken = null
    cachedExpiry = null
    void clearAuthToken()
    return null
  }

  return cachedToken
}

/**
 * Synchronously get the cached wallet address.
 */
export function getWalletAddress(): string | null {
  return cachedWalletAddress
}

/**
 * Check if the token will expire within the next hour.
 * Useful for proactively refreshing sessions.
 */
export function isTokenExpiringSoon(): boolean {
  if (!cachedExpiry) return false
  const oneHourFromNow = new Date(Date.now() + 60 * 60 * 1000)
  return new Date(cachedExpiry) < oneHourFromNow
}
