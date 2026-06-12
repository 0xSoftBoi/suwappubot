import { webcrypto } from 'node:crypto';
import type { EncryptedData } from '../types';

/**
 * Encryption/decryption with two modes:
 *
 * Mode 1 (version 1, default): Password-based — PBKDF2 + AES-GCM.
 *   Used for export/import (user provides a backup password).
 *
 * Mode 2 (version 2): Raw key — AES-GCM with a 256-bit key directly.
 *   Used for routine vault encryption with device key.
 *   No PBKDF2 needed because the key is already high-entropy.
 *
 * Extension reference: src/utils/passworder.ts
 */

const ITERATIONS = 600_000; // OWASP 2023 minimum for PBKDF2-HMAC-SHA256
const KEY_LENGTH = 256;
const ALGORITHM = 'AES-GCM';

const subtle = webcrypto.subtle;

// ─── Mode 1: Password-based (PBKDF2) ──────────────────────────────

async function deriveKey(password: string, salt: Uint8Array): Promise<webcrypto.CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveKey',
  ]);

  return subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: ALGORITHM, length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Encrypt data with a user password (PBKDF2 + AES-GCM). */
export async function encrypt<T>(password: string, data: T): Promise<EncryptedData> {
  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);

  const encoder = new TextEncoder();
  const plaintext = encoder.encode(JSON.stringify(data));

  const ciphertext = await subtle.encrypt({ name: ALGORITHM, iv }, key, plaintext);

  return {
    data: toHex(ciphertext),
    iv: toHex(iv),
    salt: toHex(salt),
    version: 1,
  };
}

/** Decrypt data with a user password (PBKDF2 + AES-GCM). */
export async function decrypt<T>(password: string, encrypted: EncryptedData): Promise<T> {
  if (encrypted.version === 2) {
    throw new Error(
      'decrypt() expects a password-encrypted (v1) blob; got v2. Use decryptWithKey() instead.',
    );
  }
  if (!encrypted.salt) {
    throw new Error(
      'Version 1 blob is missing the salt field. The backup may be corrupted or is a v2 blob.',
    );
  }
  const salt = fromHex(encrypted.salt);
  const iv = fromHex(encrypted.iv);
  const ciphertext = fromHex(encrypted.data);
  const key = await deriveKey(password, salt);

  const plaintext = await subtle.decrypt({ name: ALGORITHM, iv }, key, ciphertext);

  const decoder = new TextDecoder();
  return JSON.parse(decoder.decode(plaintext)) as T;
}

// ─── Mode 2: Raw key (device key) ──────────────────────────────────

async function importRawKey(rawKey: Uint8Array): Promise<webcrypto.CryptoKey> {
  return subtle.importKey('raw', rawKey, { name: ALGORITHM, length: KEY_LENGTH }, false, [
    'encrypt',
    'decrypt',
  ]);
}

/** Encrypt data with a raw 256-bit key (AES-GCM, no PBKDF2). */
export async function encryptWithKey<T>(rawKey: Uint8Array, data: T): Promise<EncryptedData> {
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const key = await importRawKey(rawKey);

  const encoder = new TextEncoder();
  const plaintext = encoder.encode(JSON.stringify(data));

  const ciphertext = await subtle.encrypt({ name: ALGORITHM, iv }, key, plaintext);

  return {
    data: toHex(ciphertext),
    iv: toHex(iv),
    // No salt field for v2 — raw key blobs don't use PBKDF2
    version: 2,
  };
}

/** Decrypt data with a raw 256-bit key (AES-GCM, no PBKDF2). */
export async function decryptWithKey<T>(rawKey: Uint8Array, encrypted: EncryptedData): Promise<T> {
  if (encrypted.version === 1) {
    throw new Error(
      'decryptWithKey() expects a key-encrypted (v2) blob; got v1. Use decrypt() instead.',
    );
  }
  const iv = fromHex(encrypted.iv);
  const ciphertext = fromHex(encrypted.data);
  const key = await importRawKey(rawKey);

  const plaintext = await subtle.decrypt({ name: ALGORITHM, iv }, key, ciphertext);

  const decoder = new TextDecoder();
  return JSON.parse(decoder.decode(plaintext)) as T;
}

// ─── Helpers ────────────────────────────────────────────────────────

function toHex(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return Buffer.from(bytes).toString('hex');
}

function fromHex(hex: string): Uint8Array {
  return new Uint8Array(Buffer.from(hex, 'hex'));
}
