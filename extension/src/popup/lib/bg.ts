/**
 * Popup <-> Background communication wrapper.
 *
 * Typed interface to chrome.runtime.sendMessage for PopupRequest / PopupResponse.
 * This is the only place where the popup talks to the background service worker.
 */

import type { PopupRequest, PopupResponse } from "@/shared/protocol";
import { RpcError, RPC_ERROR_CODES } from "@/shared/rpc-errors";

/**
 * Send a request to the background and await the response.
 *
 * @param request The PopupRequest to send
 * @returns Promise resolving to the response data, or rejecting with RpcError on failure
 */
export async function sendToBackground<T = unknown>(request: PopupRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(request, (response: PopupResponse) => {
      if (chrome.runtime.lastError) {
        return reject(
          new RpcError(RPC_ERROR_CODES.INTERNAL, `Background communication failed: ${chrome.runtime.lastError.message}`)
        );
      }

      if (!response || typeof response !== "object") {
        return reject(new RpcError(RPC_ERROR_CODES.INTERNAL, "Invalid response from background."));
      }

      if (!response.ok) {
        const error = response.error;
        return reject(new RpcError(error.code, error.message, error.data));
      }

      resolve(response.data as T);
    });
  });
}

/**
 * Get the current wallet state from the background.
 */
export function getState() {
  return sendToBackground({ type: "getState" });
}

/**
 * Unlock the wallet with a PRF output.
 */
export function unlock(prfOutput: number[]) {
  return sendToBackground({ type: "unlock", prfOutput });
}

/**
 * Lock the wallet.
 */
export function lock() {
  return sendToBackground({ type: "lock" });
}

/**
 * Create a new vault (fresh mnemonic).
 */
export function createVault(prfOutput: number[]) {
  return sendToBackground({ type: "createVault", prfOutput });
}

/**
 * Import a vault from a mnemonic.
 */
export function importVault(prfOutput: number[], mnemonic: string) {
  return sendToBackground({ type: "importVault", prfOutput, mnemonic });
}

/**
 * List all pending approvals.
 */
export function listPendingApprovals() {
  return sendToBackground({ type: "listPendingApprovals" });
}

/**
 * Resolve (approve or reject) a pending approval.
 */
export function resolveApproval(approvalId: string, approved: boolean, result?: unknown) {
  return sendToBackground({ type: "resolveApproval", approvalId, approved, result });
}

/**
 * Select an account to use.
 */
export function selectAccount(address: string) {
  return sendToBackground({ type: "selectAccount", address });
}

/**
 * Switch the active EVM chain.
 */
export function switchChain(chainId: number) {
  return sendToBackground({ type: "switchChain", chainId });
}
