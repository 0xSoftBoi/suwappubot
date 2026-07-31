/**
 * Auth token storage.
 *
 * The webapp keeps its JWT in localStorage because it runs inside Telegram's
 * webview and has no better option. Native does: expo-secure-store maps to the
 * iOS Keychain and Android Keystore, so the token survives reinstall-scoped
 * backups correctly and is not readable by other apps.
 *
 * Reads are cached in memory because SecureStore *is* a real async bridge call
 * — we do not want one on the hot path of every request.
 */
import * as SecureStore from 'expo-secure-store'

const TOKEN_KEY = 'suwappu.jwt'
const TELEGRAM_KEY = 'suwappu.telegram_init_data'

let cachedToken: string | null | undefined
let cachedInitData: string | null | undefined

export async function loadAuth(): Promise<void> {
  const [token, initData] = await Promise.all([
    SecureStore.getItemAsync(TOKEN_KEY),
    SecureStore.getItemAsync(TELEGRAM_KEY),
  ])
  cachedToken = token
  cachedInitData = initData
}

/** Synchronous read for the request path. Returns null until loadAuth() runs. */
export function getAuthToken(): string | null {
  return cachedToken ?? null
}

export function getInitData(): string | null {
  return cachedInitData ?? null
}

export async function setAuthToken(token: string | null): Promise<void> {
  cachedToken = token
  if (token === null) await SecureStore.deleteItemAsync(TOKEN_KEY)
  else await SecureStore.setItemAsync(TOKEN_KEY, token)
}

export async function setInitData(initData: string | null): Promise<void> {
  cachedInitData = initData
  if (initData === null) await SecureStore.deleteItemAsync(TELEGRAM_KEY)
  else await SecureStore.setItemAsync(TELEGRAM_KEY, initData)
}

export function isAuthenticated(): boolean {
  return Boolean(cachedToken || cachedInitData)
}

export async function signOut(): Promise<void> {
  await Promise.all([setAuthToken(null), setInitData(null)])
}
