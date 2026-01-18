import { AppLayout, AppHeader } from '../components/layout'
import { BalanceCard, TokenItem } from '../components/cards'

const mockTokens = [
  { symbol: 'ETH', name: 'Ethereum', value: '$1,842.50', balance: '0.5432', change: 2.4, icon: 'Ξ' },
  { symbol: 'USDC', name: 'USD Coin', value: '$500.00', balance: '500.00', change: 0.01, icon: '$' },
  { symbol: 'SOL', name: 'Solana', value: '$187.50', balance: '2.5', change: -1.2, icon: '◎' },
  { symbol: 'MATIC', name: 'Polygon', value: '$45.00', balance: '60', change: 3.5, icon: '⬡' },
]

const mockChainAllocations = [
  { chain: 'Ethereum', percentage: 72, color: 'bg-blue-500' },
  { chain: 'Solana', percentage: 15, color: 'bg-purple-500' },
  { chain: 'Polygon', percentage: 13, color: 'bg-indigo-500' },
]

export function Portfolio() {
  const totalBalance = '$2,575.00'
  const change = 2.1

  return (
    <AppLayout header={<AppHeader title="Portfolio" />} activeNav="portfolio">
      <div className="p-3 pb-20 space-y-4">
        <BalanceCard balance={totalBalance} change={change} />

        {/* Chain allocation */}
        <div className="bg-white rounded-suwappu-xl p-3 shadow-suwappu-1">
          <h3 className="font-heading font-semibold text-sm text-suwappu-purple-deep mb-3">Chain Distribution</h3>
          <div className="h-2 rounded-full overflow-hidden flex">
            {mockChainAllocations.map((chain) => (
              <div
                key={chain.chain}
                className={`${chain.color}`}
                style={{ width: `${chain.percentage}%` }}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-3 mt-3">
            {mockChainAllocations.map((chain) => (
              <div key={chain.chain} className="flex items-center gap-1.5">
                <div className={`w-2 h-2 rounded-full ${chain.color}`} />
                <span className="text-xs text-suwappu-text-secondary">
                  {chain.chain} {chain.percentage}%
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Holdings */}
        <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-suwappu-sakura-mid/10">
            <span className="font-heading font-semibold text-sm text-suwappu-purple-deep">Holdings</span>
            <select className="text-xs text-suwappu-text-secondary bg-transparent border-none focus:outline-none">
              <option>All Chains</option>
              <option>Ethereum</option>
              <option>Solana</option>
              <option>Polygon</option>
            </select>
          </div>
          <div className="divide-y divide-suwappu-sakura-mid/10">
            {mockTokens.map((token) => (
              <TokenItem key={token.symbol} {...token} />
            ))}
          </div>
        </div>

        {/* Performance card */}
        <div className="bg-white rounded-suwappu-xl p-3 shadow-suwappu-1">
          <h3 className="font-heading font-semibold text-sm text-suwappu-purple-deep mb-2">Performance</h3>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="p-2 bg-suwappu-sakura-light/30 rounded-suwappu-lg">
              <p className="text-[10px] text-suwappu-text-secondary">24h</p>
              <p className="text-sm font-heading font-bold text-suwappu-success">+2.1%</p>
            </div>
            <div className="p-2 bg-suwappu-sakura-light/30 rounded-suwappu-lg">
              <p className="text-[10px] text-suwappu-text-secondary">7d</p>
              <p className="text-sm font-heading font-bold text-suwappu-success">+8.4%</p>
            </div>
            <div className="p-2 bg-suwappu-sakura-light/30 rounded-suwappu-lg">
              <p className="text-[10px] text-suwappu-text-secondary">30d</p>
              <p className="text-sm font-heading font-bold text-suwappu-error">-3.2%</p>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  )
}
