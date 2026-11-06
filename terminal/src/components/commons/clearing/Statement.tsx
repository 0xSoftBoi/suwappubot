import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Address } from 'viem'
import { clearingHouseAbi } from '@suwappu/primitives-client'
import { TerminalButton, TerminalInset, TerminalKeyValueRow, TerminalSegmentedTabs } from '../../foundation'
import { fmt, toNum, txUrl } from '../contracts'
import { downloadCsv } from './csv'
import { useLocalMeta } from './local'
import { CH, DEPLOYMENT, TOKEN, logsClient } from './shared'
import type { ActivityRow } from './useActivity'

/**
 * W6 counterparty statement. Opening and closing balances are read from chain
 * AT the period's boundary blocks (historical eth_call — verified to work on
 * the public RPCs), movements come from events, and interest is the
 * reconciling line (accrual emits no event): closing − opening − Σ movements.
 */

type Period = '7d' | '30d' | 'all'
const SECS: Record<Exclude<Period, 'all'>, number> = { '7d': 7 * 86_400, '30d': 30 * 86_400 }

async function netAt(me: Address, cp: Address, block: bigint) {
  if (block < DEPLOYMENT.block) return 0n
  const read = (d: Address, c: Address) =>
    logsClient.readContract({ address: CH, abi: clearingHouseAbi, functionName: 'owedBy', args: [d, c, TOKEN], blockNumber: block }) as Promise<bigint>
  const [iOwe, theyOwe] = await Promise.all([read(me, cp), read(cp, me)])
  return theyOwe - iOwe
}

export function Statement({ me, cp, activity }: { me: Address; cp: Address; activity: ActivityRow[] }) {
  const { name, refOf } = useLocalMeta()
  const [period, setPeriod] = useState<Period>('30d')

  const q = useQuery({
    queryKey: ['commons-v2-statement', me, cp, period],
    refetchInterval: 60_000,
    queryFn: async () => {
      const head = await logsClient.getBlock()
      const endBlock = head.number
      let startBlock = DEPLOYMENT.block - 1n
      let startTime: number | undefined
      if (period !== 'all') {
        startTime = Number(head.timestamp) - SECS[period]
        // Base produces a block every 2s; estimate, then clamp to deployment.
        const est = head.number - BigInt(Math.floor(SECS[period] / 2))
        startBlock = est > DEPLOYMENT.block ? est : DEPLOYMENT.block - 1n
      }
      const [opening, closing] = await Promise.all([netAt(me, cp, startBlock), netAt(me, cp, endBlock)])
      return { startBlock, endBlock, startTime, endTime: Number(head.timestamp), opening, closing }
    },
  })

  const d = q.data
  const moves = d
    ? activity
        .filter((r) => r.counterparty?.toLowerCase() === cp.toLowerCase() && r.delta !== undefined && r.block > d.startBlock && r.block <= d.endBlock)
        .sort((a, b) => (a.block > b.block ? 1 : a.block < b.block ? -1 : 0))
    : []
  const sumMoves = moves.reduce((s, r) => s + (r.delta ?? 0n), 0n)
  const interest = d ? d.closing - d.opening - sumMoves : 0n
  const sign = (v: bigint) => (v > 0n ? `+${fmt(v, 4)}` : v < 0n ? `−${fmt(-v, 4)}` : '0')

  const exportCsv = () => {
    if (!d) return
    let running = d.opening
    const rows: unknown[][] = [['', d.startBlock.toString(), 'Opening balance', '', '', toNum(d.opening), '', '']]
    for (const r of moves) {
      running += r.delta ?? 0n
      rows.push([r.time ? new Date(r.time * 1000).toISOString() : '', r.block.toString(), r.kind, r.detail, toNum(r.delta ?? 0n), toNum(running), refOf(r.tx) ?? '', r.tx])
    }
    rows.push(['', d.endBlock.toString(), 'Interest & accrual (reconciling)', '', toNum(interest), toNum(d.closing), '', ''])
    rows.push(['', d.endBlock.toString(), 'Closing balance', '', '', toNum(d.closing), '', ''])
    downloadCsv(
      `commons-statement-${name(cp).replace(/[^a-z0-9]+/gi, '_')}-${period}-${new Date().toISOString().slice(0, 10)}.csv`,
      ['time_utc', 'block', 'item', 'detail', 'movement_musd', 'balance_musd', 'reference', 'tx_hash'],
      rows,
    )
  }

  return (
    <TerminalInset className="grid gap-2 p-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wide text-terminal-text-muted">Statement · {name(cp)} · + = they owe you</span>
        <div className="flex items-center gap-1.5">
          <TerminalSegmentedTabs
            activeId={period}
            options={[
              { id: '7d', label: '7d' },
              { id: '30d', label: '30d' },
              { id: 'all', label: 'All' },
            ]}
            onChange={(id) => setPeriod(id as Period)}
          />
          <TerminalButton size="sm" variant="ghost" disabled={!d} onClick={exportCsv}>
            CSV
          </TerminalButton>
        </div>
      </div>
      {!d ? (
        <div className="h-16 animate-pulse rounded bg-terminal-panel" />
      ) : (
        <>
          <TerminalKeyValueRow label={`Opening (block ${d.startBlock < DEPLOYMENT.block ? 'pre-deploy' : d.startBlock.toString()})`} value={<span className="font-mono">{sign(d.opening)}</span>} />
          {moves.length === 0 ? (
            <p className="text-terminal-text-muted">No movements in this period.</p>
          ) : (
            <div className="grid gap-0.5">
              {moves.map((r, i) => (
                <div key={`${r.tx}-${i}`} className="flex items-center justify-between gap-2">
                  <a href={txUrl(r.tx)} target="_blank" rel="noreferrer" className="min-w-0 truncate text-terminal-text-secondary hover:text-terminal-accent">
                    {r.time ? new Date(r.time * 1000).toLocaleDateString() : `#${r.block}`} · {r.kind}
                    {refOf(r.tx) ? <span className="text-terminal-accent"> · {refOf(r.tx)}</span> : null}
                  </a>
                  <span className={`font-mono ${(r.delta ?? 0n) >= 0n ? 'text-terminal-up' : 'text-terminal-down'}`}>{sign(r.delta ?? 0n)}</span>
                </div>
              ))}
            </div>
          )}
          <TerminalKeyValueRow label="Interest & accrual (reconciling)" value={<span className="font-mono">{sign(interest)}</span>} />
          <div className="border-t border-terminal-border pt-1">
            <TerminalKeyValueRow label="Closing (now)" value={<span className="font-mono font-semibold text-terminal-text">{sign(d.closing)}</span>} />
          </div>
        </>
      )}
    </TerminalInset>
  )
}
