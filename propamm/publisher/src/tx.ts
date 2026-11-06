import {
  decodeFunctionData,
  encodeFunctionData,
  keccak256,
  parseAbi,
  serializeTransaction,
  toFunctionSelector,
  type Address,
  type Hex,
  type TransactionSerializableEIP1559,
} from "viem";
import type { Signer } from "./signer/types";

export const oracleAbi = parseAbi([
  "function push(uint256 feedId, uint128 price, uint64 validBlock)",
  "function getPrice(uint256 feedId) view returns (uint128 price, uint64 blockNumber, uint48 timestamp)",
  "function maxStepBps() view returns (uint16)",
  "function isPusher(address) view returns (bool)",
]);

export const PUSH_SELECTOR = toFunctionSelector("push(uint256,uint128,uint64)");
const MAX_U128 = (1n << 128n) - 1n;
const MAX_U64 = (1n << 64n) - 1n;

export interface TxPolicy {
  chainId: number;
  oracle: Address;
  feedId: bigint;
  maxGas: bigint;
  maxFeeCapWei: bigint;
}

export interface UnsignedPush {
  to: Address;
  data: Hex;
  value?: bigint;
  chainId: number;
  nonce: number;
  gas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  /** the block this candidate is for (head+1). calldata validBlock MUST equal it. */
  targetBlock: bigint;
}

export function encodePush(feedId: bigint, price: bigint, validBlock: bigint): Hex {
  if (price <= 0n || price > MAX_U128) throw new Error("price out of uint128 range");
  if (validBlock <= 0n || validBlock > MAX_U64) throw new Error("validBlock out of range");
  return encodeFunctionData({ abi: oracleAbi, functionName: "push", args: [feedId, price, validBlock] });
}

/** Hard guard: the ONLY thing this process will ever sign is oracle.push(feedId, price, validBlock) for its own feed,
 *  valid in exactly the target block, 0 value, 0 priority fee. */
export function assertAllowed(tx: UnsignedPush, pol: TxPolicy): void {
  if (tx.chainId !== pol.chainId) throw new Error("refuse to sign: chainId mismatch");
  if (tx.to.toLowerCase() !== pol.oracle.toLowerCase()) throw new Error("refuse to sign: target is not the oracle");
  if (tx.data.slice(0, 10).toLowerCase() !== PUSH_SELECTOR.toLowerCase()) throw new Error("refuse to sign: selector is not push(uint256,uint128,uint64)");
  if (tx.data.length !== 2 + 8 + 64 * 3) throw new Error("refuse to sign: unexpected calldata length");
  let args: readonly unknown[];
  try {
    const d = decodeFunctionData({ abi: oracleAbi, data: tx.data });
    if (d.functionName !== "push") throw new Error("not push");
    args = d.args as readonly unknown[];
  } catch {
    throw new Error("refuse to sign: calldata does not decode as push");
  }
  const [feedId, price, validBlock] = args as [bigint, bigint, bigint];
  if (feedId !== pol.feedId) throw new Error("refuse to sign: feedId is not the configured feed");
  if (price <= 0n || price > MAX_U128) throw new Error("refuse to sign: price out of range");
  if (validBlock !== tx.targetBlock) throw new Error("refuse to sign: validBlock != target block");
  if ((tx.value ?? 0n) !== 0n) throw new Error("refuse to sign: non-zero value");
  if (tx.maxPriorityFeePerGas !== 0n) throw new Error("refuse to sign: priority fee must be 0");
  if (tx.gas <= 0n || tx.gas > pol.maxGas) throw new Error("refuse to sign: gas out of bounds");
  if (tx.maxFeePerGas <= 0n || tx.maxFeePerGas > pol.maxFeeCapWei) throw new Error("refuse to sign: maxFeePerGas out of bounds");
  if (!Number.isSafeInteger(tx.nonce) || tx.nonce < 0) throw new Error("refuse to sign: bad nonce");
}

export interface SignedPush {
  raw: Hex;
  hash: Hex;
}

export async function signPush(signer: Signer, tx: UnsignedPush, pol: TxPolicy): Promise<SignedPush> {
  assertAllowed(tx, pol);
  const base: TransactionSerializableEIP1559 = {
    type: "eip1559",
    chainId: tx.chainId,
    nonce: tx.nonce,
    to: tx.to,
    value: 0n,
    data: tx.data,
    gas: tx.gas,
    maxFeePerGas: tx.maxFeePerGas,
    maxPriorityFeePerGas: 0n,
    accessList: [],
  };
  const digest = keccak256(serializeTransaction(base));
  const sig = await signer.signDigest(digest);
  const raw = serializeTransaction(base, { r: sig.r, s: sig.s, yParity: sig.yParity });
  return { raw, hash: keccak256(raw) };
}

/** EIP-1559 next-block base fee projection from the head header. */
export function projectBaseFee(h: { baseFeePerGas: bigint; gasUsed: bigint; gasLimit: bigint }): bigint {
  const target = h.gasLimit / 2n;
  if (target === 0n || h.gasUsed === target) return h.baseFeePerGas;
  if (h.gasUsed > target) {
    const d = (h.baseFeePerGas * (h.gasUsed - target)) / target / 8n;
    return h.baseFeePerGas + (d > 1n ? d : 1n);
  }
  const d = (h.baseFeePerGas * (target - h.gasUsed)) / target / 8n;
  return h.baseFeePerGas - d;
}

/** ceil(1.25 * projected) */
export function maxFeeFor(projected: bigint): bigint {
  return (projected * 125n + 99n) / 100n;
}
