import type { Address, Hex } from 'viem';
import { CHAIN_ID_HEX } from './config';

/**
 * EIP-5792 (wallet_sendCalls) support.
 *
 * Lets a wallet execute several calls from one user signature — so
 * "approve then swap" becomes a single atomic confirmation instead of two.
 *
 * The spec shipped in two shapes and wallets are inconsistent about which they
 * implement, so every read here is defensive and every failure degrades to the
 * sequential path rather than throwing.
 */

export interface Eip1193Like {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
}

export interface BatchCall {
  to: Address;
  data: Hex;
  value?: bigint;
}

/** Does this wallet support *atomic* batching on our chain? */
export async function supportsAtomicBatch(
  provider: Eip1193Like,
  account: Address,
): Promise<boolean> {
  try {
    const caps = (await provider.request({
      method: 'wallet_getCapabilities',
      params: [account, [CHAIN_ID_HEX]],
    })) as Record<string, any> | undefined;
    if (!caps) return false;

    // Keys may be '0x14a34' or decimal-ish; match case-insensitively.
    const entry =
      caps[CHAIN_ID_HEX] ??
      caps[CHAIN_ID_HEX.toLowerCase()] ??
      Object.entries(caps).find(([k]) => k.toLowerCase() === CHAIN_ID_HEX.toLowerCase())?.[1];
    if (!entry) return false;

    // Newer spec: { atomic: { status: 'supported' | 'ready' | 'unsupported' } }
    const status = entry.atomic?.status;
    if (typeof status === 'string') return status === 'supported' || status === 'ready';

    // Older spec: { atomicBatch: { supported: true } }
    if (entry.atomicBatch?.supported === true) return true;

    return false;
  } catch {
    // Wallet doesn't implement the method at all.
    return false;
  }
}

/** Submit a batch. Returns the bundle id. */
export async function sendCalls(
  provider: Eip1193Like,
  account: Address,
  calls: BatchCall[],
): Promise<string> {
  const payload = {
    from: account,
    chainId: CHAIN_ID_HEX,
    atomicRequired: true,
    calls: calls.map((c) => ({
      to: c.to,
      data: c.data,
      ...(c.value !== undefined ? { value: `0x${c.value.toString(16)}` } : {}),
    })),
  };

  // Try the 2.0.0 shape, then fall back to 1.0 for older wallets.
  for (const version of ['2.0.0', '1.0']) {
    try {
      const res = (await provider.request({
        method: 'wallet_sendCalls',
        params: [{ version, ...payload }],
      })) as string | { id?: string };
      const id = typeof res === 'string' ? res : res?.id;
      if (id) return id;
    } catch (err) {
      const msg = String((err as Error)?.message ?? '');
      // Only try the other shape on a params/version complaint.
      if (!/version|param|invalid|unsupported/i.test(msg)) throw err;
    }
  }
  throw new Error('Wallet rejected the batched call format.');
}

export interface CallsStatus {
  done: boolean;
  success: boolean;
  txHash?: Hex;
}

function parseStatus(res: any): CallsStatus {
  if (!res) return { done: false, success: false };
  const receipts = res.receipts ?? [];
  const last = receipts[receipts.length - 1];
  const txHash: Hex | undefined = last?.transactionHash;

  const raw = res.status;
  // Newer spec uses numeric codes (100 pending, 200 confirmed, 4xx/5xx failed);
  // older used strings ('PENDING' | 'CONFIRMED').
  if (typeof raw === 'number') {
    if (raw === 200) {
      const reverted = receipts.some((r: any) => r.status === '0x0' || r.status === 0);
      return { done: true, success: !reverted, txHash };
    }
    if (raw >= 300) return { done: true, success: false, txHash };
    return { done: false, success: false, txHash };
  }
  if (typeof raw === 'string') {
    const s = raw.toUpperCase();
    if (s === 'CONFIRMED' || s === 'SUCCESS') {
      const reverted = receipts.some((r: any) => r.status === '0x0' || r.status === 0);
      return { done: true, success: !reverted, txHash };
    }
    if (s === 'FAILED' || s === 'REVERTED') return { done: true, success: false, txHash };
    return { done: false, success: false, txHash };
  }
  // Some wallets return only receipts once complete.
  if (receipts.length) {
    const reverted = receipts.some((r: any) => r.status === '0x0' || r.status === 0);
    return { done: true, success: !reverted, txHash };
  }
  return { done: false, success: false, txHash };
}

/** Poll until the bundle settles (or we give up). */
export async function waitForCalls(
  provider: Eip1193Like,
  id: string,
  { timeoutMs = 180_000, intervalMs = 2_000 } = {},
): Promise<CallsStatus> {
  const deadline = Date.now() + timeoutMs;
  let last: CallsStatus = { done: false, success: false };
  while (Date.now() < deadline) {
    try {
      const res = await provider.request({ method: 'wallet_getCallsStatus', params: [id] });
      last = parseStatus(res);
      if (last.done) return last;
    } catch {
      // transient — keep polling
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return last;
}
