const TOKEN_KEY = 'suwappu_terminal_token'
const TOKEN_EXPIRY_KEY = 'suwappu_terminal_expiry'

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
  } catch (e) {
    console.error('Failed to clear auth token:', e)
  }
}

export function hasValidSession(): boolean {
  return getAuthToken() !== null
}
