/**
 * RPC router: dispatch incoming RPC requests to the appropriate handler.
 *
 * Classifies methods by chain (eip155 / solana) and type (public / approval / account / signing).
 * Wraps all errors in RpcResponse format.
 */

import type { RpcResponse, Chain } from "@/shared/protocol";
import { PUBLIC_EVM_METHODS } from "@/shared/protocol";
import { serializeError, unsupportedMethod, RPC_ERROR_CODES, RpcError } from "@/shared/rpc-errors";
import { handlePublicEvm } from "@/background/rpc/eth";
import * as accountsRpc from "@/background/rpc/accounts";
import * as signingRpc from "@/background/rpc/signing";
import { getSelectedChainId } from "@/background/storage/local";

/**
 * Route an RPC request to the appropriate handler.
 *
 * @param chain The blockchain identifier ("eip155" or "solana")
 * @param origin The requesting dApp origin
 * @param request The RPC request object { id, method, params }
 * @returns RpcResponse with result or error
 */
export async function routeRpc(
  chain: Chain,
  origin: string,
  request: { id: string; method: string; params?: unknown[] | Record<string, unknown> }
): Promise<RpcResponse> {
  const { id, method, params } = request;

  try {
    // Ensure params is an array
    const paramsArray = Array.isArray(params) ? params : [];

    if (chain === "eip155") {
      // ── EVM routing ──────────────────────────────────────────────────────

      // Public read-only methods
      if (PUBLIC_EVM_METHODS.has(method)) {
        const selectedChainId = await getSelectedChainId();
        const result = await handlePublicEvm(method, paramsArray, selectedChainId);
        return { id, result };
      }

      // Account methods
      if (method === "eth_accounts") {
        const result = await accountsRpc.handleEthAccounts(origin);
        return { id, result };
      }

      if (method === "eth_requestAccounts") {
        const result = await accountsRpc.handleEthRequestAccounts(origin);
        return { id, result };
      }

      // Signing methods (require unlocked wallet)
      if (method === "personal_sign") {
        const result = await signingRpc.handlePersonalSign(origin, paramsArray);
        return { id, result };
      }

      if (method === "eth_sign") {
        // eth_sign is deprecated but still used; maps to personal_sign with different encoding
        // For now, treat it like personal_sign
        const result = await signingRpc.handlePersonalSign(origin, paramsArray);
        return { id, result };
      }

      if (method === "eth_signTypedData" || method === "eth_signTypedData_v4") {
        const result = await signingRpc.handleEthSignTypedDataV4(origin, paramsArray);
        return { id, result };
      }

      if (method === "eth_sendTransaction") {
        const selectedChainId = await getSelectedChainId();
        const result = await signingRpc.handleEthSendTransaction(origin, paramsArray, selectedChainId);
        return { id, result };
      }

      // Chain switching
      if (method === "wallet_switchEthereumChain") {
        if (!Array.isArray(paramsArray) || paramsArray.length < 1) {
          throw new RpcError(RPC_ERROR_CODES.INVALID_PARAMS);
        }
        const switchObj = paramsArray[0] as any;
        const chainIdStr = switchObj.chainId as string;
        if (!chainIdStr) {
          throw new RpcError(RPC_ERROR_CODES.INVALID_PARAMS, "chainId required");
        }
        // Parse hex or decimal chain ID
        const chainId = chainIdStr.startsWith("0x")
          ? parseInt(chainIdStr, 16)
          : parseInt(chainIdStr, 10);

        // Reject unsupported chains with EIP-3326's 4902 so dApps can prompt to add.
        const { getChainConfig } = await import("@/background/rpc/eth");
        try {
          getChainConfig(chainId);
        } catch {
          throw new RpcError(4902, `Unrecognized chain ID ${chainId}. Try adding the chain first.`);
        }

        const { setSelectedChainId } = await import("@/background/storage/local");
        await setSelectedChainId(chainId);

        // NOTE: the chainChanged event broadcast to connected pages happens in
        // index.ts on popup-driven switches; dApp-driven switches should also be
        // broadcast there (tracked as a known gap — see ARCHITECTURE "Known gaps").
        return { id, result: null };
      }

      if (method === "wallet_addEthereumChain") {
        // wallet_addEthereumChain: user is requesting to add a new chain
        // For this PoC, we just acknowledge it without actually adding to our registry
        // In a full implementation, this would enqueue an approval for the user to review
        return { id, result: null };
      }

      // Unknown method
      throw unsupportedMethod(method);
    } else if (chain === "solana") {
      // ── Solana routing ──────────────────────────────────────────────────
      //
      // Solana is NOT yet implemented. EVERY Solana method is explicitly
      // gated here so a dApp gets a clear, deterministic error instead of a
      // silent no-op or a half-handled signing flow. Do not add real Solana
      // handlers until the keyring/signing path supports ed25519 accounts.
      const SOLANA_METHODS = new Set([
        "connect",
        "signMessage",
        "signTransaction",
        "signAllTransactions",
        "signAndSendTransaction",
      ]);

      if (SOLANA_METHODS.has(method)) {
        // Known Solana method — explicitly unsupported (coming soon).
        throw new RpcError(
          RPC_ERROR_CODES.UNSUPPORTED_METHOD,
          `Solana support coming soon — "${method}" is not yet available.`
        );
      }

      // Any other / default Solana method: also gated, never silently passed.
      throw new RpcError(
        RPC_ERROR_CODES.UNSUPPORTED_METHOD,
        `Solana support coming soon — "${method}" is not yet available.`
      );
    } else {
      // Unknown chain
      throw new RpcError(RPC_ERROR_CODES.UNSUPPORTED_METHOD, `Unknown chain: ${chain}`);
    }
  } catch (err) {
    // Wrap any error in RpcResponse format
    const serialized = serializeError(err);
    return { id, error: serialized };
  }
}
