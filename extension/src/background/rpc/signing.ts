/**
 * EVM signing RPC handlers.
 *
 * personal_sign: sign raw message
 * eth_signTypedData_v4: sign EIP-712 typed data
 * eth_sendTransaction: sign and broadcast transaction
 */

import { createWalletClient, http, type Hex, type TypedDataDefinition } from "viem";
import { walletLocked, RPC_ERROR_CODES, RpcError } from "@/shared/rpc-errors";
import { getUnlockedKey } from "@/background/storage/session";
import { getVault } from "@/background/storage/local";
import { openVault } from "@/background/keyring/vault";
import * as signer from "@/background/keyring/signer";
import * as approvalQueue from "@/background/approval/queue";
import { getChainConfig } from "@/background/rpc/eth";
import type { ApprovalRequest } from "@/shared/protocol";

/** Convert an optional hex/number tx field to bigint, or undefined. */
function toBigIntOpt(v: unknown): bigint | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  return BigInt(v as string | number | bigint);
}

/**
 * personal_sign: sign a raw message with the user's EVM account.
 *
 * @param origin The requesting dApp origin
 * @param params [message, address] where message is a hex string and address is the signer
 * @returns Hex-encoded signature
 */
export async function handlePersonalSign(origin: string, params: unknown[]): Promise<string> {
  // Validate params
  if (!Array.isArray(params) || params.length < 2) {
    throw new RpcError(RPC_ERROR_CODES.INVALID_PARAMS, "personal_sign requires [message, address]");
  }

  const message = params[0] as string;
  const signerAddress = params[1] as string;

  if (typeof message !== "string" || typeof signerAddress !== "string") {
    throw new RpcError(RPC_ERROR_CODES.INVALID_PARAMS);
  }

  // Enqueue signing approval
  const approvalReq: Omit<ApprovalRequest, "id" | "createdAt"> = {
    kind: "signMessage",
    origin,
    chain: "eip155",
    data: { message, signerAddress },
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

    // Get unlocked key and mnemonic
    const unlockedKey = await getUnlockedKey();
    if (!unlockedKey) {
      throw walletLocked("Wallet is locked");
    }

    const vault = await getVault();
    if (!vault) {
      throw new RpcError(RPC_ERROR_CODES.WALLET_LOCKED, "Vault not found");
    }

    const secret = await openVault(vault, unlockedKey);

    // Sign the message (hex payloads are signed as raw bytes inside the signer)
    const sig = await signer.signMessageEvm(secret.mnemonic, message);
    return sig;
  } catch (err) {
    if (err instanceof RpcError) {
      throw err;
    }
    throw new RpcError(RPC_ERROR_CODES.INTERNAL, String(err));
  }
}

/**
 * eth_signTypedData_v4: sign EIP-712 typed data.
 *
 * @param origin The requesting dApp origin
 * @param params [address, typedDataJson] where typedDataJson is stringified EIP-712 domain + types + value
 * @returns Hex-encoded signature
 */
export async function handleEthSignTypedDataV4(origin: string, params: unknown[]): Promise<string> {
  // Validate params
  if (!Array.isArray(params) || params.length < 2) {
    throw new RpcError(RPC_ERROR_CODES.INVALID_PARAMS, "eth_signTypedData_v4 requires [address, typedData]");
  }

  const signerAddress = params[0] as string;
  const typedDataJson = params[1] as string;

  if (typeof signerAddress !== "string" || typeof typedDataJson !== "string") {
    throw new RpcError(RPC_ERROR_CODES.INVALID_PARAMS);
  }

  // Parse the typed data
  let typedData: any;
  try {
    typedData = JSON.parse(typedDataJson);
  } catch {
    throw new RpcError(RPC_ERROR_CODES.INVALID_PARAMS, "Invalid typedData JSON");
  }

  // Enqueue signing approval
  const approvalReq: Omit<ApprovalRequest, "id" | "createdAt"> = {
    kind: "signTypedData",
    origin,
    chain: "eip155",
    data: typedData,
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

    // Get unlocked key and mnemonic
    const unlockedKey = await getUnlockedKey();
    if (!unlockedKey) {
      throw walletLocked("Wallet is locked");
    }

    const vault = await getVault();
    if (!vault) {
      throw new RpcError(RPC_ERROR_CODES.WALLET_LOCKED, "Vault not found");
    }

    const secret = await openVault(vault, unlockedKey);

    // Sign the typed data, preserving the dApp's own primaryType/types/domain.
    const sig = await signer.signTypedDataEvm(secret.mnemonic, typedData as TypedDataDefinition);

    return sig;
  } catch (err) {
    if (err instanceof RpcError) {
      throw err;
    }
    throw new RpcError(RPC_ERROR_CODES.INTERNAL, String(err));
  }
}

/**
 * eth_sendTransaction: sign a transaction and broadcast it.
 *
 * @param origin The requesting dApp origin
 * @param params [txObject] where txObject contains to, data, value, gas, etc.
 * @param chainId The selected EVM chain ID
 * @returns Transaction hash
 */
export async function handleEthSendTransaction(
  origin: string,
  params: unknown[],
  chainId: number
): Promise<string> {
  // Validate params
  if (!Array.isArray(params) || params.length < 1) {
    throw new RpcError(RPC_ERROR_CODES.INVALID_PARAMS, "eth_sendTransaction requires [txObject]");
  }

  const txObject = params[0];
  if (typeof txObject !== "object" || txObject === null) {
    throw new RpcError(RPC_ERROR_CODES.INVALID_PARAMS);
  }

  // Enqueue transaction approval
  const approvalReq: Omit<ApprovalRequest, "id" | "createdAt"> = {
    kind: "sendTransaction",
    origin,
    chain: "eip155",
    data: txObject,
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

    // Get unlocked key and mnemonic
    const unlockedKey = await getUnlockedKey();
    if (!unlockedKey) {
      throw walletLocked("Wallet is locked");
    }

    const vault = await getVault();
    if (!vault) {
      throw new RpcError(RPC_ERROR_CODES.WALLET_LOCKED, "Vault not found");
    }

    const secret = await openVault(vault, unlockedKey);

    // Build a wallet client bound to the user's account + selected chain. viem
    // prepares the missing nonce/gas/fee fields, signs locally, and broadcasts.
    const account = signer.getEvmAccount(secret.mnemonic);
    const { viemChain, rpcUrl } = getChainConfig(chainId);
    const walletClient = createWalletClient({ account, chain: viemChain, transport: http(rpcUrl) });

    const tx = txObject as Record<string, unknown>;
    const txHash = await walletClient.sendTransaction({
      account,
      chain: viemChain,
      to: (tx.to as Hex | undefined) ?? undefined,
      data: (tx.data as Hex | undefined) ?? undefined,
      value: toBigIntOpt(tx.value),
      gas: toBigIntOpt(tx.gas),
      nonce: tx.nonce !== undefined && tx.nonce !== null ? Number(BigInt(tx.nonce as string)) : undefined,
      maxFeePerGas: toBigIntOpt(tx.maxFeePerGas),
      maxPriorityFeePerGas: toBigIntOpt(tx.maxPriorityFeePerGas),
      gasPrice: toBigIntOpt(tx.gasPrice),
    } as Parameters<typeof walletClient.sendTransaction>[0]);

    return txHash;
  } catch (err) {
    if (err instanceof RpcError) {
      throw err;
    }
    throw new RpcError(RPC_ERROR_CODES.INTERNAL, String(err));
  }
}
