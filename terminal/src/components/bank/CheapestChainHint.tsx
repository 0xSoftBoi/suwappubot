import { useEffect, useState } from 'react'
import { keepPreviousData } from '@tanstack/react-query'
import { useBankQuery as useQuery } from '../../hooks/bank/useBankQuery'
import { bank, formatMinor, type BankAccount } from '../../lib/bankApi'
import { useBankAssets } from '../../hooks/bank/useBankCore'

/** Fee-model hint: which network is cheapest for this asset and amount (POST /chains/fee-model). Silent when the API cannot say. */
export function CheapestChainHint({ acct, amountMinor: typed }: { acct: BankAccount | undefined; amountMinor: string | null }) {
  const [amountMinor, setAmountMinor] = useState(typed)
  useEffect(() => { const t = setTimeout(() => setAmountMinor(typed), 350); return () => clearTimeout(t) }, [typed])
  const assets = useBankAssets()
  const chains = acct ? (assets.data ?? []).filter((a) => a.symbol === acct.asset).map((a) => a.chain) : []
  const q = useQuery({
    queryKey: ['bank', 'fee-model', acct?.asset, amountMinor, chains.join(',')],
    queryFn: async () => (await bank.feeModel({ asset: acct!.asset, amountMinor: amountMinor!, chains })).model,
    enabled: !!acct && !!amountMinor && chains.length > 0,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    retry: 0,
  })
  const m = q.data
  if (!acct || !m?.recommended) return null
  const rec = m.chains.find((c) => c.chain === m.recommended?.chain)
  const dec = assets.data?.find((a) => a.symbol === acct.asset && a.chain === m.recommended?.chain)?.decimals ?? null
  const same = m.recommended.chain === acct.chain
  return (
    <p className="text-xs rounded-terminal-control bg-terminal-bg-tertiary p-2 break-words" role="status">
      {same ? `${acct.chain} is the cheapest network for this amount.` : `Cheapest network for this amount: ${m.recommended.chain}${rec?.feeMinor ? ` (about ${formatMinor(rec.feeMinor, dec)} ${acct.asset} in fees)` : ''}.`} {m.recommended.reason}
    </p>
  )
}
