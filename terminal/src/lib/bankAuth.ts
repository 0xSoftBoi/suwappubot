/** Signed Telegram WebApp initData, or '' outside Telegram. Bank APIs authenticate with this only. */
export function telegramInitData(): string {
  return (typeof window !== 'undefined' && window.Telegram?.WebApp?.initData) || ''
}

/** Local development hosts (same set the terminal App treats as local). */
export function isLocalHost(): boolean {
  if (typeof window === 'undefined') return false
  const h = window.location.hostname
  return h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0'
}

/** True when bank calls can authenticate: inside Telegram, or on localhost where the API's dev bypass applies. */
export function hasBankCredential(): boolean {
  if (telegramInitData().length > 0) return true
  return isLocalHost()
}
