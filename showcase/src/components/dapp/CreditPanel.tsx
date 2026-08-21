'use client';

import { useState } from 'react';
import { maxUint256 } from 'viem';
import { LINE_STATUS_LABEL, LineStatus, creditAbi, erc20Abi } from '@/lib/dapp/abis';
import { CONTRACTS } from '@/lib/dapp/config';
import { fmt, isAddressish, parseAmount, secondsToHuman, shortAddress } from '@/lib/dapp/format';
import { useAccountData, useCreditLine } from '@/hooks/useProtocol';
import { useTx } from './TxProvider';
import { Button, Card, Disclosure, EmptyState, Stat, TokenInput } from './ui';
import { useWallet } from './WalletProvider';

export function CreditPanel() {
  const { account } = useWallet();
  const { data: acct } = useAccountData(account);
  const { send, sendBatch, busy } = useTx();
  const [them, setThem] = useState('');
  const { data: line, isLoading, error } = useCreditLine(account, them);

  const valid = isAddressish(them);
  const status = line?.status ?? LineStatus.None;
  const iProposed = !!account && line?.proposer?.toLowerCase() === account.toLowerCase();

  // form state
  const [limit, setLimit] = useState('1000');
  const [feeApr, setFeeApr] = useState('0');
  const [graceDays, setGraceDays] = useState('7');
  const [payAmt, setPayAmt] = useState('');
  const [settleAmt, setSettleAmt] = useState('');
  const [cycle, setCycle] = useState('');

  const limitAmt = parseAmount(limit);
  const token = CONTRACTS.reserveAsset;

  // The contract stores limits against the sorted pair (a = lower address).
  // limitA is the credit `a` extends (max `b` may owe it), and vice-versa — so the
  // credit extended *to me* is the other party's limit. Spending capacity also
  // includes anything they currently owe me, since pay() nets first.
  const iAmLowerAddress =
    !!account && !!them && account.toLowerCase() < them.trim().toLowerCase();
  const creditExtendedToMe = line ? (iAmLowerAddress ? line.limitB : line.limitA) : 0n;
  const availableCredit = line
    ? (creditExtendedToMe > line.iOwe ? creditExtendedToMe - line.iOwe : 0n) + line.theyOwe
    : 0n;

  // APR % → per-second WAD rate (contract caps this well below its MAX_FEE_RATE).
  const feeRatePerSecond = (() => {
    const pct = Number(feeApr);
    if (!Number.isFinite(pct) || pct < 0) return 0n;
    return BigInt(Math.floor((pct / 100) * 1e18)) / 31_536_000n;
  })();

  return (
    <Card
      title="Mutual Credit Network"
      subtitle="Bilateral credit lines with multilateral netting — no collateral, no oracle, no central counterparty."
    >
      <div className="rounded-suwappu-xl bg-white/60 p-4">
        <label className="block">
          <span className="text-xs font-semibold text-suwappu-text-secondary">Counterparty</span>
          <input
            value={them}
            onChange={(e) => setThem(e.target.value)}
            placeholder="0x… address of the person you trade with"
            className={`mt-1 w-full rounded-xl border bg-white px-3 py-2 font-mono text-xs outline-none ${
              them && !valid ? 'border-red-400' : 'border-suwappu-sakura-mid'
            }`}
          />
          {them && !valid && <p className="mt-1 text-xs text-red-500">Not a valid address</p>}
        </label>

        {!account && (
          <p className="mt-3 text-sm text-suwappu-text-secondary">
            Connect a wallet to open and use credit lines.
          </p>
        )}

        {account && valid && (
          <div className="mt-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="rounded-suwappu-pill bg-suwappu-blush px-3 py-1 text-xs font-semibold">
                Line status: {isLoading ? '…' : LINE_STATUS_LABEL[status] ?? 'Unknown'}
              </span>
              {line && status === LineStatus.Active && (
                <>
                  <span className="text-xs text-suwappu-text-secondary">
                    You owe <b className="font-mono">{fmt(line.iOwe)}</b> · They owe{' '}
                    <b className="font-mono">{fmt(line.theyOwe)}</b>
                  </span>
                </>
              )}
            </div>

            {/* ── No line yet → propose ── */}
            {status === LineStatus.None || status === LineStatus.Closed ? (
              <div>
                <p className="mb-2 text-xs text-suwappu-text-secondary">
                  Open a line: you set the credit <em>you</em> extend to them. They accept and set
                  theirs. Terms are fixed forever at opening.
                </p>
                <div className="grid gap-3 sm:grid-cols-3">
                  <TokenInput
                    label="Credit you extend"
                    value={limit}
                    onChange={setLimit}
                    symbol="USDC"
                    disabled={busy}
                  />
                  <label className="text-xs">
                    <span className="mb-1 block font-semibold text-suwappu-text-secondary">
                      Interest (APR %)
                    </span>
                    <input
                      value={feeApr}
                      onChange={(e) => setFeeApr(e.target.value)}
                      inputMode="decimal"
                      className="w-full rounded-xl border border-suwappu-sakura-mid bg-white px-3 py-2 font-mono text-sm"
                    />
                  </label>
                  <label className="text-xs">
                    <span className="mb-1 block font-semibold text-suwappu-text-secondary">
                      Grace period (days)
                    </span>
                    <input
                      value={graceDays}
                      onChange={(e) => setGraceDays(e.target.value)}
                      inputMode="numeric"
                      className="w-full rounded-xl border border-suwappu-sakura-mid bg-white px-3 py-2 font-mono text-sm"
                    />
                  </label>
                </div>
                <div className="mt-3">
                  <Button
                    disabled={busy || limitAmt === null}
                    onClick={async () => {
                      if (limitAmt === null) return;
                      const grace = BigInt(Math.max(0, Math.round(Number(graceDays) * 86400)));
                      await send({
                        label: `Propose credit line to ${shortAddress(them)}`,
                        address: CONTRACTS.mutualCredit,
                        abi: creditAbi,
                        functionName: 'proposeLine',
                        args: [them as `0x${string}`, token, limitAmt, feeRatePerSecond, grace],
                      });
                    }}
                  >
                    Propose line
                  </Button>
                </div>
              </div>
            ) : null}

            {/* ── Proposed → accept / cancel / reject ── */}
            {status === LineStatus.Proposed && (
              <div>
                <p className="mb-2 text-xs text-suwappu-text-secondary">
                  {iProposed
                    ? 'You proposed this line. Waiting for them to accept.'
                    : 'They proposed a line to you. Set the credit you extend in return, then accept.'}
                </p>
                {!iProposed && (
                  <div className="max-w-xs">
                    <TokenInput
                      label="Credit you extend back"
                      value={limit}
                      onChange={setLimit}
                      symbol="USDC"
                      disabled={busy}
                    />
                  </div>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  {!iProposed && (
                    <Button
                      disabled={busy || limitAmt === null}
                      onClick={async () => {
                        if (limitAmt === null) return;
                        await send({
                          label: 'Accept credit line',
                          address: CONTRACTS.mutualCredit,
                          abi: creditAbi,
                          functionName: 'acceptLine',
                          args: [them as `0x${string}`, token, limitAmt],
                        });
                      }}
                    >
                      Accept line
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      send({
                        label: iProposed ? 'Cancel proposal' : 'Reject proposal',
                        address: CONTRACTS.mutualCredit,
                        abi: creditAbi,
                        functionName: iProposed ? 'cancelProposal' : 'rejectProposal',
                        args: [them as `0x${string}`, token],
                      })
                    }
                  >
                    {iProposed ? 'Cancel proposal' : 'Reject'}
                  </Button>
                </div>
              </div>
            )}

            {/* ── Active / Defaulted → pay, settle, demand, default ── */}
            {(status === LineStatus.Active || status === LineStatus.Defaulted) && line && (
              <div className="grid gap-4 sm:grid-cols-2">
                {status === LineStatus.Active && (
                  <div>
                    <TokenInput
                      label="Pay with credit (no tokens move)"
                      value={payAmt}
                      onChange={setPayAmt}
                      symbol="USDC"
                      hint={`Available credit: ${fmt(availableCredit)} USDC`}
                      disabled={busy}
                    />
                    <div className="mt-2">
                      <Button
                        disabled={busy || parseAmount(payAmt) === null}
                        onClick={async () => {
                          const a = parseAmount(payAmt);
                          if (a === null) return;
                          await send({
                            label: `Pay ${payAmt} on credit line`,
                            address: CONTRACTS.mutualCredit,
                            abi: creditAbi,
                            functionName: 'pay',
                            args: [them as `0x${string}`, token, a],
                          });
                          setPayAmt('');
                        }}
                      >
                        Pay on line
                      </Button>
                    </div>
                  </div>
                )}

                <div>
                  <TokenInput
                    label="Settle with real tokens"
                    value={settleAmt}
                    onChange={setSettleAmt}
                    balance={acct?.usdc}
                    symbol="USDC"
                    hint={`You owe ${fmt(line.iOwe)}`}
                    disabled={busy}
                  />
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      disabled={busy || parseAmount(settleAmt) === null || line.iOwe === 0n}
                      onClick={async () => {
                        const a = parseAmount(settleAmt);
                        if (a === null) return;
                        const settleCall = {
                          label: `Settle ${settleAmt} USDC`,
                          address: CONTRACTS.mutualCredit,
                          abi: creditAbi,
                          functionName: 'settle',
                          args: [them as `0x${string}`, token, a],
                        };
                        if ((acct?.usdcAllowanceCredit ?? 0n) < a) {
                          await sendBatch(`Approve & settle ${settleAmt} USDC`, [
                            {
                              label: 'Approve USDC for settlement',
                              address: CONTRACTS.reserveAsset,
                              abi: erc20Abi,
                              functionName: 'approve',
                              args: [CONTRACTS.mutualCredit, maxUint256],
                            },
                            settleCall,
                          ]);
                        } else {
                          await send(settleCall);
                        }
                        setSettleAmt('');
                      }}
                    >
                      Settle
                    </Button>
                    {line.theyOwe > 0n && (
                      <Button
                        variant="ghost"
                        disabled={busy}
                        onClick={() =>
                          send({
                            label: 'Demand settlement',
                            address: CONTRACTS.mutualCredit,
                            abi: creditAbi,
                            functionName: 'demandSettlement',
                            args: [them as `0x${string}`, token],
                          })
                        }
                        title="Start the grace-period clock on what they owe you"
                      >
                        Demand
                      </Button>
                    )}
                    {line.theyOwe > 0n && line.demandTs > 0n && (
                      <Button
                        variant="danger"
                        disabled={busy}
                        onClick={() =>
                          send({
                            label: 'Mark default',
                            address: CONTRACTS.mutualCredit,
                            abi: creditAbi,
                            functionName: 'markDefault',
                            args: [them as `0x${string}`, token],
                          })
                        }
                        title="Only after the grace period lapses unpaid"
                      >
                        Mark default
                      </Button>
                    )}
                  </div>
                  {line.grace > 0n && (
                    <p className="mt-1 text-[11px] text-suwappu-text-secondary">
                      Grace period: {secondsToHuman(Number(line.grace))}
                      {line.demandTs > 0n && ' · settlement demanded'}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {error && valid && (
          <p className="mt-3 text-xs text-red-500">Could not read that line from the chain.</p>
        )}
      </div>

      {/* ── Multilateral netting ── */}
      <Disclosure summary="multilateral netting (netCycle)">
        <p className="text-xs text-suwappu-text-secondary">
          If A owes B, B owes C, and C owes A, anyone can net the whole loop down by its smallest
          leg — no tokens move. Paste 3+ distinct addresses in debt order (each owes the next; the
          last owes the first).
        </p>
        <textarea
          value={cycle}
          onChange={(e) => setCycle(e.target.value)}
          rows={3}
          placeholder={'0xAAA…\n0xBBB…\n0xCCC…'}
          className="mt-2 w-full rounded-xl border border-suwappu-sakura-mid bg-white px-3 py-2 font-mono text-xs"
        />
        <div className="mt-2">
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              const addrs = cycle
                .split(/[\s,]+/)
                .map((s) => s.trim())
                .filter(Boolean);
              if (addrs.length < 3 || !addrs.every(isAddressish)) return;
              void send({
                label: `Net cycle of ${addrs.length}`,
                address: CONTRACTS.mutualCredit,
                abi: creditAbi,
                functionName: 'netCycle',
                args: [token, addrs as `0x${string}`[]],
              });
            }}
          >
            Net the cycle
          </Button>
        </div>
      </Disclosure>

      {!account && (
        <div className="mt-3">
          <EmptyState
            title="Credit lines need two parties"
            body="Open the page in two wallets (or with a friend) to propose, accept, and net."
          />
        </div>
      )}
    </Card>
  );
}
