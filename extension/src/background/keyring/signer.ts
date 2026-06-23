/**
 * Signing operations from a BIP39 mnemonic.
 *
 * Builds viem accounts (EVM) and Solana keypairs from a mnemonic on the fly.
 * All functions are pure: mnemonic in, signature/address out. Secrets are never
 * persisted and never leave the service worker.
 *
 * Derivation paths (must match Phantom / MetaMask so the same seed phrase
 * resolves to the same addresses everywhere — getting this wrong loses funds):
 *   - EVM:    m/44'/60'/0'/0/0   (BIP44, secp256k1; handled by viem)
 *   - Solana: m/44'/501'/0'/0'   (SLIP-0010, ed25519, all segments hardened)
 */

import { mnemonicToAccount } from "viem/accounts";
import { isHex, type Hex, type TypedDataDefinition } from "viem";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { hmac } from "@noble/hashes/hmac";
import { sha512 } from "@noble/hashes/sha512";
import { mnemonicToSeedSync } from "@scure/bip39";
import { ed25519 } from "@noble/curves/ed25519";

const EVM_PATH = "m/44'/60'/0'/0/0";
const SOLANA_PATH = [44, 501, 0, 0]; // m/44'/501'/0'/0', all hardened
const HARDENED_OFFSET = 0x80000000;
const ED25519_SEED_KEY = new TextEncoder().encode("ed25519 seed");

/** Normalize a mnemonic exactly as it is normalized before sealing. */
function normalize(mnemonic: string): string {
  return mnemonic.trim().replace(/\s+/g, " ").toLowerCase();
}

// ── EVM ────────────────────────────────────────────────────────────────────

/** Build the viem local account for the wallet's primary EVM address. */
export function getEvmAccount(mnemonic: string) {
  return mnemonicToAccount(normalize(mnemonic), { path: EVM_PATH });
}

/**
 * Sign a message for personal_sign. dApps pass the message hex-encoded; it must
 * be signed as raw bytes, NOT as a UTF-8 string, or the signature is invalid.
 */
export async function signMessageEvm(mnemonic: string, message: string): Promise<string> {
  const account = getEvmAccount(mnemonic);
  const payload = isHex(message) ? { raw: message as Hex } : message;
  return account.signMessage({ message: payload });
}

/**
 * Sign EIP-712 typed data. The full structure (including its own primaryType)
 * is passed through — hard-coding primaryType breaks Permit and most real
 * typed-data flows.
 */
export async function signTypedDataEvm(
  mnemonic: string,
  typedData: TypedDataDefinition
): Promise<string> {
  const account = getEvmAccount(mnemonic);
  return account.signTypedData(typedData);
}

// ── Solana (SLIP-0010 ed25519) ───────────────────────────────────────────────

/**
 * SLIP-0010 hardened-only ed25519 derivation. Returns the 32-byte private seed
 * for the given path from a 64-byte BIP39 master seed.
 */
function deriveEd25519(seed: Uint8Array, path: number[]): Uint8Array {
  let I = hmac(sha512, ED25519_SEED_KEY, seed);
  let key = I.slice(0, 32);
  let chainCode = I.slice(32);
  for (const segment of path) {
    const index = (segment | HARDENED_OFFSET) >>> 0; // ed25519 supports hardened only
    const data = new Uint8Array(1 + 32 + 4);
    data[0] = 0x00;
    data.set(key, 1);
    new DataView(data.buffer).setUint32(33, index, false); // big-endian index
    I = hmac(sha512, chainCode, data);
    key = I.slice(0, 32);
    chainCode = I.slice(32);
  }
  return key;
}

/** 32-byte ed25519 private seed for the wallet's Solana account. */
function deriveSolanaSeed(mnemonic: string): Uint8Array {
  const seed = mnemonicToSeedSync(normalize(mnemonic));
  return deriveEd25519(seed, SOLANA_PATH);
}

/** Build the Solana keypair (Keypair.fromSeed wants exactly the 32-byte seed). */
export function getSolanaKeypair(mnemonic: string): Keypair {
  return Keypair.fromSeed(deriveSolanaSeed(mnemonic));
}

/**
 * Sign arbitrary bytes with the Solana key (used for both message signing and
 * transaction-message signing). Returns a base58 signature, the Solana norm.
 */
export function signSolana(mnemonic: string, payload: Uint8Array): string {
  const seed = deriveSolanaSeed(mnemonic);
  const sig = ed25519.sign(payload, seed);
  return bs58.encode(sig);
}

/** @deprecated kept for callers; both message and tx sign raw bytes. */
export function signSolanaMessage(mnemonic: string, message: Uint8Array): string {
  return signSolana(mnemonic, message);
}
export function signSolanaTransaction(mnemonic: string, txMessage: Uint8Array): string {
  return signSolana(mnemonic, txMessage);
}

// ── Addresses ────────────────────────────────────────────────────────────────

/** Resolve both chain addresses for a mnemonic. */
export function getAddresses(mnemonic: string): { evm: string; sol: string } {
  return {
    evm: getEvmAccount(mnemonic).address,
    sol: getSolanaKeypair(mnemonic).publicKey.toBase58(),
  };
}
