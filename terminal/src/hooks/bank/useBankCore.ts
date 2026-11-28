import { useQuery } from '@tanstack/react-query'
import { bank, type BankAccount } from '../../lib/bankApi'

export const bankKeys = {
  accounts: ['bank', 'accounts'] as const,
  assets: ['bank', 'assets'] as const,
  transfers: (accountId?: string) => ['bank', 'transfers', accountId ?? 'all'] as const,
}

export function useBankAccounts() {
  return useQuery({
    queryKey: bankKeys.accounts,
    queryFn: async () => (await bank.accounts()).accounts,
    staleTime: 15_000,
    retry: 1,
  })
}

export function useBankAccount(id: string | undefined) {
  return useQuery({
    queryKey: ['bank', 'account', id],
    queryFn: async () => (await bank.account(id as string)).account,
    enabled: !!id,
    retry: 1,
  })
}

export function useBankAssets() {
  return useQuery({
    queryKey: bankKeys.assets,
    queryFn: async () => (await bank.assets()).assets,
    staleTime: 10 * 60_000,
    retry: 1,
  })
}

export function useBankTransfers(accountId?: string, limit = 10) {
  return useQuery({
    queryKey: [...bankKeys.transfers(accountId), limit],
    queryFn: async () => (await bank.transfers({ accountId, limit })).transfers,
    staleTime: 15_000,
    retry: 1,
  })
}

export function useStatement(accountId: string | undefined, cursor: string | undefined) {
  return useQuery({
    queryKey: ['bank', 'statement', accountId, cursor ?? 'first'],
    queryFn: () => bank.statement(accountId as string, { limit: 20, cursor }),
    enabled: !!accountId,
    retry: 1,
  })
}

export function useReconcile(accountId: string | undefined) {
  return useQuery({
    queryKey: ['bank', 'reconcile', accountId],
    queryFn: () => bank.reconcile(accountId as string),
    enabled: !!accountId,
    retry: 1,
  })
}

/** Accounts grouped by fiat currency with bigint totals (only same-currency stablecoins are summed). */
export function groupByCurrency(accounts: BankAccount[]): Array<{ currency: string; accounts: BankAccount[]; decimals: number | null; totalMinor: string }> {
  const m = new Map<string, BankAccount[]>()
  for (const a of accounts) {
    const k = a.currency || a.asset
    m.set(k, [...(m.get(k) ?? []), a])
  }
  return [...m.entries()].map(([currency, list]) => {
    const decs = new Set(list.map((a) => a.decimals))
    const same = decs.size === 1 && !decs.has(null)
    return {
      currency,
      accounts: list,
      decimals: same ? (list[0].decimals as number) : null,
      totalMinor: same ? list.reduce((s, a) => s + BigInt(a.balanceMinor), 0n).toString() : '0',
    }
  })
}
