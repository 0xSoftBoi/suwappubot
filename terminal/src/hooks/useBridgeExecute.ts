import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getAccount,
  sendTransaction,
  switchChain,
  waitForTransactionReceipt,
} from "@wagmi/core";
import { api } from "../lib/api";
import { config } from "../lib/wagmi";
import type { BridgeBuildResult, BridgeRoute, BridgeTransfer } from "../types/bridge";

// wagmi types chainId as the literal union of configured chains; the backend
// sends a plain number, so narrow at the boundary. A chain the wallet doesn't
// know surfaces as a switchChain error, which is what we want.
type ChainId = (typeof config)["chains"][number]["id"];

export interface BridgeExecuteResult {
  transferId: number;
  build: BridgeBuildResult;
  /** Absent for deposit-address rails, where nothing is signed. */
  txHash?: string;
  transfer?: BridgeTransfer;
}

/**
 * Start a bridge transfer with an external wallet.
 *
 * Ordering differs deliberately from useExternalSwap. That hook records the
 * swap *after* broadcasting and shrugs off a record failure, which is fine for
 * a same-chain swap: the tx is self-contained and visible on chain. A bridge is
 * not — funds leave the source chain and something has to know to complete or
 * chase the far side. A broadcast we failed to record would be invisible.
 *
 * So the server issues the transferId at build time, before any signature
 * exists. If the user then abandons the flow, the row simply stays in
 * pending_broadcast having moved nothing. That is the harmless direction.
 */
export function useBridgeExecute() {
  const queryClient = useQueryClient();

  return useMutation<BridgeExecuteResult, unknown, BridgeRoute>({
    mutationFn: async (route) => {
      const account = getAccount(config);
      const address = account.address;
      if (!address) {
        throw { detail: "Connect your wallet first.", status: 0 };
      }

      const build = await api.buildBridgeTransfer({
        provider: route.provider,
        fromChain: route.fromChain,
        toChain: route.toChain,
        token: route.token,
        amount: route.fromAmount,
        fromAddress: address,
      });

      // Deposit-address rails: the address IS the instruction. Nothing to sign,
      // and the transfer is already tracked as awaiting_deposit.
      if (build.settlement === "deposit_address") {
        return { transferId: build.transferId, build };
      }

      if (!build.tx || build.chainId == null) {
        throw {
          detail: "This route can't be signed by a connected wallet.",
          status: 0,
        };
      }

      if (account.chainId !== build.chainId) {
        await switchChain(config, { chainId: build.chainId as ChainId });
      }

      // Approve first where the rail needs it. Wait for the receipt: a send
      // built against an unconfirmed approval reverts and wastes the gas just
      // spent here.
      if (build.approval) {
        const approvalHash = await sendTransaction(config, {
          to: build.approval.to as `0x${string}`,
          data: build.approval.data as `0x${string}`,
          value: BigInt(build.approval.value || "0"),
          chainId: build.chainId as ChainId,
        });
        await waitForTransactionReceipt(config, {
          hash: approvalHash,
          chainId: build.chainId as ChainId,
        });
      }

      const txHash = await sendTransaction(config, {
        to: build.tx.to as `0x${string}`,
        data: build.tx.data as `0x${string}`,
        value: BigInt(build.tx.value || "0"),
        gas: build.tx.gas ? BigInt(build.tx.gas) : undefined,
        chainId: build.chainId as ChainId,
      });

      // Attach the hash. The transfer already exists, so a failure here loses
      // tracking precision, not the transfer — and the hash is returned either
      // way so the UI can show it.
      try {
        const transfer = await api.recordBridgeTransfer({
          transferId: build.transferId,
          txHash,
        });
        return { transferId: build.transferId, build, txHash, transfer };
      } catch {
        return { transferId: build.transferId, build, txHash };
      }
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({
        queryKey: ["bridge-transfer", String(result.transferId)],
      });
      queryClient.invalidateQueries({ queryKey: ["portfolio"] });
    },
  });
}
