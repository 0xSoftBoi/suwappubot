/**
 * WebAuthn PRF output processing.
 *
 * Takes the raw PRF output from WebAuthn and derives a symmetric vault key via HKDF-SHA256.
 * The PRF itself (navigator.credentials.get with PRF extension) runs in the popup;
 * this module handles the derivation without ever touching the raw credential.
 */

import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { PRF_SALT } from "@/shared/constants";

/**
 * Derive a 32-byte AES-GCM key from WebAuthn PRF output using HKDF-SHA256.
 *
 * @param prfOutput Raw PRF bytes from WebAuthn
 * @returns Promise resolving to a 32-byte Uint8Array suitable for AES-GCM
 */
export async function deriveVaultKey(prfOutput: Uint8Array): Promise<Uint8Array> {
  const info = new TextEncoder().encode("suwappu-vault-key-v1");
  const key = hkdf(sha256, prfOutput, PRF_SALT, info, 32);
  return new Uint8Array(key);
}

/**
 * Encode bytes to standard base64 (no padding issues with split lines).
 */
export function bytesToB64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

/**
 * Decode standard base64 to bytes.
 */
export function b64ToBytes(b64: string): Uint8Array {
  const binaryString = atob(b64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}
