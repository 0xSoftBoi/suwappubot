export interface BalanceCardProps {
  balance: string
  change?: number
  changePeriod?: string
}

export function BalanceCard({ balance, change, changePeriod = '24h' }: BalanceCardProps) {
  return (
    <div className="bg-suwappu-gradient rounded-suwappu-xl p-4 text-white shadow-suwappu-button">
      <p className="text-xs opacity-80 mb-1">Total Balance</p>
      <p className="text-2xl font-heading font-bold">{balance}</p>
      {change !== undefined && (
        <div className="flex items-center gap-1 mt-1">
          <span className="text-xs bg-white/20 px-1.5 py-0.5 rounded-full">
            {change >= 0 ? '+' : ''}{change}%
          </span>
          <span className="text-xs opacity-70">{changePeriod}</span>
        </div>
      )}
    </div>
  )
}
