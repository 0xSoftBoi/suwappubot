/**
 * EVM account RPC handlers.
 *
 * eth_accounts: returns list of approved accounts for the origin
 * eth_requestAccounts: enqueues a connect approval and returns accounts on approval
 */

import { RPC_ERROR_CODES, RpcError } from "@/shared/rpc-errors";
import { getApprovedOrigins, getSelectedAddress, approveOrigin, getMeta } from "@/background/storage/local";
import * as approvalQueue from "@/background/approval/queue";
import type { ApprovalRequest } from "@/shared/protocol";

/**
 * eth_accounts: return list of accounts this origin has permission to use.
 *
 * @param origin The requesting dApp origin
 * @returns Array of approved EVM addresses, or empty array if not approved
 */
export async function handleEthAccounts(origin: string): Promise<string[]> {
  const approvedOrigins = await getApprovedOrigins();
  const approval = approvedOrigins[origin];

  if (!approval) {
    return [];
  }

  return approval.accounts;
}

/**
 * eth_requestAccounts: prompt user to approve this origin.
 * Enqueues a connect approval and waits for user response.
 *
 * @param origin The requesting dApp origin
 * @returns Array of approved EVM addresses on approval
 * @throws RpcError if user rejects or wallet is not initialized
 */
export async function handleEthRequestAccounts(origin: string): Promise<string[]> {
  // Check if already approved
  const approvedOrigins = await getApprovedOrigins();
  if (origin in approvedOrigins) {
    return approvedOrigins[origin].accounts;
  }

  // Get the current selected address from storage
  const selectedAddress = await getSelectedAddress();
  const meta = await getMeta();

  if (!meta) {
    throw new RpcError(RPC_ERROR_CODES.WALLET_LOCKED, "Wallet not initialized");
  }

  // Use selected address or fall back to primary address
  const primaryAddress = selectedAddress || meta.evmAddress;

  // Enqueue a connect approval
  const approvalReq: Omit<ApprovalRequest, "id" | "createdAt"> = {
    kind: "connect",
    origin,
    chain: "eip155",
    data: {
      accounts: [primaryAddress],
    },
  };

  const { id } = await approvalQueue.enqueue(approvalReq);

  // Wait for user approval (with timeout)
  const timeout = new Promise<{ approved: boolean; result?: unknown }>((_, reject) =>
    setTimeout(() => reject(new Error("Approval timeout")), 30000)
  );

  try {
    const result = await Promise.race([approvalQueue.waitFor(id), timeout]);

    if (!result.approved) {
      throw new RpcError(RPC_ERROR_CODES.USER_REJECTED, "User rejected the request");
    }

    // Approve the origin with the selected account
    await approveOrigin(origin, [primaryAddress]);

    return [primaryAddress];
  } catch (err) {
    if (err instanceof RpcError) {
      throw err;
    }
    throw new RpcError(RPC_ERROR_CODES.USER_REJECTED, "Approval failed");
  }
}
