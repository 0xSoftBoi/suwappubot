/**
 * Turnkey SDK client singleton for browser-based passkey authentication.
 *
 * Uses the Turnkey Auth Proxy which handles sub-org creation, passkey registration,
 * and wallet creation server-side with minimal client code.
 */

import { Turnkey, TurnkeyIndexedDbClient } from "@turnkey/sdk-browser";

// Validate required environment variables
const orgId = import.meta.env.VITE_TURNKEY_ORG_ID;
const proxyUrl = import.meta.env.VITE_TURNKEY_PROXY_URL || "https://api.turnkey.com";
const rpId = import.meta.env.VITE_TURNKEY_RP_ID || window.location.hostname;

if (!orgId) {
  console.warn("VITE_TURNKEY_ORG_ID is not set - Turnkey auth will not work");
}

/**
 * Turnkey SDK instance configured for Auth Proxy.
 * Auth Proxy handles server-side operations (sub-org creation, wallet creation)
 * while the browser handles WebAuthn passkey operations.
 */
export const turnkey = new Turnkey({
  apiBaseUrl: proxyUrl,
  defaultOrganizationId: orgId || "",
  rpId,
});

/**
 * Passkey client for creating passkeys.
 * Handles WebAuthn credential creation.
 */
export const passkeyClient = turnkey.passkeyClient();

/**
 * IndexedDB client singleton for passkey login.
 * Handles WebAuthn assertion and session management.
 */
let _indexedDbClient: TurnkeyIndexedDbClient | null = null;

export async function getIndexedDbClient(): Promise<TurnkeyIndexedDbClient> {
  if (!_indexedDbClient) {
    _indexedDbClient = await turnkey.indexedDbClient();
  }
  return _indexedDbClient;
}

/**
 * Check if Turnkey is properly configured
 */
export function isTurnkeyConfigured(): boolean {
  return Boolean(orgId);
}

/**
 * Get the current Turnkey session (if any).
 * Returns null if not authenticated.
 */
export async function getCurrentSession() {
  try {
    const session = await turnkey.getSession();
    return session || null;
  } catch {
    return null;
  }
}

/**
 * Logout from Turnkey and clear session data.
 */
export async function logoutTurnkey(): Promise<boolean> {
  try {
    return await turnkey.logout();
  } catch {
    return false;
  }
}
