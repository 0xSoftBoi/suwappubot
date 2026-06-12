export interface Token {
  symbol: string
  /** Logo URL or fallback text (e.g. first 2 letters of symbol) */
  logoUrl?: string
  name: string
}

export interface TokenInputProps {
  label: string
  amount: string
  token: Token
  balance?: string
  usdValue?: string
  onAmountChange?: (value: string) => void
  onTokenClick?: () => void
  readOnly?: boolean
}

export function TokenInput({
  label,
  amount,
  token,
  balance,
  usdValue,
  onAmountChange,
  onTokenClick,
  readOnly = false,
}: TokenInputProps) {
  return (
    <div className="bg-white rounded-suwappu-xl p-3 shadow-suwappu-1">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-suwappu-text-secondary">{label}</span>
        {balance && (
          <span className="text-xs text-suwappu-text-secondary">
            Balance: {balance}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {readOnly ? (
          <span className="flex-1 text-xl font-heading font-bold text-suwappu-text min-w-0">
            {amount || '0.0'}
          </span>
        ) : (
          <input
            type="text"
            value={amount}
            onChange={(e) => onAmountChange?.(e.target.value)}
            placeholder="0.0"
            className="flex-1 text-xl font-heading font-bold text-suwappu-text bg-transparent focus:outline-none min-w-0"
          />
        )}
        <button
          onClick={onTokenClick}
          className="flex items-center gap-2 px-3 py-2 bg-suwappu-sakura-light rounded-suwappu-lg hover:bg-suwappu-sakura-mid/30 transition-colors"
        >
          {token.logoUrl ? (
            <img 
              src={token.logoUrl} 
              alt={token.symbol}
              className="w-6 h-6 rounded-suwappu-pill object-cover"
              onError={(e) => {
                // Fallback to text on image load error
                const target = e.target as HTMLImageElement
                target.style.display = 'none'
                target.nextElementSibling?.classList.remove('hidden')
              }}
            />
          ) : null}
          <div className={`w-6 h-6 rounded-suwappu-pill bg-suwappu-gradient flex items-center justify-center text-white text-xs font-bold ${token.logoUrl ? 'hidden' : ''}`}>
            {token.symbol.slice(0, 2)}
          </div>
          <span className="font-heading font-semibold text-sm">{token.symbol}</span>
          <svg className="w-4 h-4 text-suwappu-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>
      {(usdValue || balance) && (
        <div className="flex items-center justify-between mt-2">
          {usdValue && <span className="text-xs text-suwappu-text-secondary">{usdValue}</span>}
          {balance && !readOnly && (
            <button
              onClick={() => onAmountChange?.(balance)}
              className="text-xs text-suwappu-magenta-mid font-medium"
            >
              Max
            </button>
          )}
        </div>
      )}
    </div>
  )
}
