/**
 * AES-GCM vault for encrypting the mnemonic at rest.
 *
 * Uses WebCrypto's AES-GCM with a fresh 12-byte IV per seal.
 * The vault is stored as JSON with base64-encoded iv and ciphertext.
 */

import { RpcError, RPC_ERROR_CODES } from "@/shared/rpc-errors";
import { bytesToB64, b64ToBytes } from "./webauthn-prf";

export interface EncryptedVault {
  /** Base64-encoded 12-byte IV */
  iv: string;
  /** Base64-encoded AES-GCM ciphertext */
  ciphertext: string;
  /** Vault format version */
  v: number;
}

/**
 * Seal a secret (mnemonic) into an encrypted vault.
 *
 * @param secret Object containing mnemonic string
 * @param key 32-byte AES-GCM key (from deriveVaultKey)
 * @returns Promise resolving to EncryptedVault
 */
export async function sealVault(
  secret: { mnemonic: string },
  key: Uint8Array
): Promise<EncryptedVault> {
  // Generate a fresh random 12-byte IV
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);

  // Import the key for WebCrypto (convert Uint8Array to ArrayBuffer)
  const keyBuffer = key.buffer.slice(key.byteOffset, key.byteOffset + key.byteLength);
  const cryptoKey = await crypto.subtle.importKey("raw", keyBuffer as ArrayBuffer, "AES-GCM", false, [
    "encrypt",
  ]);

  // Serialize the secret as JSON and encode as UTF-8
  const plaintext = new TextEncoder().encode(JSON.stringify(secret));

  // Encrypt with AES-GCM
  const ivBuffer = iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength) as ArrayBuffer;
  const ptBuffer = plaintext.buffer.slice(plaintext.byteOffset, plaintext.byteOffset + plaintext.byteLength) as ArrayBuffer;
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: ivBuffer },
    cryptoKey,
    ptBuffer
  );

  return {
    iv: bytesToB64(iv),
    ciphertext: bytesToB64(new Uint8Array(ciphertext)),
    v: 1,
  };
}

/**
 * Open an encrypted vault and extract the secret.
 *
 * @param vault EncryptedVault to decrypt
 * @param key 32-byte AES-GCM key (from deriveVaultKey)
 * @returns Promise resolving to { mnemonic }
 * @throws RpcError(WALLET_LOCKED) if decryption fails
 */
export async function openVault(
  vault: EncryptedVault,
  key: Uint8Array
): Promise<{ mnemonic: string }> {
  try {
    // Decode IV and ciphertext from base64
    const iv = b64ToBytes(vault.iv);
    const ciphertextBytes = b64ToBytes(vault.ciphertext);

    // Import the key for WebCrypto (convert Uint8Array to ArrayBuffer)
    const keyBuffer = key.buffer.slice(key.byteOffset, key.byteOffset + key.byteLength);
    const cryptoKey = await crypto.subtle.importKey("raw", keyBuffer as ArrayBuffer, "AES-GCM", false, [
      "decrypt",
    ]);

    // Decrypt with AES-GCM
    const ivBuffer = iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength) as ArrayBuffer;
    const ctBuffer = ciphertextBytes.buffer.slice(
      ciphertextBytes.byteOffset,
      ciphertextBytes.byteOffset + ciphertextBytes.byteLength
    ) as ArrayBuffer;
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: ivBuffer },
      cryptoKey,
      ctBuffer
    );

    // Decode UTF-8 and parse JSON
    const secretJson = new TextDecoder().decode(plaintext);
    const secret = JSON.parse(secretJson);

    // Validate structure
    if (typeof secret.mnemonic !== "string") {
      throw new Error("Invalid vault: mnemonic not a string");
    }

    return { mnemonic: secret.mnemonic };
  } catch (err) {
    // Any decryption failure → wallet locked error
    throw new RpcError(RPC_ERROR_CODES.WALLET_LOCKED, "Vault decryption failed");
  }
}
