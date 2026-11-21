'use client';

/**
 * Encrypts the visitor's key before it touches browser storage.
 *
 * The AES-GCM key is generated in the browser as NON-EXTRACTABLE and kept in
 * IndexedDB, so what sits in session/localStorage is ciphertext: reading the
 * storage value (disk, sync, another tool) does not reveal the agent key.
 * It does not defend against script running in this origin, which could ask
 * the browser to decrypt; nothing stored client-side can. If WebCrypto or
 * IndexedDB is unavailable the key simply stays in memory for this page.
 */
const DB = 'suwappu-vault';
const STORE = 'keys';
const ID = 'agent-key-wrap';

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let cached: Promise<CryptoKey> | null = null;
function wrapKey(): Promise<CryptoKey> {
  return (cached ??= (async () => {
    const db = await idb();
    const existing = await new Promise<CryptoKey | undefined>((resolve, reject) => {
      const r = db.transaction(STORE, 'readonly').objectStore(STORE).get(ID);
      r.onsuccess = () => resolve(r.result as CryptoKey | undefined);
      r.onerror = () => reject(r.error);
    });
    if (existing) return existing;
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(key, ID);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return key;
  })().catch((e) => { cached = null; throw e; }));
}

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Returns ciphertext safe to put in web storage, or null when sealing is not possible here. */
export async function seal(plain: string): Promise<string | null> {
  try {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await wrapKey(), new TextEncoder().encode(plain)));
    const out = new Uint8Array(iv.length + ct.length);
    out.set(iv); out.set(ct, iv.length);
    return `v1.${b64(out)}`;
  } catch { return null; }
}

export async function unseal(blob: string | null): Promise<string | null> {
  if (!blob || !blob.startsWith('v1.')) return null;
  try {
    const raw = unb64(blob.slice(3));
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, await wrapKey(), raw.slice(12));
    return new TextDecoder().decode(pt);
  } catch { return null; }
}
