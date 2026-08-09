import { useState, useMemo, useEffect } from 'react'
import { useTopTraders } from '../../hooks/useCopyTrading'
import type { TopTrader } from '../../types/api'

function truncateAddress(addr: string): string {
  if (addr.length <= 12) return addr
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

function formatPnl(value: number): string {
  const prefix = value >= 0 ? '+' : '-'
  return `${prefix}$${Math.abs(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

type SortKey = 'pnl7d' | 'pnl30d' | 'winRate' | 'followers'
type SortDir = 'asc' | 'desc'
type Timeframe = '7d' | '30d'

const PAGE_SIZE = 10

interface TraderLeaderboardProps {
  onSelectTrader: (traderId: string) => void
  onFollow: (traderId: string) => void
}

export function TraderLeaderboard({ onSelectTrader, onFollow }: TraderLeaderboardProps) {
  const [sortKey, setSortKey] = useState<SortKey>('pnl7d')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [timeframe, setTimeframe] = useState<Timeframe>('7d')
  const [jellyOnly, setJellyOnly] = useState(false)
  const [search, setSearch] = useState('')
  const [serverSearch, setServerSearch] = useState('')
  const [page, setPage] = useState(1)
  const { data: traders, isLoading, isError, refetch } = useTopTraders(
    timeframe,
    50,
    serverSearch || undefined,
  )

  useEffect(() => {
    const trimmed = search.trim()
    const timer = window.setTimeout(
      () => setServerSearch(trimmed.length >= 2 || trimmed.startsWith('0x') ? trimmed : ''),
      200,
    )
    return () => window.clearTimeout(timer)
  }, [search])

  const handleTimeframe = (next: Timeframe) => {
    setTimeframe(next)
    setSortKey(next === '7d' ? 'pnl7d' : 'pnl30d')
    setSortDir('desc')
    setPage(1)
  }

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const sortArrow = (key: SortKey) => {
    if (sortKey !== key) return <span className="text-terminal-text-muted ml-0.5">&#8597;</span>
    return <span className="text-sakura-400 ml-0.5">{sortDir === 'desc' ? '▼' : '▲'}</span>
  }

  const sorted = useMemo(() => {
    let list = [...(traders || [])]
    if (search.trim()) {
      const term = search.toLowerCase()
      list = list.filter(t =>
        t.address.toLowerCase().includes(term) ||
        (t.name && t.name.toLowerCase().includes(term)) ||
        (t.jellyUsername && t.jellyUsername.toLowerCase().includes(term))
      )
    }
    if (jellyOnly) list = list.filter(t => t.jellyLinked)
    const mul = sortDir === 'desc' ? -1 : 1
    list.sort((a, b) => mul * (a[sortKey] - b[sortKey]))
    return list
  }, [traders, search, jellyOnly, sortKey, sortDir])

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const start = (currentPage - 1) * PAGE_SIZE
  const pageItems = sorted.slice(start, start + PAGE_SIZE)

  const handleSearchChange = (val: string) => {
    setSearch(val)
    setPage(1)
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="px-3 pt-3 space-y-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            placeholder="Search trader, handle, or wallet..."
            className="terminal-input text-xs w-full sm:flex-1"
            value={search}
            onChange={e => handleSearchChange(e.target.value)}
          />
          <div className="flex items-center gap-1 shrink-0">
            {(['7d', '30d'] as const).map(period => (
              <button
                key={period}
                type="button"
                onClick={() => handleTimeframe(period)}
                className={`terminal-button-secondary px-2.5 py-1.5 text-[10px] ${
                  timeframe === period ? 'border-sakura-500 text-sakura-400' : ''
                }`}
              >
                {period.toUpperCase()}
              </button>
            ))}
            <button
              type="button"
              onClick={() => { setJellyOnly(value => !value); setPage(1) }}
              className={`terminal-button-secondary px-2.5 py-1.5 text-[10px] ${
                jellyOnly ? 'border-sakura-500 text-sakura-400' : ''
              }`}
            >
              Jelly-linked
            </button>
          </div>
        </div>
        <p className="text-[10px] text-terminal-text-muted">
          Public performance comes from Suwappu trades. Jelly-linked means the trader proved control of that Jelly account with a wallet-backed session.
        </p>
      </div>

      <div className="overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-terminal-text-muted uppercase tracking-wider border-b border-terminal-border">
              <th className="text-left py-2 px-3 font-medium w-12">Rank</th>
              <th className="text-left py-2 px-3 font-medium">Trader</th>
              <th
                className="text-right py-2 px-3 font-medium cursor-pointer hover:text-terminal-text select-none"
                onClick={() => handleSort('pnl7d')}
              >
                7d PnL{sortArrow('pnl7d')}
              </th>
              <th
                className="text-right py-2 px-3 font-medium cursor-pointer hover:text-terminal-text select-none"
                onClick={() => handleSort('pnl30d')}
              >
                30d PnL{sortArrow('pnl30d')}
              </th>
              <th
                className="text-right py-2 px-3 font-medium cursor-pointer hover:text-terminal-text select-none"
                onClick={() => handleSort('winRate')}
              >
                Win Rate{sortArrow('winRate')}
              </th>
              <th
                className="text-right py-2 px-3 font-medium cursor-pointer hover:text-terminal-text select-none"
                onClick={() => handleSort('followers')}
              >
                Followers{sortArrow('followers')}
              </th>
              <th className="text-right py-2 px-3 font-medium">Copiers</th>
              <th className="text-right py-2 px-3 font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={8} className="text-center text-terminal-text-muted text-sm py-12">
                  Loading top traders...
                </td>
              </tr>
            )}
            {!isLoading && !pageItems.length && (
              <tr>
                <td colSpan={8} className="text-center text-terminal-text-muted text-sm py-12">
                  {isError ? (
                    <button type="button" onClick={() => void refetch()} className="text-sakura-400 hover:text-sakura-300">
                      Trader feed unavailable — retry
                    </button>
                  ) : 'No traders found'}
                </td>
              </tr>
            )}
            {pageItems.map((trader: TopTrader, i: number) => (
              <tr
                key={trader.id}
                className="border-b border-terminal-border/50 hover:bg-terminal-bg-tertiary/50 transition-colors cursor-pointer"
                onClick={() => onSelectTrader(trader.id)}
              >
                <td className="py-2.5 px-3 text-terminal-text-muted font-mono tnum text-xs">{start + i + 1}</td>
                <td className="py-2.5 px-3">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-terminal-bg-tertiary border border-terminal-border flex items-center justify-center text-[10px] font-mono tnum text-terminal-text-secondary shrink-0">
                      {(trader.name || trader.address).slice(0, 2).toUpperCase()}
                    </div>
                    <span className="font-mono tnum text-xs text-terminal-text">
                      {trader.name || truncateAddress(trader.address)}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 pl-8 text-[10px] text-terminal-text-muted">
                    {trader.jellyLinked && trader.jellyWatchUrl && trader.jellyUsername && (
                      <>
                        <a
                          href={trader.jellyWatchUrl}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`Jelly-linked @${trader.jellyUsername}`}
                          onClick={e => e.stopPropagation()}
                          className="rounded border border-sakura-500/30 bg-sakura-500/10 px-1.5 py-0.5 text-sakura-400 hover:text-sakura-300"
                        >
                          Jelly-linked
                        </a>
                        <span className="text-terminal-text-secondary">@{trader.jellyUsername}</span>
                      </>
                    )}
                    <span>{trader.trackRecordDays ?? 0}d track record</span>
                    <span>{trader.totalTrades.toLocaleString()} trades</span>
                  </div>
                </td>
                <td className={`py-2.5 px-3 text-right font-mono tnum text-xs ${trader.pnl7d >= 0 ? 'text-bull' : 'text-bear'}`}>
                  {formatPnl(trader.pnl7d)}
                </td>
                <td className={`py-2.5 px-3 text-right font-mono tnum text-xs ${trader.pnl30d >= 0 ? 'text-bull' : 'text-bear'}`}>
                  {formatPnl(trader.pnl30d)}
                </td>
                <td className="py-2.5 px-3 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <div className="w-12 h-1.5 bg-terminal-bg-tertiary rounded-full overflow-hidden">
                      <div
                        className="h-full bg-bull rounded-full"
                        style={{ width: `${Math.min(trader.winRate, 100)}%` }}
                      />
                    </div>
                    <span className="font-mono tnum text-xs text-terminal-text">{trader.winRate.toFixed(1)}%</span>
                  </div>
                </td>
                <td className="py-2.5 px-3 text-right font-mono tnum text-xs text-terminal-text-secondary">
                  {trader.followers.toLocaleString()}
                </td>
                <td className="py-2.5 px-3 text-right font-mono tnum text-xs text-terminal-text-secondary">
                  {(trader.copiers ?? 0).toLocaleString()}
                </td>
                <td className="py-2.5 px-3 text-right">
                  <button
                    onClick={e => { e.stopPropagation(); onFollow(trader.id) }}
                    className="px-3 py-1 rounded text-xs font-semibold bg-sakura-600 hover:bg-sakura-700 text-terminal-on-accent transition-colors"
                  >
                    Follow / Copy
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between text-xs text-terminal-text-muted px-3 pb-3">
        <span>
          Showing {sorted.length === 0 ? 0 : start + 1}-{Math.min(start + PAGE_SIZE, sorted.length)} of {sorted.length}
        </span>
        <div className="flex items-center gap-2">
          <button
            className="terminal-button-secondary text-xs px-3 py-1"
            disabled={currentPage <= 1}
            onClick={() => setPage(p => p - 1)}
          >
            Prev
          </button>
          <button
            className="terminal-button-secondary text-xs px-3 py-1"
            disabled={currentPage >= totalPages}
            onClick={() => setPage(p => p + 1)}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  )
}
