import { useCopyTrades } from '../../hooks/useCopyTrading'
import type { CopyTrade } from '../../types/api'

function truncateAddress(addr: string): string {
  if (addr.length <= 12) return addr
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

function formatPnl(value: number): string {
  const prefix = value >= 0 ? '+' : ''
  return `${prefix}$${Math.abs(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function timeAgo(timestamp: string): string {
  const now = Date.now()
  const then = new Date(timestamp).getTime()
  const seconds = Math.floor((now - then) / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

// Mock data for initial development
const MOCK_TRADES: CopyTrade[] = [
  { id: '1', traderAddress: '0x1a2b3c4d5e6f7890abcdef1234567890abcdef12', action: 'buy', tokenPair: 'ETH/USDC', amount: 2500, pnl: 0, timestamp: new Date(Date.now() - 2 * 60 * 1000).toISOString() },
  { id: '2', traderAddress: '0xdeadbeef1234567890abcdef1234567890abcdef', action: 'sell', tokenPair: 'PEPE/WETH', amount: 800, pnl: 342.50, timestamp: new Date(Date.now() - 5 * 60 * 1000).toISOString() },
  { id: '3', traderAddress: '0xaabbccdd11223344556677889900aabbccddeeff', action: 'buy', tokenPair: 'ARB/USDC', amount: 1200, pnl: 0, timestamp: new Date(Date.now() - 12 * 60 * 1000).toISOString() },
  { id: '4', traderAddress: '0x1a2b3c4d5e6f7890abcdef1234567890abcdef12', action: 'sell', tokenPair: 'LINK/USDC', amount: 3100, pnl: -156.30, timestamp: new Date(Date.now() - 24 * 60 * 1000).toISOString() },
  { id: '5', traderAddress: '0xfedcba0987654321fedcba0987654321fedcba09', action: 'buy', tokenPair: 'SOL/USDC', amount: 5000, pnl: 0, timestamp: new Date(Date.now() - 35 * 60 * 1000).toISOString() },
  { id: '6', traderAddress: '0xdeadbeef1234567890abcdef1234567890abcdef', action: 'buy', tokenPair: 'WBTC/USDC', amount: 10000, pnl: 0, timestamp: new Date(Date.now() - 48 * 60 * 1000).toISOString() },
  { id: '7', traderAddress: '0xaabbccdd11223344556677889900aabbccddeeff', action: 'sell', tokenPair: 'DOGE/USDC', amount: 450, pnl: 89.20, timestamp: new Date(Date.now() - 72 * 60 * 1000).toISOString() },
  { id: '8', traderAddress: '0x1a2b3c4d5e6f7890abcdef1234567890abcdef12', action: 'buy', tokenPair: 'UNI/USDC', amount: 1800, pnl: 0, timestamp: new Date(Date.now() - 95 * 60 * 1000).toISOString() },
  { id: '9', traderAddress: '0xfedcba0987654321fedcba0987654321fedcba09', action: 'sell', tokenPair: 'AAVE/USDC', amount: 2200, pnl: -430.00, timestamp: new Date(Date.now() - 150 * 60 * 1000).toISOString() },
  { id: '10', traderAddress: '0xdeadbeef1234567890abcdef1234567890abcdef', action: 'buy', tokenPair: 'OP/USDC', amount: 650, pnl: 0, timestamp: new Date(Date.now() - 200 * 60 * 1000).toISOString() },
]

export function CopyFeed() {
  const { data: apiTrades } = useCopyTrades(50)
  const trades = apiTrades?.length ? apiTrades : MOCK_TRADES

  return (
    <div className="divide-y divide-terminal-border/50">
      {trades.map((trade: CopyTrade) => (
        <div key={trade.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-terminal-bg-tertiary/50 transition-colors">
          {/* Action badge */}
          <div className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase shrink-0 ${
            trade.action === 'buy'
              ? 'bg-bull-dim text-bull'
              : 'bg-bear-dim text-bear'
          }`}>
            {trade.action}
          </div>

          {/* Details */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-mono text-terminal-text-secondary">
                {truncateAddress(trade.traderAddress)}
              </span>
              <span className="text-terminal-text-muted text-[10px]">traded</span>
              <span className="text-xs font-semibold text-terminal-text">{trade.tokenPair}</span>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[10px] font-mono text-terminal-text-muted">
                ${trade.amount.toLocaleString()}
              </span>
              {trade.pnl !== 0 && (
                <span className={`text-[10px] font-mono ${trade.pnl >= 0 ? 'text-bull' : 'text-bear'}`}>
                  {formatPnl(trade.pnl)}
                </span>
              )}
            </div>
          </div>

          {/* Timestamp */}
          <span className="text-[10px] text-terminal-text-muted shrink-0">
            {timeAgo(trade.timestamp)}
          </span>
        </div>
      ))}

      {!trades.length && (
        <div className="flex items-center justify-center py-12 text-terminal-text-muted text-sm">
          No copy trades yet
        </div>
      )}
    </div>
  )
}
