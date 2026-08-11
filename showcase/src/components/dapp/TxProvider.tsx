'use client';

import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { Abi, Address } from 'viem';
import { publicClient, txUrl } from '@/lib/dapp/config';
import { decodeError } from '@/lib/dapp/errors';
import { useWallet } from './WalletProvider';

export type TxStage = 'simulating' | 'signing' | 'pending' | 'success' | 'error';

export interface TxRecord {
  id: string;
  label: string;
  stage: TxStage;
  hash?: `0x${string}`;
  message?: string;
  detail?: string;
}

export interface SendOpts {
  label: string;
  address: Address;
  abi: Abi | readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
}

interface TxState {
  txs: TxRecord[];
  dismiss: (id: string) => void;
  /** Simulate → sign → wait. Returns the receipt's hash on success, null otherwise. */
  send: (opts: SendOpts) => Promise<`0x${string}` | null>;
  busy: boolean;
}

const Ctx = createContext<TxState | null>(null);
let seq = 0;

export function TxProvider({ children }: { children: React.ReactNode }) {
  const { account, getWalletClient, isWrongNetwork, switchNetwork } = useWallet();
  const [txs, setTxs] = useState<TxRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();

  const update = useCallback((id: string, patch: Partial<TxRecord>) => {
    setTxs((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  const dismiss = useCallback((id: string) => {
    setTxs((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const send = useCallback(
    async (opts: SendOpts): Promise<`0x${string}` | null> => {
      const id = `tx-${++seq}`;
      setTxs((prev) => [...prev, { id, label: opts.label, stage: 'simulating' }]);
      setBusy(true);
      try {
        if (!account) throw new Error('Connect your wallet first.');
        if (isWrongNetwork) {
          await switchNetwork();
        }

        // 1) Simulate first — this is what turns an opaque on-chain revert into a
        //    decoded custom error *before* the user is asked to sign or pay gas.
        const { request } = await publicClient.simulateContract({
          account,
          address: opts.address,
          abi: opts.abi as Abi,
          functionName: opts.functionName,
          args: opts.args as never,
          value: opts.value,
        });

        // 2) Sign
        update(id, { stage: 'signing' });
        const wallet = getWalletClient();
        const hash = await wallet.writeContract(request as never);

        // 3) Wait for inclusion
        update(id, { stage: 'pending', hash });
        const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
        if (receipt.status !== 'success') {
          update(id, { stage: 'error', hash, message: 'Transaction reverted on-chain.' });
          return null;
        }

        update(id, { stage: 'success', hash, message: 'Confirmed' });
        // Refresh every on-chain read.
        await qc.invalidateQueries();
        setTimeout(() => dismiss(id), 8000);
        return hash;
      } catch (err) {
        const d = decodeError(err);
        if (d.rejected) {
          dismiss(id);
        } else {
          update(id, { stage: 'error', message: d.message, detail: d.detail });
        }
        return null;
      } finally {
        setBusy(false);
      }
    },
    [account, isWrongNetwork, switchNetwork, getWalletClient, update, dismiss, qc],
  );

  const value = useMemo<TxState>(() => ({ txs, dismiss, send, busy }), [txs, dismiss, send, busy]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTx(): TxState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useTx must be used inside <TxProvider>');
  return v;
}

// ── Toast stack ─────────────────────────────────────────────────────────────
const STAGE_COPY: Record<TxStage, string> = {
  simulating: 'Checking transaction…',
  signing: 'Confirm in your wallet…',
  pending: 'Transaction pending…',
  success: 'Confirmed',
  error: 'Failed',
};

export function TxToasts() {
  const { txs, dismiss } = useTx();
  if (!txs.length) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2">
      {txs.map((t) => {
        const tone =
          t.stage === 'error'
            ? 'border-red-300 bg-red-50'
            : t.stage === 'success'
              ? 'border-green-300 bg-green-50'
              : 'border-suwappu-sakura-mid bg-white';
        return (
          <div
            key={t.id}
            role="status"
            aria-live="polite"
            className={`pointer-events-auto rounded-suwappu-xl border p-3 shadow-suwappu-card ${tone}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{t.label}</p>
                <p className="mt-0.5 text-xs text-suwappu-text-secondary">
                  {t.message ?? STAGE_COPY[t.stage]}
                </p>
                {t.hash && (
                  <a
                    href={txUrl(t.hash)}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-block text-xs font-semibold text-suwappu-magenta underline"
                  >
                    View on BaseScan ↗
                  </a>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {(t.stage === 'simulating' || t.stage === 'signing' || t.stage === 'pending') && (
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-suwappu-magenta border-t-transparent" />
                )}
                <button
                  type="button"
                  onClick={() => dismiss(t.id)}
                  aria-label="Dismiss"
                  className="text-suwappu-text-secondary hover:text-suwappu-text"
                >
                  ✕
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
