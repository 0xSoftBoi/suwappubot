/**
 * Authentication token storage and management utilities
 */

const TOKEN_KEY = 'suwappu_auth_token'
const TOKEN_EXPIRY_KEY = 'suwappu_auth_expiry'
const AUTH_METHOD_KEY = 'suwappu_auth_method'

export type StoredAuthMethod = 'telegram' | 'wallet' | 'passkey'

/**
 * Store authentication token in localStorage
 */
export function setAuthToken(token: string, expiresAt: string): void {
  if (typeof window === 'undefined') return

  try {
    localStorage.setItem(TOKEN_KEY, token)
    localStorage.setItem(TOKEN_EXPIRY_KEY, expiresAt)
  } catch (e) {
    console.error('Failed to store auth token:', e)
  }
}

/**
 * Get stored authentication token
 */
export function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null

  try {
    const token = localStorage.getItem(TOKEN_KEY)
    const expiry = localStorage.getItem(TOKEN_EXPIRY_KEY)

    if (!token || !expiry) return null

    // Check if expired
    if (new Date(expiry) < new Date()) {
      clearAuthToken()
      return null
    }

    return token
  } catch (e) {
    console.error('Failed to get auth token:', e)
    return null
  }
}

/**
 * Clear authentication token
 */
export function clearAuthToken(): void {
  if (typeof window === 'undefined') return

  try {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(TOKEN_EXPIRY_KEY)
    localStorage.removeItem(AUTH_METHOD_KEY)
  } catch (e) {
    console.error('Failed to clear auth token:', e)
  }
}

/**
 * Store the auth method used
 */
export function setAuthMethod(method: StoredAuthMethod): void {
  if (typeof window === 'undefined') return

  try {
    localStorage.setItem(AUTH_METHOD_KEY, method)
  } catch (e) {
    console.error('Failed to store auth method:', e)
  }
}

/**
 * Get stored auth method
 */
export function getAuthMethod(): StoredAuthMethod | null {
  if (typeof window === 'undefined') return null

  try {
    return localStorage.getItem(AUTH_METHOD_KEY) as StoredAuthMethod | null
  } catch (e) {
    console.error('Failed to get auth method:', e)
    return null
  }
}

/**
 * Check if user has a valid stored session
 */
export function hasValidSession(): boolean {
  return getAuthToken() !== null
}

/**
 * Get token expiry time
 */
export function getTokenExpiry(): Date | null {
  if (typeof window === 'undefined') return null

  try {
    const expiry = localStorage.getItem(TOKEN_EXPIRY_KEY)
    return expiry ? new Date(expiry) : null
  } catch (e) {
    return null
  }
}

/**
 * Check if token will expire soon (within 5 minutes)
 */
export function isTokenExpiringSoon(): boolean {
  const expiry = getTokenExpiry()
  if (!expiry) return false

  const fiveMinutesFromNow = new Date(Date.now() + 5 * 60 * 1000)
  return expiry < fiveMinutesFromNow
}

/**
 * Schedule a token refresh before expiry.
 * Returns a timer ID that can be cleared if needed.
 */
export function scheduleTokenRefresh(
  refreshFn: () => Promise<{ token: string; expiresAt: string } | null>
): ReturnType<typeof setTimeout> | null {
  const expiry = getTokenExpiry()
  if (!expiry) return null

  // Refresh 2 minutes before expiry
  const refreshAt = expiry.getTime() - 2 * 60 * 1000
  const delay = refreshAt - Date.now()

  if (delay <= 0) {
    // Already expired or about to expire, refresh immediately
    refreshFn().then((result) => {
      if (result) {
        setAuthToken(result.token, result.expiresAt)
      } else {
        clearAuthToken()
      }
    }).catch(() => {
      clearAuthToken()
    })
    return null
  }

  return setTimeout(async () => {
    try {
      const result = await refreshFn()
      if (result) {
        setAuthToken(result.token, result.expiresAt)
        // Schedule the next refresh
        scheduleTokenRefresh(refreshFn)
      } else {
        clearAuthToken()
      }
    } catch {
      clearAuthToken()
    }
  }, delay)
}

const WALLET_ADDRESS_KEY = 'suwappu_wallet_address'

/**
 * Store wallet address
 */
export function setWalletAddress(address: string): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(WALLET_ADDRESS_KEY, address)
  } catch (e) {
    console.error('Failed to store wallet address:', e)
  }
}

/**
 * Get stored wallet address
 */
export function getWalletAddress(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return localStorage.getItem(WALLET_ADDRESS_KEY)
  } catch (e) {
    console.error('Failed to get wallet address:', e)
    return null
  }
}
