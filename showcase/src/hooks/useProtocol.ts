'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { Address } from 'viem';
import { creditAbi, curveAbi, erc20Abi, erc4626Abi, vaultAbi } from '@/lib/dapp/abis';
import { CONTRACTS, publicClient } from '@/lib/dapp/config';

const STALE = 10_000;

/**
 * Invalidate every on-chain query when a new block lands, so the UI tracks the
 * chain instead of a dumb fixed-interval poll.
 */
export function useBlockSync() {
  const qc = useQueryClient();
  useEffect(() => {
    const unwatch = publicClient.watchBlockNumber({
      emitOnBegin: false,
      poll: true,
      pollingInterval: 6_000,
      onBlockNumber: () => {
        qc.invalidateQueries({ queryKey: ['chain'] });
      },
    });
    return () => unwatch();
  }, [qc]);
}

// ── Curve ───────────────────────────────────────────────────────────────────
export interface CurveData {
  name: string;
  symbol: string;
  totalSupply: bigint;
  spotPrice: bigint;
  multiplier: bigint;
  reserveBalance: bigint;
  totalSunk: bigint;
  basePrice: bigint;
  slope: bigint;
  rate: bigint;
  sinkRate: bigint;
}

export function useCurve() {
  return useQuery({
    queryKey: ['chain', 'curve'],
    staleTime: STALE,
    queryFn: async (): Promise<CurveData> => {
      const c = { address: CONTRACTS.timeCurve, abi: curveAbi } as const;
      const r = await publicClient.multicall({
        allowFailure: false,
        contracts: [
          { ...c, functionName: 'name' },
          { ...c, functionName: 'symbol' },
          { ...c, functionName: 'totalSupply' },
          { ...c, functionName: 'spotPrice' },
          { ...c, functionName: 'multiplier' },
          { ...c, functionName: 'reserveBalance' },
          { ...c, functionName: 'totalSunk' },
          { ...c, functionName: 'basePrice' },
          { ...c, functionName: 'slope' },
          { ...c, functionName: 'rate' },
          { ...c, functionName: 'sinkRate' },
        ],
      });
      return {
        name: r[0] as string,
        symbol: r[1] as string,
        totalSupply: r[2] as bigint,
        spotPrice: r[3] as bigint,
        multiplier: r[4] as bigint,
        reserveBalance: r[5] as bigint,
        totalSunk: r[6] as bigint,
        basePrice: r[7] as bigint,
        slope: r[8] as bigint,
        rate: r[9] as bigint,
        sinkRate: r[10] as bigint,
      };
    },
  });
}

/** Live quote; `null` amount disables the query. */
export function useCurveQuote(side: 'buy' | 'sell', amount: bigint | null) {
  return useQuery({
    queryKey: ['chain', 'curveQuote', side, amount?.toString() ?? null],
    enabled: amount !== null && amount > 0n,
    staleTime: 5_000,
    retry: false,
    queryFn: async () =>
      (await publicClient.readContract({
        address: CONTRACTS.timeCurve,
        abi: curveAbi,
        functionName: side === 'buy' ? 'quoteBuy' : 'quoteSell',
        args: [amount as bigint],
      })) as bigint,
  });
}

// ── Vault ───────────────────────────────────────────────────────────────────
export interface VaultData {
  cash: bigint;
  poolAssets: bigint;
  totalDebtAssets: bigint;
  totalLendShares: bigint;
  nextPositionId: bigint;
  maxLtv: bigint;
  liqLtv: bigint;
  liqBonus: bigint;
  borrowRate: bigint;
}

export function useVault() {
  return useQuery({
    queryKey: ['chain', 'vault'],
    staleTime: STALE,
    queryFn: async (): Promise<VaultData> => {
      const v = { address: CONTRACTS.amortizingVault, abi: vaultAbi } as const;
      const r = await publicClient.multicall({
        allowFailure: false,
        contracts: [
          { ...v, functionName: 'cash' },
          { ...v, functionName: 'poolAssets' },
          { ...v, functionName: 'totalDebtAssets' },
          { ...v, functionName: 'totalLendShares' },
          { ...v, functionName: 'nextPositionId' },
          { ...v, functionName: 'maxLtv' },
          { ...v, functionName: 'liqLtv' },
          { ...v, functionName: 'liqBonus' },
          { ...v, functionName: 'borrowRate' },
        ],
      });
      return {
        cash: r[0] as bigint,
        poolAssets: r[1] as bigint,
        totalDebtAssets: r[2] as bigint,
        totalLendShares: r[3] as bigint,
        nextPositionId: r[4] as bigint,
        maxLtv: r[5] as bigint,
        liqLtv: r[6] as bigint,
        liqBonus: r[7] as bigint,
        borrowRate: r[8] as bigint,
      };
    },
  });
}

export interface PositionRow {
  id: bigint;
  owner: Address;
  shares: bigint;
  baselineAssets: bigint;
  debt: bigint;
  pendingYield: bigint;
  collateralValue: bigint;
}

/** All open positions with derived collateral value (batched into one multicall). */
export function usePositions(nextPositionId: bigint | undefined) {
  const count = nextPositionId ? Number(nextPositionId) : 0;
  return useQuery({
    queryKey: ['chain', 'positions', count],
    enabled: count > 0,
    staleTime: STALE,
    queryFn: async (): Promise<PositionRow[]> => {
      const ids = Array.from({ length: count }, (_, i) => BigInt(i));
      const v = { address: CONTRACTS.amortizingVault, abi: vaultAbi } as const;
      const calls = ids.flatMap((id) => [
        { ...v, functionName: 'positions' as const, args: [id] as const },
        { ...v, functionName: 'debtOf' as const, args: [id] as const },
        { ...v, functionName: 'pendingYield' as const, args: [id] as const },
      ]);
      const res = await publicClient.multicall({ allowFailure: false, contracts: calls as never });

      const rows: PositionRow[] = ids.map((id, i) => {
        const [owner, shares, baselineAssets] = res[i * 3] as readonly [
          Address,
          bigint,
          bigint,
          bigint,
        ];
        return {
          id,
          owner,
          shares,
          baselineAssets,
          debt: res[i * 3 + 1] as bigint,
          pendingYield: res[i * 3 + 2] as bigint,
          collateralValue: 0n,
        };
      });

      // Collateral value needs the 4626's share price — one extra batched pass.
      const withShares = rows.filter((r) => r.shares > 0n);
      if (withShares.length) {
        const vals = await publicClient.multicall({
          allowFailure: false,
          contracts: withShares.map((r) => ({
            address: CONTRACTS.collateralVault,
            abi: erc4626Abi,
            functionName: 'convertToAssets' as const,
            args: [r.shares] as const,
          })) as never,
        });
        withShares.forEach((r, i) => {
          r.collateralValue = vals[i] as bigint;
        });
      }
      return rows;
    },
  });
}

// ── Account balances / allowances ───────────────────────────────────────────
export interface AccountData {
  usdc: bigint;
  usdcAllowanceCurve: bigint;
  usdcAllowanceVault: bigint;
  usdcAllowanceCredit: bigint;
  curveTokens: bigint;
  vaultShares: bigint;
  collateralShares: bigint;
  collateralAllowanceVault: bigint;
  eth: bigint;
}

export function useAccountData(account: Address | null | undefined) {
  return useQuery({
    queryKey: ['chain', 'account', account ?? 'none'],
    enabled: !!account,
    staleTime: STALE,
    queryFn: async (): Promise<AccountData> => {
      const a = account as Address;
      const usd = { address: CONTRACTS.reserveAsset, abi: erc20Abi } as const;
      const col = { address: CONTRACTS.collateralVault, abi: erc4626Abi } as const;
      const [r, eth] = await Promise.all([
        publicClient.multicall({
          allowFailure: false,
          contracts: [
            { ...usd, functionName: 'balanceOf', args: [a] },
            { ...usd, functionName: 'allowance', args: [a, CONTRACTS.timeCurve] },
            { ...usd, functionName: 'allowance', args: [a, CONTRACTS.amortizingVault] },
            { ...usd, functionName: 'allowance', args: [a, CONTRACTS.mutualCredit] },
            { address: CONTRACTS.timeCurve, abi: curveAbi, functionName: 'balanceOf', args: [a] },
            {
              address: CONTRACTS.amortizingVault,
              abi: vaultAbi,
              functionName: 'lendShares',
              args: [a],
            },
            { ...col, functionName: 'balanceOf', args: [a] },
            { ...col, functionName: 'allowance', args: [a, CONTRACTS.amortizingVault] },
          ] as never,
        }),
        publicClient.getBalance({ address: a }),
      ]);
      return {
        usdc: r[0] as bigint,
        usdcAllowanceCurve: r[1] as bigint,
        usdcAllowanceVault: r[2] as bigint,
        usdcAllowanceCredit: r[3] as bigint,
        curveTokens: r[4] as bigint,
        vaultShares: r[5] as bigint,
        collateralShares: r[6] as bigint,
        collateralAllowanceVault: r[7] as bigint,
        eth,
      };
    },
  });
}

// ── Credit ──────────────────────────────────────────────────────────────────
export interface LineData {
  limitA: bigint;
  limitB: bigint;
  balance: bigint;
  feeRate: bigint;
  grace: bigint;
  status: number;
  proposer: Address;
  demandTs: bigint;
  /** what `me` owes `them` */
  iOwe: bigint;
  /** what `them` owes `me` */
  theyOwe: bigint;
}

export function useCreditLine(me: Address | null | undefined, them: string) {
  const valid = !!me && /^0x[a-fA-F0-9]{40}$/.test(them.trim());
  return useQuery({
    queryKey: ['chain', 'line', me ?? 'none', them.toLowerCase()],
    enabled: valid,
    staleTime: STALE,
    retry: false,
    queryFn: async (): Promise<LineData> => {
      const a = me as Address;
      const b = them.trim() as Address;
      const c = { address: CONTRACTS.mutualCredit, abi: creditAbi } as const;
      const key = (await publicClient.readContract({
        ...c,
        functionName: 'lineKey',
        args: [a, b, CONTRACTS.reserveAsset],
      })) as `0x${string}`;
      const r = await publicClient.multicall({
        allowFailure: false,
        contracts: [
          { ...c, functionName: 'lines', args: [key] },
          { ...c, functionName: 'owedBy', args: [a, b, CONTRACTS.reserveAsset] },
          { ...c, functionName: 'owedBy', args: [b, a, CONTRACTS.reserveAsset] },
        ] as never,
      });
      const line = r[0] as readonly [
        bigint, bigint, bigint, bigint, bigint, bigint, bigint, number, Address, Address,
      ];
      return {
        limitA: line[0],
        limitB: line[1],
        balance: line[2],
        feeRate: line[3],
        grace: line[4],
        demandTs: line[6],
        status: Number(line[7]),
        proposer: line[9],
        iOwe: r[1] as bigint,
        theyOwe: r[2] as bigint,
      };
    },
  });
}
