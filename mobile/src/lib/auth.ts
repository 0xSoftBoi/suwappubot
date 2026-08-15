/**
 * Auth token storage.
 *
 * Gecko only accepts the session JWT used by the native-safe API surface.
 * Native storage uses expo-secure-store, which maps to the iOS Keychain and
 * Android Keystore and is not readable by other apps.
 *
 * Reads are cached in memory because SecureStore *is* a real async bridge call
 * — we do not want one on the hot path of every request.
 */
import * as SecureStore from 'expo-secure-store'

const TOKEN_KEY = 'suwappu.jwt'

let cachedToken: string | null | undefined
let authRevision = 0

export async function loadAuth(): Promise<void> {
  cachedToken = await SecureStore.getItemAsync(TOKEN_KEY)
}

/** Synchronous read for the request path. Returns null until loadAuth() runs. */
export function getAuthToken(): string | null {
  return cachedToken ?? null
}

/** Non-secret cache namespace. Changes whenever the signed-in session changes. */
export function getAuthRevision(): number {
  return authRevision
}

export async function setAuthToken(token: string | null): Promise<void> {
  const changed = cachedToken !== undefined && cachedToken !== token
  if (token === null) await SecureStore.deleteItemAsync(TOKEN_KEY)
  else await SecureStore.setItemAsync(TOKEN_KEY, token)

  // Persist first, then expose the new in-memory session and namespace in one
  // synchronous step. Requests can never observe token B with token A's cache
  // revision (or vice versa).
  cachedToken = token
  if (changed) {
    authRevision += 1
    // These modules depend on auth.ts, so load them lazily to avoid a module
    // cycle. Clearing both layers prevents user A's persisted snapshot or an
    // in-flight GET from being reused after switching to user B.
    const [{ queryClient, persister }, { clearHttpCache }] = await Promise.all([
      import('./queryClient'),
      import('./api'),
    ])
    queryClient.clear()
    await persister.removeClient()
    clearHttpCache()
  }
}

export function isAuthenticated(): boolean {
  return Boolean(cachedToken)
}

export async function signOut(): Promise<void> {
  await setAuthToken(null)
}
