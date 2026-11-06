import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useReadContracts } from 'wagmi'
import { parseEventLogs, type Address } from 'viem'
import { FLAG_CLEARABLE, LineStatusV2, clearingHouseAbi } from '@suwappu/primitives-client'
import { TOKEN, ch, getLogsWindowed, type LineV2 } from './shared'

/**
 * The whole credit graph for TOKEN, read from chain: every line ever proposed
 * (LineProposed events) plus its live state and accrued owed amounts in both
 * directions. This is what a solver needs to find clearing cycles, and what a
 * treasury needs to see exposure. Testnet-sized; production wants an indexer.
 */

export type Pair = {
  a: Address
  b: Address
  line?: LineV2
  owedAB: bigint // a owes b (accrued)
  owedBA: bigint
}

export type Position = {
  counterparty: Address
  line?: LineV2
  iOwe: bigint
  theyOwe: bigint
  net: bigint // + they owe me
  creditIExtend: bigint
  creditTheyExtend: bigint
  utilizationOut: number // iOwe / creditTheyExtend
  utilizationIn: number // theyOwe / creditIExtend
}

export type Edge = { debtor: Address; creditor: Address; amount: bigint; feeRate: bigint }

const MAX_PAIRS = 300

export function useNetwork(me?: Address) {
  const pairsQ = useQuery({
    queryKey: ['commons-v2-pairs'],
    refetchInterval: 45_000,
    queryFn: async () => {
      const raw = await getLogsWindowed()
      const events = parseEventLogs({ abi: clearingHouseAbi, logs: raw as never, eventName: 'LineProposed' })
      const seen = new Map<string, [Address, Address]>()
      for (const e of events) {
        const { proposer, counterparty, token } = e.args as { proposer: Address; counterparty: Address; token: Address }
        if (token.toLowerCase() !== TOKEN.toLowerCase()) continue
        const [lo, hi] = proposer.toLowerCase() < counterparty.toLowerCase() ? [proposer, counterparty] : [counterparty, proposer]
        seen.set(`${lo}-${hi}`.toLowerCase(), [lo, hi])
      }
      return [...seen.values()].slice(0, MAX_PAIRS)
    },
  })
  const rawPairs = pairsQ.data ?? []

  const reads = useReadContracts({
    contracts: rawPairs.flatMap(([a, b]) => [
      { ...ch, functionName: 'getLine', args: [a, b, TOKEN] },
      { ...ch, functionName: 'owedBy', args: [a, b, TOKEN] },
      { ...ch, functionName: 'owedBy', args: [b, a, TOKEN] },
    ]),
    query: { enabled: rawPairs.length > 0, refetchInterval: 15_000 },
  })

  const pairs: Pair[] = useMemo(
    () =>
      rawPairs.map(([a, b], i) => ({
        a,
        b,
        line: reads.data?.[i * 3]?.result as LineV2 | undefined,
        owedAB: (reads.data?.[i * 3 + 1]?.result as bigint | undefined) ?? 0n,
        owedBA: (reads.data?.[i * 3 + 2]?.result as bigint | undefined) ?? 0n,
      })),
    [rawPairs, reads.data],
  )

  /** Directed debt edges on Active, CLEARABLE lines — the clearing graph. */
  const clearableEdges: Edge[] = useMemo(() => {
    const out: Edge[] = []
    for (const p of pairs) {
      if (!p.line || p.line.status !== LineStatusV2.Active || (p.line.flags & FLAG_CLEARABLE) === 0) continue
      if (p.owedAB > 0n) out.push({ debtor: p.a, creditor: p.b, amount: p.owedAB, feeRate: p.line.feeRate })
      if (p.owedBA > 0n) out.push({ debtor: p.b, creditor: p.a, amount: p.owedBA, feeRate: p.line.feeRate })
    }
    return out
  }, [pairs])

  const positions: Position[] = useMemo(() => {
    if (!me) return []
    const m = me.toLowerCase()
    return pairs
      .filter((p) => p.a.toLowerCase() === m || p.b.toLowerCase() === m)
      .map((p) => {
        const meIsA = p.a.toLowerCase() === m
        const cp = meIsA ? p.b : p.a
        const iOwe = meIsA ? p.owedAB : p.owedBA
        const theyOwe = meIsA ? p.owedBA : p.owedAB
        // a is always the lower address (lo): limitLo = credit lo extends.
        const creditIExtend = p.line ? (meIsA ? p.line.limitLo : p.line.limitHi) : 0n
        const creditTheyExtend = p.line ? (meIsA ? p.line.limitHi : p.line.limitLo) : 0n
        const ratio = (x: bigint, y: bigint) => (y > 0n ? Number((x * 10_000n) / y) / 10_000 : x > 0n ? 1 : 0)
        return {
          counterparty: cp,
          line: p.line,
          iOwe,
          theyOwe,
          net: theyOwe - iOwe,
          creditIExtend,
          creditTheyExtend,
          utilizationOut: ratio(iOwe, creditTheyExtend),
          utilizationIn: ratio(theyOwe, creditIExtend),
        }
      })
  }, [pairs, me])

  return {
    pairs,
    positions,
    clearableEdges,
    loading: pairsQ.isLoading || (rawPairs.length > 0 && reads.isLoading),
    error: pairsQ.error as Error | null,
    truncated: rawPairs.length >= MAX_PAIRS,
  }
}
