const TOKEN_KEY = 'suwappu_terminal_token'
const TOKEN_EXPIRY_KEY = 'suwappu_terminal_expiry'
// Which path minted the active session ('wallet' | 'passkey' | 'telegram' |
// 'oauth'). Lets signOut() know whether it also needs to tear down a connected
// wagmi wallet (only the 'wallet' path holds a live wagmi connection).
const AUTH_METHOD_KEY = 'suwappu_terminal_auth_method'

export type AuthMethod = 'wallet' | 'passkey' | 'telegram' | 'oauth'

export function setAuthToken(token: string, expiresAt: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token)
    localStorage.setItem(TOKEN_EXPIRY_KEY, expiresAt)
  } catch (e) {
    console.error('Failed to store auth token:', e)
  }
}

export function getAuthToken(): string | null {
  try {
    const token = localStorage.getItem(TOKEN_KEY)
    const expiry = localStorage.getItem(TOKEN_EXPIRY_KEY)
    if (!token || !expiry) return null
    if (new Date(expiry) < new Date()) {
      clearAuthToken()
      return null
    }
    return token
  } catch {
    return null
  }
}

export function clearAuthToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(TOKEN_EXPIRY_KEY)
    localStorage.removeItem(AUTH_METHOD_KEY)
  } catch (e) {
    console.error('Failed to clear auth token:', e)
  }
}

export function setAuthMethod(method: AuthMethod): void {
  try {
    localStorage.setItem(AUTH_METHOD_KEY, method)
  } catch {
    // Non-critical: signOut just won't auto-disconnect the wagmi wallet.
  }
}

export function getAuthMethod(): AuthMethod | null {
  try {
    return (localStorage.getItem(AUTH_METHOD_KEY) as AuthMethod | null) || null
  } catch {
    return null
  }
}

export function hasValidSession(): boolean {
  return getAuthToken() !== null
}
