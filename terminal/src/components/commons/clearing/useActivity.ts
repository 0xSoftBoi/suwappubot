import { useQuery } from '@tanstack/react-query'
import { decodeFunctionData, encodeEventTopics, formatUnits, pad, parseEventLogs, type Address, type Hex } from 'viem'
import { clearingHouseAbi, clearingLineKey } from '@suwappu/primitives-client'
import { TOKEN, getLogsWindowed, logsClient } from './shared'

/**
 * Audit trail for one address: every event on its lines (all line events index
 * the line key first), its withdrawals / routing settings, and every clear()
 * that touched one of its lines — decoded from the clear tx input, since the
 * Cleared event itself doesn't name participants.
 */

export type ActivityRow = {
  block: bigint
  time?: number
  tx: Hex
  kind: string
  counterparty?: Address
  amount?: bigint
  /** Signed change to MY net position with `counterparty` (+ = they owe me more / I owe less). */
  delta?: bigint
  detail: string
}

const fmtAmt = (v: bigint) => Number(formatUnits(v, 18)).toLocaleString(undefined, { maximumFractionDigits: 4 })
const eq = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase()

export function useActivity(me: Address | undefined, counterparties: Address[]) {
  return useQuery({
    queryKey: ['commons-v2-activity', me, counterparties.map((c) => c.toLowerCase()).sort().join(',')],
    enabled: !!me,
    refetchInterval: 45_000,
    queryFn: async (): Promise<ActivityRow[]> => {
      const m = me!
      const keys = counterparties.map((cp) => clearingLineKey(m, cp, TOKEN))
      const keyToCp = new Map(keys.map((k, i) => [k.toLowerCase(), counterparties[i]]))
      const meTopic = pad(m, { size: 32 })

      const [lineLogs, nodeLogs, clearLogs] = await Promise.all([
        keys.length ? getLogsWindowed([null, keys]) : Promise.resolve([]),
        getLogsWindowed([null, meTopic]), // Withdrawn(creditor), RoutingPolicySet(node), RouteCapSet(node)
        getLogsWindowed([encodeEventTopics({ abi: clearingHouseAbi, eventName: 'Cleared' })[0]]),
      ])

      const rows: ActivityRow[] = []
      for (const e of parseEventLogs({ abi: clearingHouseAbi, logs: lineLogs as never })) {
        const a = e.args as Record<string, unknown>
        const cp = keyToCp.get(String(a.key).toLowerCase())
        const base = { block: e.blockNumber!, tx: e.transactionHash!, counterparty: cp }
        switch (e.eventName) {
          case 'LineProposed':
            rows.push({ ...base, kind: 'Proposed', amount: a.proposerLimit as bigint, detail: `${eq(a.proposer as string, m) ? 'You' : 'They'} proposed · v${a.nonce}` })
            break
          case 'LineOpened':
            rows.push({ ...base, kind: 'Opened', detail: 'Line accepted (terms-hash bound)' })
            break
          case 'LimitSet':
            rows.push({ ...base, kind: 'Limit', amount: a.newLimit as bigint, detail: `${eq(a.party as string, m) ? 'You' : 'They'} set credit limit` })
            break
          case 'Payment':
            {
              const out = eq(a.from as string, m)
              rows.push({ ...base, kind: 'Payment', amount: a.amount as bigint, delta: out ? -(a.amount as bigint) : (a.amount as bigint), detail: out ? 'You paid on credit (you owe more)' : 'Paid to you on credit (they owe more)' })
            }
            break
          case 'Settled':
            {
              const mine = eq(a.debtor as string, m)
              rows.push({ ...base, kind: 'Settled', amount: a.amount as bigint, delta: mine ? (a.amount as bigint) : -(a.amount as bigint), detail: mine ? 'You settled in tokens (to their escrow)' : 'Settled to you in tokens (escrow)' })
            }
            break
          case 'SettlementDemanded':
            rows.push({ ...base, kind: 'Demand', amount: a.owed as bigint, detail: eq(a.creditor as string, m) ? 'You demanded settlement' : 'Settlement demanded from you' })
            break
          case 'Defaulted':
            rows.push({ ...base, kind: 'Default', amount: a.owed as bigint, detail: eq(a.debtor as string, m) ? 'You were marked in default' : 'Counterparty marked in default' })
            break
          case 'Cured':
            rows.push({ ...base, kind: 'Cured', detail: 'Default cured by full repayment' })
            break
          case 'WrittenOff':
            {
              const byMe = eq(a.creditor as string, m)
              rows.push({ ...base, kind: 'Write-off', amount: a.amount as bigint, delta: byMe ? -(a.amount as bigint) : (a.amount as bigint), detail: byMe ? 'You wrote off their debt' : 'Your debt was written off' })
            }
            break
          case 'LineClosed':
            rows.push({ ...base, kind: 'Closed', detail: 'Line closed' })
            break
        }
      }
      for (const e of parseEventLogs({ abi: clearingHouseAbi, logs: nodeLogs as never })) {
        const a = e.args as Record<string, unknown>
        const base = { block: e.blockNumber!, tx: e.transactionHash! }
        if (e.eventName === 'Withdrawn') rows.push({ ...base, kind: 'Withdraw', amount: a.amount as bigint, detail: `Withdrew escrow to ${String(a.to).slice(0, 8)}…` })
        if (e.eventName === 'RoutingPolicySet') rows.push({ ...base, kind: 'Routing', detail: a.enabled ? `Routing on · ${Number(a.feeBps) / 100}% fee` : 'Routing off' })
        if (e.eventName === 'RouteCapSet') rows.push({ ...base, kind: 'Route cap', counterparty: a.to as Address, amount: a.cap as bigint, detail: 'Routing cap set toward counterparty' })
      }

      // Clears: decode tx input, keep edges touching me.
      const clears = parseEventLogs({ abi: clearingHouseAbi, logs: clearLogs as never, eventName: 'Cleared' })
      for (const c of clears.slice(-50)) {
        const tx = await logsClient.getTransaction({ hash: c.transactionHash! })
        let edges: { debtor: Address; creditor: Address; amount: bigint }[] = []
        try {
          const d = decodeFunctionData({ abi: clearingHouseAbi, data: tx.input })
          if (d.functionName === 'clear') edges = (d.args?.[1] ?? []) as typeof edges
        } catch {
          continue // relayed via a contract — can't attribute; skip rather than guess
        }
        // One row per edge touching me, so per-counterparty statements reconcile.
        for (const e of edges) {
          const iAmDebtor = eq(e.debtor, m)
          if (!iAmDebtor && !eq(e.creditor, m)) continue
          rows.push({
            block: c.blockNumber!,
            tx: c.transactionHash!,
            kind: 'Cleared',
            counterparty: iAmDebtor ? e.creditor : e.debtor,
            amount: e.amount,
            delta: iAmDebtor ? e.amount : -e.amount,
            detail: iAmDebtor
              ? `Clearing: your debt reduced ${fmtAmt(e.amount)} (offset elsewhere in the cycle)`
              : `Clearing: their debt reduced ${fmtAmt(e.amount)} (offset elsewhere in the cycle)`,
          })
        }
      }

      // Timestamps for the most recent rows.
      rows.sort((x, y) => (y.block > x.block ? 1 : y.block < x.block ? -1 : 0))
      const blocks = [...new Set(rows.slice(0, 150).map((r) => r.block))]
      const times = new Map<bigint, number>()
      await Promise.all(
        blocks.map(async (b) => {
          const blk = await logsClient.getBlock({ blockNumber: b }).catch(() => null)
          if (blk) times.set(b, Number(blk.timestamp))
        }),
      )
      return rows.map((r) => ({ ...r, time: times.get(r.block) }))
    },
  })
}
