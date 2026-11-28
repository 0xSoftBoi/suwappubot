/** Signed Telegram WebApp initData, or '' outside Telegram. Bank APIs authenticate with this only. */
export function telegramInitData(): string {
  return (typeof window !== 'undefined' && window.Telegram?.WebApp?.initData) || ''
}

/** True when bank calls can authenticate: inside Telegram, or on localhost where the API's dev bypass applies. */
export function hasBankCredential(): boolean {
  if (telegramInitData().length > 0) return true
  return typeof window !== 'undefined' && window.location.hostname === 'localhost'
}
