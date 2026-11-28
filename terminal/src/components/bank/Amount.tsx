import { formatMinor } from '../../lib/bankApi'
import { Input } from './BankUI'

export function Money({ minor, decimals, symbol, className = '' }: { minor: string | null | undefined; decimals: number | null | undefined; symbol?: string; className?: string }) {
  return <span className={`tabular-nums ${className}`}>{formatMinor(minor, decimals)}{symbol ? ` ${symbol}` : ''}</span>
}

export function AmountInput({ value, onChange, symbol, decimals }: { value: string; onChange: (v: string) => void; symbol?: string; decimals: number | null }) {
  return (
    <div className="relative">
      <Input
        inputMode="decimal"
        autoComplete="off"
        placeholder="0.00"
        value={value}
        aria-label="Amount"
        onChange={(e) => {
          const v = e.target.value.replace(',', '.')
          if (v === '' || /^\d*\.?\d*$/.test(v)) onChange(v)
        }}
        className="pr-16"
      />
      {symbol && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-terminal-text-secondary">{symbol}</span>}
      {decimals !== null && value.includes('.') && value.split('.')[1].length > decimals && (
        <p className="text-[11px] text-bear mt-1">{symbol ?? 'This asset'} supports at most {decimals} decimals.</p>
      )}
    </div>
  )
}
