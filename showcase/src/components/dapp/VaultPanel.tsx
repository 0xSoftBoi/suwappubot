'use client';

import { useState } from 'react';
import { maxUint256 } from 'viem';
import { erc20Abi, erc4626Abi, vaultAbi } from '@/lib/dapp/abis';
import { CONTRACTS, deadlineFromNow } from '@/lib/dapp/config';
import {
  computeLtv,
  fmt,
  fmtPct,
  fmtRatePerSecondAsApr,
  healthTone,
  parseAmount,
  shortAddress,
} from '@/lib/dapp/format';
import { type PositionRow, useAccountData, usePositions, useVault } from '@/hooks/useProtocol';
import { useSettings } from './SettingsProvider';
import { useTx } from './TxProvider';
import { Button, Card, EmptyState, HealthBar, Skeleton, Stat, TokenInput } from './ui';
import { useWallet } from './WalletProvider';

type Mode = 'lend' | 'borrow' | 'positions';

export function VaultPanel() {
  const { account } = useWallet();
  const { data: vault, isLoading } = useVault();
  const { data: acct } = useAccountData(account);
  const { data: positions, isLoading: posLoading } = usePositions(vault?.nextPositionId);
  const [mode, setMode] = useState<Mode>('lend');

  return (
    <Card
      title="Self-Repaying Vault"
      subtitle="Lend the asset, or borrow against yield-bearing collateral that amortizes its own debt."
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Pool assets" value={`${fmt(vault?.poolAssets, 18, { compact: true })} USDC`} loading={isLoading} />
        <Stat label="Idle cash" value={`${fmt(vault?.cash, 18, { compact: true })} USDC`} loading={isLoading} />
        <Stat label="Borrowed" value={`${fmt(vault?.totalDebtAssets, 18, { compact: true })} USDC`} loading={isLoading} />
        <Stat
          label="Utilization"
          value={
            vault && vault.poolAssets > 0n
              ? fmtPct((vault.totalDebtAssets * 10n ** 18n) / vault.poolAssets)
              : '0.00%'
          }
          loading={isLoading}
        />
        <Stat label="Borrow rate" value={fmtRatePerSecondAsApr(vault?.borrowRate)} hint="simple, linear" loading={isLoading} />
        <Stat label="Max LTV" value={fmtPct(vault?.maxLtv)} loading={isLoading} />
        <Stat label="Liquidation" value={fmtPct(vault?.liqLtv)} loading={isLoading} />
        <Stat label="Liq. bonus" value={fmtPct(vault?.liqBonus)} loading={isLoading} />
      </div>

      <div className="mt-4 inline-flex rounded-suwappu-pill bg-suwappu-blush p-1">
        {(
          [
            ['lend', 'Lend'],
            ['borrow', 'Borrow'],
            ['positions', 'Positions'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setMode(id)}
            className={`rounded-suwappu-pill px-4 py-1.5 text-sm font-semibold transition ${
              mode === id ? 'bg-white shadow-sm' : 'text-suwappu-text-secondary'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-3 rounded-suwappu-xl bg-white/60 p-4">
        {mode === 'lend' && <LendForm />}
        {mode === 'borrow' && <BorrowForm />}
        {mode === 'positions' && (
          <PositionsTable rows={positions} loading={posLoading} vault={vault} account={account} />
        )}
      </div>
    </Card>
  );
}

function LendForm() {
  const { account } = useWallet();
  const { data: acct } = useAccountData(account);
  const { data: vault } = useVault();
  const { send, sendBatch, busy } = useTx();
  const [supplyIn, setSupplyIn] = useState('');
  const [withdrawIn, setWithdrawIn] = useState('');

  const supplyAmt = parseAmount(supplyIn);
  const withdrawAmt = parseAmount(withdrawIn);
  const needsApproval = supplyAmt !== null && (acct?.usdcAllowanceVault ?? 0n) < supplyAmt;

  // Lender share value = shares * poolAssets / totalShares (informational).
  const shareValue =
    acct && vault && vault.totalLendShares > 0n
      ? (acct.vaultShares * vault.poolAssets) / vault.totalLendShares
      : 0n;

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <TokenInput
          label="Supply USDC"
          value={supplyIn}
          onChange={setSupplyIn}
          balance={acct?.usdc}
          symbol="USDC"
          hint="Earns interest from borrowers."
          disabled={busy}
        />
        <div className="mt-3">
          <Button
            disabled={busy || supplyAmt === null}
            onClick={async () => {
              if (supplyAmt === null) return;
              const supplyCall = {
                label: `Supply ${supplyIn} USDC`,
                address: CONTRACTS.amortizingVault,
                abi: vaultAbi,
                functionName: 'supply',
                args: [supplyAmt],
              };
              if (needsApproval) {
                await sendBatch(`Approve & supply ${supplyIn} USDC`, [
                  {
                    label: 'Approve USDC for vault',
                    address: CONTRACTS.reserveAsset,
                    abi: erc20Abi,
                    functionName: 'approve',
                    args: [CONTRACTS.amortizingVault, maxUint256],
                  },
                  supplyCall,
                ]);
              } else {
                await send(supplyCall);
              }
              setSupplyIn('');
            }}
          >
            {needsApproval ? 'Approve & supply' : 'Supply'}
          </Button>
        </div>
      </div>

      <div>
        <TokenInput
          label="Withdraw pool shares"
          value={withdrawIn}
          onChange={setWithdrawIn}
          balance={acct?.vaultShares}
          symbol="shares"
          hint={`Your position ≈ ${fmt(shareValue)} USDC`}
          disabled={busy}
        />
        <div className="mt-3">
          <Button
            variant="ghost"
            disabled={busy || withdrawAmt === null}
            onClick={async () => {
              if (withdrawAmt === null) return;
              await send({
                label: `Withdraw ${withdrawIn} shares`,
                address: CONTRACTS.amortizingVault,
                abi: vaultAbi,
                functionName: 'withdraw',
                args: [withdrawAmt],
              });
              setWithdrawIn('');
            }}
          >
            Withdraw
          </Button>
        </div>
        <p className="mt-2 text-[11px] text-suwappu-text-secondary">
          Withdrawals are served from idle cash; if utilization is high you may need to wait for
          repayments.
        </p>
      </div>
    </div>
  );
}

function BorrowForm() {
  const { account } = useWallet();
  const { data: acct } = useAccountData(account);
  const { data: vault } = useVault();
  const { send, busy } = useTx();
  const { deadlineMinutes } = useSettings();
  const [collIn, setCollIn] = useState('');
  const [borrowIn, setBorrowIn] = useState('');

  const collAmt = parseAmount(collIn);
  const borrowAmt = parseAmount(borrowIn) ?? 0n;
  const needsApproval = collAmt !== null && (acct?.collateralAllowanceVault ?? 0n) < collAmt;

  // Preview LTV. Collateral shares ≈ assets 1:1 at the mock vault's current price,
  // but we show the contract-truthful preview only once the position exists.
  const previewLtv = collAmt && collAmt > 0n ? computeLtv(borrowAmt, collAmt) : null;
  const overMax =
    previewLtv !== null && vault !== undefined && previewLtv > vault.maxLtv;

  const noCollateral = (acct?.collateralShares ?? 0n) === 0n;

  return (
    <div>
      {noCollateral && account && (
        <div className="mb-3 rounded-xl border border-suwappu-sakura-mid bg-suwappu-blush p-3 text-xs">
          You have no collateral shares yet. Deposit USDC into the yield vault first — that&apos;s
          the ERC-4626 whose yield repays your debt.
          <div className="mt-2">
            <MintCollateralButton />
          </div>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <TokenInput
          label="Collateral (yield-vault shares)"
          value={collIn}
          onChange={setCollIn}
          balance={acct?.collateralShares}
          symbol="shares"
          disabled={busy}
        />
        <TokenInput
          label="Borrow USDC"
          value={borrowIn}
          onChange={setBorrowIn}
          symbol="USDC"
          error={overMax ? 'Exceeds max LTV' : null}
          hint={vault ? `Up to ${fmtPct(vault.maxLtv)} of collateral value` : undefined}
          disabled={busy}
        />
      </div>

      {vault && collAmt && collAmt > 0n && (
        <div className="mt-3">
          <HealthBar ltv={previewLtv} maxLtv={vault.maxLtv} liqLtv={vault.liqLtv} />
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {!account ? (
          <p className="text-sm text-suwappu-text-secondary">Connect a wallet to borrow.</p>
        ) : needsApproval ? (
          <Button
            disabled={busy}
            onClick={() =>
              send({
                label: 'Approve collateral for vault',
                address: CONTRACTS.collateralVault,
                abi: erc4626Abi,
                functionName: 'approve',
                args: [CONTRACTS.amortizingVault, maxUint256],
              })
            }
          >
            Approve collateral
          </Button>
        ) : (
          <Button
            disabled={busy || collAmt === null || overMax}
            onClick={async () => {
              if (collAmt === null) return;
              await send({
                label: `Open position (${collIn} shares)`,
                address: CONTRACTS.amortizingVault,
                abi: vaultAbi,
                functionName: 'openPosition',
                args: [collAmt, borrowAmt, deadlineFromNow(deadlineMinutes)],
              });
              setCollIn('');
              setBorrowIn('');
            }}
          >
            Open position
          </Button>
        )}
      </div>
    </div>
  );
}

/** Convenience: turn test USDC into 4626 collateral shares. */
function MintCollateralButton() {
  const { account } = useWallet();
  const { data: acct } = useAccountData(account);
  const { sendBatch, busy } = useTx();
  const [amount, setAmount] = useState('1000');
  const amt = parseAmount(amount);

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="w-32">
        <TokenInput label="Deposit" value={amount} onChange={setAmount} symbol="USDC" disabled={busy} />
      </div>
      <Button
        variant="ghost"
        disabled={busy || amt === null}
        onClick={async () => {
          if (amt === null || !account) return;
          // Approve the 4626 to pull USDC, then deposit to mint collateral shares.
          await sendBatch(`Deposit ${amount} USDC into yield vault`, [
            {
              label: 'Approve USDC for yield vault',
              address: CONTRACTS.reserveAsset,
              abi: erc20Abi,
              functionName: 'approve',
              args: [CONTRACTS.collateralVault, maxUint256],
            },
            {
              label: `Deposit ${amount} USDC`,
              address: CONTRACTS.collateralVault,
              abi: erc4626Abi,
              functionName: 'deposit',
              args: [amt, account],
            },
          ]);
        }}
      >
        Get collateral shares
      </Button>
    </div>
  );
}

function PositionsTable({
  rows,
  loading,
  vault,
  account,
}: {
  rows: PositionRow[] | undefined;
  loading: boolean;
  vault: ReturnType<typeof useVault>['data'];
  account: string | null;
}) {
  const { send, busy } = useTx();
  const { deadlineMinutes } = useSettings();

  if (loading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }
  const open = (rows ?? []).filter((r) => r.shares > 0n || r.debt > 0n);
  if (!open.length) {
    return <EmptyState title="No open positions" body="Borrow against collateral to create one." />;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[42rem] text-left text-sm">
        <thead>
          <tr className="text-[11px] uppercase tracking-wide text-suwappu-text-secondary">
            <th className="pb-2">#</th>
            <th className="pb-2">Owner</th>
            <th className="pb-2">Collateral</th>
            <th className="pb-2">Debt</th>
            <th className="pb-2">Pending yield</th>
            <th className="pb-2 w-40">Health</th>
            <th className="pb-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {open.map((p) => {
            const ltv = computeLtv(p.debt, p.collateralValue);
            const mine = !!account && p.owner.toLowerCase() === account.toLowerCase();
            const liquidatable =
              vault !== undefined && ltv !== null && p.debt > 0n && ltv > vault.liqLtv;
            return (
              <tr key={p.id.toString()} className="border-t border-suwappu-sakura-light/60">
                <td className="py-2 font-mono">{p.id.toString()}</td>
                <td className="py-2 font-mono text-xs">
                  {shortAddress(p.owner)}
                  {mine && <span className="ml-1 text-suwappu-magenta">(you)</span>}
                </td>
                <td className="py-2 font-mono">{fmt(p.collateralValue)}</td>
                <td className="py-2 font-mono">{fmt(p.debt)}</td>
                <td className="py-2 font-mono">{fmt(p.pendingYield)}</td>
                <td className="py-2">
                  {vault && <HealthBar ltv={ltv} maxLtv={vault.maxLtv} liqLtv={vault.liqLtv} />}
                </td>
                <td className="py-2">
                  <div className="flex flex-wrap gap-1.5">
                    {p.pendingYield > 0n && p.debt > 0n && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          send({
                            label: `Amortize position ${p.id}`,
                            address: CONTRACTS.amortizingVault,
                            abi: vaultAbi,
                            functionName: 'amortize',
                            args: [p.id],
                          })
                        }
                        className="rounded-suwappu-pill bg-suwappu-purple px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
                        title="Apply earned yield to this position's debt (anyone can call)"
                      >
                        Amortize
                      </button>
                    )}
                    {mine && p.debt > 0n && <RepayButton id={p.id} debt={p.debt} />}
                    {mine && p.shares > 0n && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          send({
                            label: `Withdraw collateral from ${p.id}`,
                            address: CONTRACTS.amortizingVault,
                            abi: vaultAbi,
                            functionName: 'withdrawCollateral',
                            args: [p.id, p.shares, deadlineFromNow(deadlineMinutes)],
                          })
                        }
                        className="rounded-suwappu-pill glass px-3 py-1 text-xs font-semibold disabled:opacity-50"
                        title="Withdraw all collateral (only if debt is repaid or LTV allows)"
                      >
                        Withdraw
                      </button>
                    )}
                    {liquidatable && !mine && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          send({
                            label: `Liquidate position ${p.id}`,
                            address: CONTRACTS.amortizingVault,
                            abi: vaultAbi,
                            functionName: 'liquidate',
                            args: [p.id, p.debt, deadlineFromNow(deadlineMinutes)],
                          })
                        }
                        className="rounded-suwappu-pill bg-red-500 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
                      >
                        Liquidate
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RepayButton({ id, debt }: { id: bigint; debt: bigint }) {
  const { account } = useWallet();
  const { data: acct } = useAccountData(account);
  const { send, sendBatch, busy } = useTx();
  const needsApproval = (acct?.usdcAllowanceVault ?? 0n) < debt;
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        const repayCall = {
          label: `Repay position ${id}`,
          address: CONTRACTS.amortizingVault,
          abi: vaultAbi,
          functionName: 'repay',
          args: [id, debt],
        };
        if (needsApproval) {
          await sendBatch(`Approve & repay position ${id}`, [
            {
              label: 'Approve USDC for vault',
              address: CONTRACTS.reserveAsset,
              abi: erc20Abi,
              functionName: 'approve',
              args: [CONTRACTS.amortizingVault, maxUint256],
            },
            repayCall,
          ]);
        } else {
          await send(repayCall);
        }
      }}
      className="rounded-suwappu-pill bg-suwappu-magenta px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
    >
      {needsApproval ? 'Approve & repay' : 'Repay all'}
    </button>
  );
}
