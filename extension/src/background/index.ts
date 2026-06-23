/**
 * Service worker entry point: MV3 background service.
 *
 * Responsibilities:
 * - Initialize chrome.storage.session access level to TRUSTED_CONTEXTS
 * - Handle long-lived content-bridge ports (relay RPC requests)
 * - Handle popup messages (getState, unlock, lock, approvals, etc.)
 * - Manage port-per-origin tracking for event broadcasting
 */

import type { PortMessage, PopupRequest, PopupResponse, WalletState, ProviderEvent } from "@/shared/protocol";
import { PORT_NAME } from "@/shared/constants";
import { RPC_ERROR_CODES } from "@/shared/rpc-errors";
import { routeRpc } from "@/background/router";
import * as approvalQueue from "@/background/approval/queue";
import {
  getVault,
  getMeta,
  getSelectedAddress,
  getSelectedChainId,
  setSelectedAddress,
  setSelectedChainId,
} from "@/background/storage/local";
import { getUnlockedKey, setUnlockedKey, clearUnlockedKey } from "@/background/storage/session";
import { deriveVaultKey } from "@/background/keyring/webauthn-prf";
import { openVault, sealVault } from "@/background/keyring/vault";
import { getAddresses } from "@/background/keyring/signer";
import type { VaultMeta } from "@/background/storage/local";
import {
  generateMnemonic as bip39Generate,
  validateMnemonic,
} from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";

/** Generate a fresh, valid 12-word BIP39 mnemonic (128 bits of entropy). */
function generateMnemonic(): string {
  return bip39Generate(wordlist, 128);
}

/** Normalize a user-entered mnemonic the same way the signer does before use. */
function normalizeMnemonic(mnemonic: string): string {
  return mnemonic.trim().replace(/\s+/g, " ").toLowerCase();
}

// ──────────────────────────────────────────────────────────────────────────────
// Initialization
// ──────────────────────────────────────────────────────────────────────────────

// Set session storage access level on service worker startup
chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });

// Track connected ports per origin (for event broadcasting)
const portsByOrigin = new Map<string, chrome.runtime.Port[]>();

// ──────────────────────────────────────────────────────────────────────────────
// Content Bridge Port Handler
// ──────────────────────────────────────────────────────────────────────────────

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PORT_NAME) {
    return;
  }

  let portOrigin: string | null = null;

  port.onMessage.addListener(async (message: PortMessage) => {
    if (message.kind === "rpc") {
      const { chain, origin, request } = message;
      portOrigin = origin;

      // Track this port for event broadcasting
      if (!portsByOrigin.has(origin)) {
        portsByOrigin.set(origin, []);
      }
      portsByOrigin.get(origin)!.push(port);

      // Route the RPC request
      const response = await routeRpc(chain, origin, request);

      // Send back the response
      port.postMessage({
        kind: "rpc-result",
        chain,
        response,
      } as PortMessage);
    } else if (message.kind === "event") {
      // Forward event from background to connected ports for this origin
      const { origin, event } = message;
      const portsForOrigin = portsByOrigin.get(origin) || [];
      for (const p of portsForOrigin) {
        p.postMessage({
          kind: "event",
          chain: message.chain,
          origin,
          event,
        } as PortMessage);
      }
    }
  });

  port.onDisconnect.addListener(() => {
    if (portOrigin) {
      const portsForOrigin = portsByOrigin.get(portOrigin) || [];
      const idx = portsForOrigin.indexOf(port);
      if (idx >= 0) {
        portsForOrigin.splice(idx, 1);
      }
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Popup Message Handler
// ──────────────────────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((request: PopupRequest, _sender, sendResponse: (response: PopupResponse) => void) => {
  // Route popup messages asynchronously, returning true to indicate sendResponse will be called later
  handlePopupRequest(request, sendResponse).catch((err) => {
    sendResponse({
      ok: false,
      error: {
        code: -1,
        message: String(err),
      },
    });
  });

  return true; // Indicate async response
});

/**
 * Handle popup requests.
 */
async function handlePopupRequest(request: PopupRequest, sendResponse: (response: PopupResponse) => void) {
  try {
    const response = await processPopupRequest(request);
    sendResponse(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendResponse({
      ok: false,
      error: {
        code: -1,
        message,
      },
    });
  }
}

/**
 * Process each popup request type.
 */
async function processPopupRequest(request: PopupRequest): Promise<PopupResponse> {
  if (request.type === "getState") {
    const state = await buildWalletState();
    return { ok: true, data: state };
  }

  if (request.type === "unlock") {
    const { prfOutput } = request;
    const prfBytes = new Uint8Array(prfOutput);

    // Derive vault key from PRF output
    const vaultKey = await deriveVaultKey(prfBytes);

    // Get the vault and try to open it
    const vault = await getVault();
    if (!vault) {
      return {
        ok: false,
        error: { code: 4101, message: "Vault not found" },
      };
    }

    try {
      // Validate by opening the vault
      await openVault(vault, vaultKey);

      // Store the unlocked key in session storage
      await setUnlockedKey(vaultKey);

      const state = await buildWalletState();
      return { ok: true, data: state };
    } catch (err) {
      return {
        ok: false,
        error: {
          code: 4101,
          message: "Failed to unlock vault",
        },
      };
    }
  }

  if (request.type === "lock") {
    await clearUnlockedKey();
    const state = await buildWalletState();
    return { ok: true, data: state };
  }

  if (request.type === "createVault") {
    const { prfOutput, mnemonic: providedMnemonic } = request;
    const prfBytes = new Uint8Array(prfOutput);

    // Derive vault key from PRF output
    const vaultKey = await deriveVaultKey(prfBytes);

    // Generate or use provided mnemonic (validate anything user-provided)
    const mnemonic = providedMnemonic
      ? normalizeMnemonic(providedMnemonic)
      : generateMnemonic();
    if (providedMnemonic && !validateMnemonic(mnemonic, wordlist)) {
      return {
        ok: false,
        error: { code: RPC_ERROR_CODES.INVALID_PARAMS, message: "Invalid recovery phrase" },
      };
    }

    // Get addresses from mnemonic
    const addresses = getAddresses(mnemonic);

    // Seal the vault
    const vault = await sealVault({ mnemonic }, vaultKey);

    // Store vault and metadata
    await Promise.all([
      (async () => {
        const { setVault } = await import("@/background/storage/local");
        await setVault(vault);
      })(),
      (async () => {
        const { setMeta } = await import("@/background/storage/local");
        const meta: VaultMeta = {
          evmAddress: addresses.evm,
          solAddress: addresses.sol,
          createdAt: Date.now(),
        };
        await setMeta(meta);
      })(),
      (async () => {
        await setSelectedAddress(addresses.evm);
      })(),
      setUnlockedKey(vaultKey),
    ]);

    const state = await buildWalletState();
    return { ok: true, data: state };
  }

  if (request.type === "importVault") {
    const { prfOutput } = request;
    const prfBytes = new Uint8Array(prfOutput);

    // Derive vault key from PRF output
    const vaultKey = await deriveVaultKey(prfBytes);

    // Validate + normalize the user-supplied recovery phrase before sealing it.
    const mnemonic = normalizeMnemonic(request.mnemonic);
    if (!validateMnemonic(mnemonic, wordlist)) {
      return {
        ok: false,
        error: { code: RPC_ERROR_CODES.INVALID_PARAMS, message: "Invalid recovery phrase" },
      };
    }

    // Get addresses from provided mnemonic
    const addresses = getAddresses(mnemonic);

    // Seal the vault
    const vault = await sealVault({ mnemonic }, vaultKey);

    // Store vault and metadata
    await Promise.all([
      (async () => {
        const { setVault } = await import("@/background/storage/local");
        await setVault(vault);
      })(),
      (async () => {
        const { setMeta } = await import("@/background/storage/local");
        const meta: VaultMeta = {
          evmAddress: addresses.evm,
          solAddress: addresses.sol,
          createdAt: Date.now(),
        };
        await setMeta(meta);
      })(),
      (async () => {
        await setSelectedAddress(addresses.evm);
      })(),
      setUnlockedKey(vaultKey),
    ]);

    const state = await buildWalletState();
    return { ok: true, data: state };
  }

  if (request.type === "listPendingApprovals") {
    const approvals = await approvalQueue.list();
    return { ok: true, data: approvals };
  }

  if (request.type === "resolveApproval") {
    const { approvalId, approved, result } = request;
    await approvalQueue.resolve(approvalId, approved, result);
    return { ok: true };
  }

  if (request.type === "selectAccount") {
    const { address } = request;
    await setSelectedAddress(address);
    const state = await buildWalletState();
    return { ok: true, data: state };
  }

  if (request.type === "switchChain") {
    const { chainId } = request;
    await setSelectedChainId(chainId);

    // Broadcast chainChanged event to all connected origins
    const portEntries = Array.from(portsByOrigin.entries());
    for (const [origin, ports] of portEntries) {
      const event: ProviderEvent = {
        event: "chainChanged",
        data: "0x" + chainId.toString(16),
      };
      for (const port of ports) {
        port.postMessage({
          kind: "event",
          chain: "eip155",
          origin,
          event,
        } as PortMessage);
      }
    }

    const state = await buildWalletState();
    return { ok: true, data: state };
  }

  return {
    ok: false,
    error: { code: -1, message: "Unknown request type" },
  };
}

/**
 * Build the current wallet state from storage.
 */
async function buildWalletState(): Promise<WalletState> {
  const vault = await getVault();
  const meta = await getMeta();
  const selectedAddress = await getSelectedAddress();
  const selectedChainId = await getSelectedChainId();
  const unlockedKey = await getUnlockedKey();
  const approvals = await approvalQueue.list();

  return {
    initialized: !!vault && !!meta,
    unlocked: !!unlockedKey,
    selectedAddress: selectedAddress || null,
    selectedChainId,
    accounts: meta ? [meta.evmAddress, meta.solAddress] : [],
    pendingApprovalCount: approvals.length,
  };
}
