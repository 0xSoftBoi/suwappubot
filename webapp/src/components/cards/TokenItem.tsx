export interface TokenItemProps {
  symbol: string
  name: string
  value: string
  change?: number
  icon: string
  balance?: string
  onClick?: () => void
}

export function TokenItem({
  symbol,
  name,
  value,
  change,
  icon,
  balance,
  onClick,
}: TokenItemProps) {
  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-3 p-2 hover:bg-suwappu-sakura-light/20 rounded-suwappu-lg transition-colors ${onClick ? 'cursor-pointer' : ''}`}
    >
      <div className="w-9 h-9 rounded-full bg-suwappu-sakura-light flex items-center justify-center text-lg">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className="font-heading font-semibold text-sm text-suwappu-text">{symbol}</span>
          <span className="font-heading font-semibold text-sm text-suwappu-text">
            {balance || value}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-suwappu-text-secondary truncate">{name}</span>
          {change !== undefined ? (
            <span className={`text-xs ${change >= 0 ? 'text-suwappu-success' : 'text-suwappu-error'}`}>
              {change >= 0 ? '+' : ''}{change}%
            </span>
          ) : balance ? (
            <span className="text-xs text-suwappu-text-secondary">{value}</span>
          ) : null}
        </div>
      </div>
    </div>
  )
}
