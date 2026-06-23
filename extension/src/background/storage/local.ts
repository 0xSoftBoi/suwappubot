/**
 * Typed wrappers over chrome.storage.local (encrypted-at-rest persistent storage).
 *
 * Handles vault encryption, metadata, approved origins, and selected account state.
 * All operations are async Promises that resolve from chrome.storage.local.
 */

import { STORAGE_LOCAL } from "@/shared/constants";
import type { EncryptedVault } from "@/background/keyring/vault";

/**
 * Metadata stored alongside the encrypted vault (non-secret: addresses, etc.)
 */
export interface VaultMeta {
  /** User's primary EVM address (derived from mnemonic) */
  evmAddress: string;
  /** User's primary Solana address (derived from mnemonic) */
  solAddress: string;
  /** Unix timestamp (ms) when the vault was created */
  createdAt: number;
}

/**
 * Approved origin entry tracking when an origin was approved and which accounts it can access.
 */
interface ApprovedOrigin {
  /** Unix timestamp (ms) when this origin was approved */
  approvedAt: number;
  /** List of approved account addresses (EVMs or Solana addresses) */
  accounts: string[];
}

/**
 * Retrieve the encrypted vault blob from storage.local.
 *
 * @returns Promise<EncryptedVault | null> The vault if it exists, null otherwise
 */
export async function getVault(): Promise<EncryptedVault | null> {
  const result = await chrome.storage.local.get(STORAGE_LOCAL.VAULT);
  return result[STORAGE_LOCAL.VAULT] ?? null;
}

/**
 * Store an encrypted vault blob to storage.local.
 *
 * @param vault The EncryptedVault to persist
 * @returns Promise<void>
 */
export async function setVault(vault: EncryptedVault): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_LOCAL.VAULT]: vault });
}

/**
 * Retrieve vault metadata from storage.local.
 *
 * @returns Promise<VaultMeta | null> The metadata if it exists, null otherwise
 */
export async function getMeta(): Promise<VaultMeta | null> {
  const result = await chrome.storage.local.get(STORAGE_LOCAL.META);
  return result[STORAGE_LOCAL.META] ?? null;
}

/**
 * Store vault metadata to storage.local.
 *
 * @param meta The VaultMeta to persist
 * @returns Promise<void>
 */
export async function setMeta(meta: VaultMeta): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_LOCAL.META]: meta });
}

/**
 * Retrieve all approved origins and their allowed accounts from storage.local.
 *
 * @returns Promise<Record<string, ApprovedOrigin>> Mapping of origin → {approvedAt, accounts[]}
 */
export async function getApprovedOrigins(): Promise<Record<string, ApprovedOrigin>> {
  const result = await chrome.storage.local.get(STORAGE_LOCAL.APPROVED_ORIGINS);
  return result[STORAGE_LOCAL.APPROVED_ORIGINS] ?? {};
}

/**
 * Approve an origin by storing it with a set of allowed accounts.
 *
 * @param origin The origin to approve (e.g., "https://example.com")
 * @param accounts List of account addresses this origin can access
 * @returns Promise<void>
 */
export async function approveOrigin(origin: string, accounts: string[]): Promise<void> {
  const origins = await getApprovedOrigins();
  origins[origin] = {
    approvedAt: Date.now(),
    accounts,
  };
  await chrome.storage.local.set({ [STORAGE_LOCAL.APPROVED_ORIGINS]: origins });
}

/**
 * Check if an origin has been previously approved.
 *
 * @param origin The origin to check
 * @returns Promise<boolean> True if the origin is approved
 */
export async function isOriginApproved(origin: string): Promise<boolean> {
  const origins = await getApprovedOrigins();
  return origin in origins;
}

/**
 * Retrieve the currently selected EVM/Solana address from storage.local.
 *
 * @returns Promise<string | null> The selected address if set, null otherwise
 */
export async function getSelectedAddress(): Promise<string | null> {
  const result = await chrome.storage.local.get(STORAGE_LOCAL.SELECTED_ADDRESS);
  return result[STORAGE_LOCAL.SELECTED_ADDRESS] ?? null;
}

/**
 * Set the currently selected address in storage.local.
 *
 * @param address The address to select
 * @returns Promise<void>
 */
export async function setSelectedAddress(address: string): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_LOCAL.SELECTED_ADDRESS]: address });
}

/**
 * Retrieve the currently selected EVM chain ID from storage.local.
 *
 * @returns Promise<number> The selected chain ID, or DEFAULT_CHAIN_ID if not set
 */
export async function getSelectedChainId(): Promise<number> {
  const { DEFAULT_CHAIN_ID } = await import("@/shared/constants");
  const result = await chrome.storage.local.get(STORAGE_LOCAL.SELECTED_CHAIN_ID);
  return result[STORAGE_LOCAL.SELECTED_CHAIN_ID] ?? DEFAULT_CHAIN_ID;
}

/**
 * Set the currently selected EVM chain ID in storage.local.
 *
 * @param chainId The chain ID to select
 * @returns Promise<void>
 */
export async function setSelectedChainId(chainId: number): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_LOCAL.SELECTED_CHAIN_ID]: chainId });
}
