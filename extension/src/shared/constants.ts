// Centralized constants shared across inpage / content / background / popup.
// Single source of truth — never hard-code these strings elsewhere.

/** Tag stamped on every window.postMessage envelope so we ignore foreign messages. */
export const WALLET_NAMESPACE = "suwappu-wallet";

/** Long-lived chrome.runtime.Port name used by the content bridge <-> background. */
export const PORT_NAME = "suwappu-wallet-port";

/** EIP-6963 provider identity (announced to dApps for wallet discovery). */
export const PROVIDER_INFO = {
  uuid: "b6e0f3a2-1c4d-4e8a-9f2b-7d5c8a1e0f33", // stable per-build UUID v4
  name: "Suwappu Wallet",
  // 1x1 transparent placeholder; replace with brand data-URI before release.
  icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=",
  rdns: "bot.suwappu.wallet",
} as const;

/** chrome.storage.local keys (encrypted-at-rest data). */
export const STORAGE_LOCAL = {
  VAULT: "vault", // EncryptedVault blob
  META: "vault_meta", // VaultMeta (addresses, credential ids — non-secret)
  APPROVED_ORIGINS: "approved_origins", // Record<origin, ApprovedOrigin>
  SELECTED_ADDRESS: "selected_address",
  SELECTED_CHAIN_ID: "selected_chain_id",
} as const;

/** chrome.storage.session keys (in-memory, cleared on browser close). */
export const STORAGE_SESSION = {
  UNLOCKED_KEY: "unlocked_vault_key", // raw symmetric key while unlocked
} as const;

/** Constant app-wide salt for WebAuthn PRF eval (see wallet-extension research). */
export const PRF_SALT = new TextEncoder().encode("suwappu.bot/wallet/prf/v1");

/** Default EVM chain (Base mainnet) until the user switches. */
export const DEFAULT_CHAIN_ID = 8453;

/** Auto-lock the vault after this many ms of inactivity. */
export const AUTO_LOCK_MS = 15 * 60 * 1000;

/** Backup-escrow endpoint on the Suwappu API (KMS-wrapped client blob). */
export const BACKUP_API_BASE = "https://api.suwappu.bot";
