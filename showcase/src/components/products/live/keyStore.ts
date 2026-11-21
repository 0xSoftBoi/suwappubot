'use client';

import { useSyncExternalStore } from 'react';
import { API_BASE_URL } from '@/lib/links';
import { seal, unseal } from './vault';

/**
 * One browser-side store for the visitor's own agent key, shared by every
 * product widget and /start. Encrypted at rest (vault.ts): sessionStorage by
 * default; localStorage only when the visitor ticks "Remember on this device". The key is never logged, never
 * put in a URL, never sent to analytics; it only leaves as
 * `Authorization: Bearer` to the API (see api.ts).
 */
const STORE_KEY = 'suwappu_agent_key';
export const KEY_RE = /^suwappu_sk_[A-Za-z0-9_-]{12,}$/;

export type KeyState = {
  hydrated: boolean;
  key: string | null;
  remember: boolean;
  /** Live credit balance from GET /v1/agent/billing (0 credits). */
  balance: number | null;
  balanceError: string | null;
};

const SERVER: KeyState = { hydrated: false, key: null, remember: false, balance: null, balanceError: null };
let state: KeyState = SERVER;
let started = false;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const set = (patch: Partial<KeyState>) => { state = { ...state, ...patch }; emit(); };

function hydrate() {
  if (started || typeof window === 'undefined') return;
  started = true;
  void (async () => {
    let key: string | null = null;
    let remember = false;
    try {
      key = await unseal(sessionStorage.getItem(STORE_KEY));
      if (!key) { key = await unseal(localStorage.getItem(STORE_KEY)); remember = Boolean(key); }
    } catch { /* storage blocked: key lives in memory only */ }
    if (key && !KEY_RE.test(key)) key = null;
    // A key set while we were reading storage wins over the stored one.
    if (state.key) { set({ hydrated: true }); return; }
    set({ hydrated: true, key, remember });
    if (key) void refreshBalance();
  })();
}

/** Storage only ever receives ciphertext (see vault.ts). If sealing fails the key stays in memory. */
function persist() {
  const { key, remember } = state;
  void (async () => {
    const sealed = key ? await seal(key) : null;
    if (state.key !== key || state.remember !== remember) return; // superseded
    try {
      sessionStorage.removeItem(STORE_KEY);
      localStorage.removeItem(STORE_KEY);
      if (sealed) (remember ? localStorage : sessionStorage).setItem(STORE_KEY, sealed);
    } catch { /* in-memory only */ }
  })();
}

export function setStoredKey(key: string, remember = state.remember) {
  hydrate();
  state = { ...state, hydrated: true, key, remember, balance: null, balanceError: null };
  persist();
  emit();
  void refreshBalance();
}
export function setRemember(remember: boolean) {
  state = { ...state, remember };
  persist();
  emit();
}
export function forgetKey() {
  state = { ...state, key: null, balance: null, balanceError: null };
  persist();
  emit();
}
export function getStoredKey(): string | null { hydrate(); return state.key; }

/** Cheap (0-credit) balance read. The metering headers are not CORS-exposed, so /billing is the source. */
let balInflight: Promise<void> | null = null;
export function refreshBalance(): Promise<void> {
  if (!state.key) return Promise.resolve();
  return (balInflight ??= doRefresh().finally(() => { balInflight = null; }));
}
async function doRefresh(): Promise<void> {
  const key = state.key;
  if (!key) return;
  try {
    const res = await fetch(`${API_BASE_URL}/v1/agent/billing`, {
      headers: { Authorization: `Bearer ${key}` }, credentials: 'omit',
    });
    const data = await res.json().catch(() => null);
    if (key !== state.key) return;
    if (res.ok && typeof data?.credits?.balance === 'number') set({ balance: data.credits.balance, balanceError: null });
    else set({ balance: null, balanceError: res.status === 401 ? 'Key rejected (401)' : `Balance unavailable (${res.status})` });
  } catch {
    if (key === state.key) set({ balance: null, balanceError: 'Balance unavailable (network)' });
  }
}

function subscribe(fn: () => void) {
  subs.add(fn);
  hydrate();
  fn();
  return () => { subs.delete(fn); };
}

export function useApiKey() {
  const s = useSyncExternalStore(subscribe, () => state, () => SERVER);
  return { ...s, setKey: setStoredKey, setRemember, forget: forgetKey, refreshBalance };
}

export const maskKey = (k: string) => `${k.slice(0, 11)}…${k.slice(-4)}`;

/** Positive decimal in human units. Length-capped and linear-time (no nested quantifiers). */
export function isAmount(v: string): boolean {
  const t = v.trim();
  return t.length > 0 && t.length <= 40 && /^(?:[0-9]+(?:[.][0-9]+)?|[.][0-9]+)$/.test(t) && Number(t) > 0;
}
