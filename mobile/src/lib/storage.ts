/**
 * Synchronous key-value storage backed by MMKV.
 *
 * Why not AsyncStorage: AsyncStorage is a promise-based bridge call over
 * SQLite. Every read costs a serialize -> bridge -> deserialize round trip,
 * which means the first paint of any screen that needs persisted state has to
 * wait at least one frame. MMKV is memory-mapped and synchronous via JSI, so
 * reads are effectively free and can happen during render — no loading flash,
 * no `undefined` first pass.
 */
import { MMKV } from 'react-native-mmkv'

/** General app cache: query cache, preferences, last-known balances. */
export const kv = new MMKV({ id: 'suwappu.cache' })

/**
 * Encrypted store for anything user-scoped but not secret enough for the
 * Keychain (see auth.ts for real secrets). MMKV encryption is AES-backed and
 * still synchronous.
 */
export const secureKv = new MMKV({
  id: 'suwappu.secure',
  encryptionKey: 'suwappu-mmkv-v1',
})

/** JSON helpers — MMKV stores strings, these keep call sites tidy. */
export function readJson<T>(store: MMKV, key: string): T | undefined {
  const raw = store.getString(key)
  if (!raw) return undefined
  try {
    return JSON.parse(raw) as T
  } catch {
    store.delete(key)
    return undefined
  }
}

export function writeJson(store: MMKV, key: string, value: unknown): void {
  store.set(key, JSON.stringify(value))
}

/**
 * Storage adapter shaped like AsyncStorage so TanStack Query's persister can
 * use it. The methods are async in signature only — the work is synchronous.
 */
export const mmkvAsyncStorage = {
  getItem: (key: string) => Promise.resolve(kv.getString(key) ?? null),
  setItem: (key: string, value: string) => {
    kv.set(key, value)
    return Promise.resolve()
  },
  removeItem: (key: string) => {
    kv.delete(key)
    return Promise.resolve()
  },
}
