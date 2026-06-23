/**
 * Typed wrappers over chrome.storage.session (in-memory, cleared on browser close).
 *
 * Stores the unlocked vault key (as base64 to survive JSON serialization)
 * and generic approval/state data while the extension is running.
 *
 * NOTE: chrome.storage.session access level must be set to TRUSTED_CONTEXTS
 * so the popup can read/write. See background/index.ts.
 */

import { STORAGE_SESSION } from "@/shared/constants";
import { bytesToB64, b64ToBytes } from "@/background/keyring/webauthn-prf";

/**
 * Retrieve the unlocked symmetric vault key from session storage.
 *
 * The key is stored as a base64 string and converted back to Uint8Array on retrieval.
 *
 * @returns Promise<Uint8Array | null> The unlocked key if present, null if locked or not yet unlocked
 */
export async function getUnlockedKey(): Promise<Uint8Array | null> {
  const result = await chrome.storage.session.get(STORAGE_SESSION.UNLOCKED_KEY);
  const b64 = result[STORAGE_SESSION.UNLOCKED_KEY];
  if (!b64) return null;
  return b64ToBytes(b64);
}

/**
 * Store the unlocked symmetric vault key to session storage.
 *
 * Converts the Uint8Array to base64 for storage. The session storage
 * is cleared when the browser closes, auto-locking the wallet.
 *
 * @param key The 32-byte vault key to store
 * @returns Promise<void>
 */
export async function setUnlockedKey(key: Uint8Array): Promise<void> {
  const b64 = bytesToB64(key);
  await chrome.storage.session.set({ [STORAGE_SESSION.UNLOCKED_KEY]: b64 });
}

/**
 * Clear the unlocked vault key from session storage, locking the wallet.
 *
 * @returns Promise<void>
 */
export async function clearUnlockedKey(): Promise<void> {
  await chrome.storage.session.remove(STORAGE_SESSION.UNLOCKED_KEY);
}

/**
 * Generic session storage getter: retrieve any JSON-serializable value by key.
 *
 * Used by the approval queue to persist pending requests during SW restarts.
 *
 * @param key The storage key
 * @returns Promise<T | null> The stored value if present, null otherwise
 */
export async function getSession<T>(key: string): Promise<T | null> {
  const result = await chrome.storage.session.get(key);
  return result[key] ?? null;
}

/**
 * Generic session storage setter: store any JSON-serializable value by key.
 *
 * @param key The storage key
 * @param value The value to store
 * @returns Promise<void>
 */
export async function setSession<T>(key: string, value: T): Promise<void> {
  await chrome.storage.session.set({ [key]: value });
}
