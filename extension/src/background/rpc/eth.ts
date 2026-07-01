import {
  createPublicClient,
  http,
  type Address,
  type Block,
  type PublicClient,
} from "viem";
import {
  arbitrum,
  base,
  bsc,
  mainnet,
  optimism,
  polygon,
} from "viem/chains";
import { RpcError, RPC_ERROR_CODES } from "@/shared/rpc-errors";

// ── Chain registry (chainId → viem chain + public RPC endpoint) ────────────
const CHAIN_REGISTRY: Record<
  number,
  {
    viemChain: ReturnType<typeof createPublicClient>["chain"];
    rpcUrl: string;
  }
> = {
  1: { viemChain: mainnet, rpcUrl: "https://eth.rpc.blxrbdn.com" },
  8453: { viemChain: base, rpcUrl: "https://mainnet.base.org" },
  42161: { viemChain: arbitrum, rpcUrl: "https://arb1.arbitrum.io/rpc" },
  10: { viemChain: optimism, rpcUrl: "https://mainnet.optimism.io" },
  137: { viemChain: polygon, rpcUrl: "https://polygon-rpc.com" },
  56: { viemChain: bsc, rpcUrl: "https://bsc-dataseed1.binance.org" },
};

// ── Module-level client cache (no secrets held) ───────────────────────────
const clientCache = new Map<number, PublicClient>();

/**
 * Resolve the viem chain object + RPC url for a chain id, or throw if the
 * chain is unsupported. Used by the signing layer to build a wallet client.
 */
export function getChainConfig(chainId: number): { viemChain: ReturnType<typeof createPublicClient>["chain"]; rpcUrl: string } {
  const config = CHAIN_REGISTRY[chainId];
  if (!config) {
    throw new RpcError(RPC_ERROR_CODES.CHAIN_DISCONNECTED, `Unsupported chain: ${chainId}`);
  }
  return config;
}

/**
 * Get or create a memoized viem public client for the given chain.
 * Clients hold no mutable state and are safe to reuse across requests.
 */
export function getPublicClient(chainId: number): PublicClient {
  if (!clientCache.has(chainId)) {
    const config = CHAIN_REGISTRY[chainId];
    if (!config) {
      throw new RpcError(
        RPC_ERROR_CODES.CHAIN_DISCONNECTED,
        `Unsupported chain: ${chainId}`
      );
    }

    const client = createPublicClient({
      chain: config.viemChain,
      transport: http(config.rpcUrl),
    });

    clientCache.set(chainId, client);
  }

  return clientCache.get(chainId)!;
}

/**
 * Dispatch an EVM JSON-RPC method to the viem public client.
 * Handles all PUBLIC_EVM_METHODS by translating to typed viem calls,
 * returning hex/JSON-RPC compatible results.
 *
 * @param method - JSON-RPC method name (e.g., "eth_getBalance")
 * @param params - RPC params array (method-specific)
 * @param chainId - Target chain ID
 * @returns Result in JSON-RPC format (hex strings for numbers, etc.)
 * @throws RpcError on invalid params or unsupported chain
 */
export async function handlePublicEvm(
  method: string,
  params: unknown[],
  chainId: number
): Promise<unknown> {
  const client = getPublicClient(chainId);

  try {
    switch (method) {
      // ── Net/chain identifiers ──────────────────────────────────────────
      case "eth_chainId":
        return "0x" + chainId.toString(16);

      case "net_version":
        return chainId.toString();

      case "web3_clientVersion":
        return "Suwappu-Wallet/1.0.0";

      // ── Block information ──────────────────────────────────────────────
      case "eth_blockNumber": {
        const blockNumber = await client.getBlockNumber();
        return "0x" + blockNumber.toString(16);
      }

      case "eth_getBlockByNumber": {
        const blockNumberParam = params[0];
        if (typeof blockNumberParam !== "string") {
          throw new RpcError(RPC_ERROR_CODES.INVALID_PARAMS);
        }

        const blockNumber =
          blockNumberParam === "latest"
            ? await client.getBlockNumber()
            : BigInt(blockNumberParam);

        const includeTransactions =
          params[1] === true || params[1] === "true";

        const block = await client.getBlock({
          blockNumber,
          includeTransactions,
        });

        return serializeBlock(block, includeTransactions);
      }

      case "eth_getBlockByHash": {
        const blockHash = params[0];
        if (typeof blockHash !== "string") {
          throw new RpcError(RPC_ERROR_CODES.INVALID_PARAMS);
        }

        const includeTransactions =
          params[1] === true || params[1] === "true";

        const block = await client.getBlock({
          blockHash: blockHash as `0x${string}`,
          includeTransactions,
        });

        return serializeBlock(block, includeTransactions);
      }

      // ── Account state ──────────────────────────────────────────────────
      case "eth_getBalance": {
        const address = params[0];
        if (typeof address !== "string") {
          throw new RpcError(RPC_ERROR_CODES.INVALID_PARAMS);
        }

        const blockTag = (params[1] as string) || "latest";

        const balance = await client.getBalance({
          address: address as Address,
          blockTag: blockTag as "latest" | "pending" | "safe" | "finalized",
        });

        return "0x" + balance.toString(16);
      }

      case "eth_getCode": {
        const address = params[0];
        if (typeof address !== "string") {
          throw new RpcError(RPC_ERROR_CODES.INVALID_PARAMS);
        }

        const blockTag = (params[1] as string) || "latest";

        const code = await client.getCode({
          address: address as Address,
          blockTag: blockTag as "latest" | "pending" | "safe" | "finalized",
        });

        return code;
      }

      case "eth_getTransactionCount": {
        const address = params[0];
        if (typeof address !== "string") {
          throw new RpcError(RPC_ERROR_CODES.INVALID_PARAMS);
        }

        const blockTag = (params[1] as string) || "latest";

        const count = await client.getTransactionCount({
          address: address as Address,
          blockTag: blockTag as "latest" | "pending" | "safe" | "finalized",
        });

        return "0x" + count.toString(16);
      }

      // ── Transactions ───────────────────────────────────────────────────
      case "eth_getTransactionByHash": {
        const txHash = params[0];
        if (typeof txHash !== "string") {
          throw new RpcError(RPC_ERROR_CODES.INVALID_PARAMS);
        }

        const tx = await client.getTransaction({
          hash: txHash as `0x${string}`,
        });

        return serializeTransaction(tx);
      }

      case "eth_getTransactionReceipt": {
        const txHash = params[0];
        if (typeof txHash !== "string") {
          throw new RpcError(RPC_ERROR_CODES.INVALID_PARAMS);
        }

        const receipt = await client.getTransactionReceipt({
          hash: txHash as `0x${string}`,
        });

        return serializeTransactionReceipt(receipt);
      }

      // ── Contract calls ─────────────────────────────────────────────────
      case "eth_call": {
        const callObj = params[0];
        if (typeof callObj !== "object" || callObj === null) {
          throw new RpcError(RPC_ERROR_CODES.INVALID_PARAMS);
        }

        const blockTag = (params[1] as string) || "latest";

        const result = await client.call({
          account: (callObj as Record<string, unknown>).from as
            | Address
            | undefined,
          to: (callObj as Record<string, unknown>).to as Address,
          data: (callObj as Record<string, unknown>).data as
            | `0x${string}`
            | undefined,
          value: (callObj as Record<string, unknown>).value as
            | bigint
            | undefined,
          blockTag: blockTag as "latest" | "pending" | "safe" | "finalized",
        });

        return result.data;
      }

      case "eth_estimateGas": {
        const txObj = params[0];
        if (typeof txObj !== "object" || txObj === null) {
          throw new RpcError(RPC_ERROR_CODES.INVALID_PARAMS);
        }

        const gas = await client.estimateGas({
          account: (txObj as Record<string, unknown>).from as
            | Address
            | undefined,
          to: (txObj as Record<string, unknown>).to as Address | undefined,
          data: (txObj as Record<string, unknown>).data as
            | `0x${string}`
            | undefined,
          value: (txObj as Record<string, unknown>).value as
            | bigint
            | undefined,
        });

        return "0x" + gas.toString(16);
      }

      // ── Gas estimation ─────────────────────────────────────────────────
      case "eth_gasPrice": {
        const gasPrice = await client.getGasPrice();
        return "0x" + gasPrice.toString(16);
      }

      case "eth_maxPriorityFeePerGas": {
        const maxPriorityFeePerGas =
          await client.estimateMaxPriorityFeePerGas();
        return "0x" + maxPriorityFeePerGas.toString(16);
      }

      case "eth_feeHistory": {
        const blockCount = params[0];
        const newestBlock = params[1];
        const rewardPercentiles = params[2];

        if (
          typeof blockCount !== "number" ||
          typeof newestBlock !== "string"
        ) {
          throw new RpcError(RPC_ERROR_CODES.INVALID_PARAMS);
        }

        const history = await client.getFeeHistory({
          blockCount,
          blockTag: newestBlock as "latest" | "pending" | "safe" | "finalized",
          rewardPercentiles: (rewardPercentiles as number[] | undefined) || [],
        });

        return {
          oldestBlock: "0x" + history.baseFeePerGas[0].toString(16),
          baseFeePerGas: history.baseFeePerGas.map((fee) =>
            "0x" + fee.toString(16)
          ),
          gasUsedRatio: history.gasUsedRatio,
          reward:
            history.reward?.map((r) =>
              r.map((fee) => "0x" + fee.toString(16))
            ) || [],
        };
      }

      // ── Logs ───────────────────────────────────────────────────────────
      case "eth_getLogs": {
        const filterObj = params[0];
        if (typeof filterObj !== "object" || filterObj === null) {
          throw new RpcError(RPC_ERROR_CODES.INVALID_PARAMS);
        }

        const filter = filterObj as Record<string, unknown>;

        // Use the raw request for getLogs to preserve topics parameter structure
        const logs = (await client.request({
          method: "eth_getLogs",
          params: [filter],
        })) as Array<Record<string, unknown>>;

        return logs.map((log) => ({
          address: log.address,
          topics: log.topics,
          data: log.data,
          blockNumber: log.blockNumber,
          transactionHash: log.transactionHash,
          transactionIndex: log.transactionIndex,
          blockHash: log.blockHash,
          logIndex: log.logIndex,
          removed: log.removed,
        }));
      }

      default:
        throw new RpcError(
          RPC_ERROR_CODES.UNSUPPORTED_METHOD,
          `Unsupported method: ${method}`
        );
    }
  } catch (err) {
    if (err instanceof RpcError) {
      throw err;
    }
    if (err instanceof Error) {
      throw new RpcError(RPC_ERROR_CODES.INTERNAL, err.message);
    }
    throw new RpcError(RPC_ERROR_CODES.INTERNAL, String(err));
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Serialization helpers (convert viem types to JSON-RPC hex format)
// ────────────────────────────────────────────────────────────────────────────

function serializeBlock(
  block: Block,
  includeTransactions: boolean
): Record<string, unknown> {
  return {
    number: block.number ? "0x" + block.number.toString(16) : null,
    hash: block.hash,
    parentHash: block.parentHash,
    timestamp: "0x" + block.timestamp.toString(16),
    nonce: block.nonce,
    difficulty: "0x" + block.difficulty.toString(16),
    gasLimit: "0x" + block.gasLimit.toString(16),
    gasUsed: "0x" + block.gasUsed.toString(16),
    miner: block.miner,
    extraData: block.extraData,
    transactionRoot: block.transactionsRoot,
    receiptsRoot: block.receiptsRoot,
    logsBloom: block.logsBloom,
    transactions: includeTransactions
      ? block.transactions.map((tx) =>
          typeof tx === "string" ? tx : serializeTransaction(tx)
        )
      : block.transactions.map((tx) => (typeof tx === "string" ? tx : tx.hash)),
    uncles: block.uncles || [],
    baseFeePerGas: block.baseFeePerGas
      ? "0x" + block.baseFeePerGas.toString(16)
      : null,
  };
}

function serializeTransaction(tx: any): Record<string, unknown> {
  return {
    hash: tx.hash,
    nonce: "0x" + tx.nonce.toString(16),
    blockHash: tx.blockHash,
    blockNumber: tx.blockNumber ? "0x" + tx.blockNumber.toString(16) : null,
    transactionIndex: tx.transactionIndex
      ? "0x" + tx.transactionIndex.toString(16)
      : null,
    from: tx.from,
    to: tx.to,
    value: "0x" + tx.value.toString(16),
    gas: "0x" + tx.gas.toString(16),
    gasPrice: tx.gasPrice ? "0x" + tx.gasPrice.toString(16) : null,
    input: tx.input,
    type: tx.type ? parseInt(tx.type).toString() : "0",
    chainId: tx.chainId ? "0x" + tx.chainId.toString(16) : null,
    maxFeePerGas: tx.maxFeePerGas
      ? "0x" + tx.maxFeePerGas.toString(16)
      : null,
    maxPriorityFeePerGas: tx.maxPriorityFeePerGas
      ? "0x" + tx.maxPriorityFeePerGas.toString(16)
      : null,
    v: tx.v ? "0x" + tx.v.toString(16) : null,
    r: tx.r,
    s: tx.s,
  };
}

function serializeTransactionReceipt(receipt: any): Record<
  string,
  unknown
> | null {
  if (!receipt) return null;

  return {
    transactionHash: receipt.transactionHash,
    transactionIndex: "0x" + receipt.transactionIndex.toString(16),
    blockHash: receipt.blockHash,
    blockNumber: "0x" + receipt.blockNumber.toString(16),
    from: receipt.from,
    to: receipt.to,
    cumulativeGasUsed: "0x" + receipt.cumulativeGasUsed.toString(16),
    gasUsed: "0x" + receipt.gasUsed.toString(16),
    contractAddress: receipt.contractAddress,
    logs: receipt.logs.map((log: any) => ({
      address: log.address,
      topics: log.topics,
      data: log.data,
      blockNumber: "0x" + log.blockNumber.toString(16),
      transactionHash: log.transactionHash,
      transactionIndex: "0x" + log.transactionIndex.toString(16),
      blockHash: log.blockHash,
      logIndex: "0x" + log.logIndex.toString(16),
      removed: log.removed,
    })),
    logsBloom: receipt.logsBloom,
    status: receipt.status
      ? receipt.status === "success"
        ? "0x1"
        : "0x0"
      : null,
    type: receipt.type ? parseInt(receipt.type).toString() : "0",
  };
}
