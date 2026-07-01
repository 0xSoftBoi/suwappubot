import type { PulseFilters as PulseFiltersType } from '../../types/api'

interface PulseFiltersProps {
  filters: PulseFiltersType
  onChange: (filters: PulseFiltersType) => void
  onReset: () => void
}

function FilterInput({
  label,
  value,
  onChange,
  placeholder,
  suffix,
}: {
  label: string
  value: number | null
  onChange: (v: number | null) => void
  placeholder: string
  suffix?: string
}) {
  return (
    <div className="flex items-center gap-1">
      <label className="text-[9px] text-terminal-text-muted whitespace-nowrap">{label}</label>
      <div className="relative">
        <input
          type="number"
          value={value ?? ''}
          onChange={e => {
            const v = e.target.value
            onChange(v === '' ? null : parseFloat(v))
          }}
          placeholder={placeholder}
          className="w-16 px-1 py-0.5 text-[10px] font-mono bg-terminal-bg-tertiary border border-terminal-border rounded text-terminal-text placeholder:text-terminal-text-muted/50 focus:outline-none focus:border-terminal-border-active [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
        {suffix && (
          <span className="absolute right-1 top-1/2 -translate-y-1/2 text-[8px] text-terminal-text-muted pointer-events-none">
            {suffix}
          </span>
        )}
      </div>
    </div>
  )
}

export function PulseFilters({ filters, onChange, onReset }: PulseFiltersProps) {
  const update = (key: keyof PulseFiltersType, value: number | null) => {
    onChange({ ...filters, [key]: value })
  }

  const hasFilters = Object.values(filters).some(v => v !== null)

  return (
    <div className="flex items-center gap-2 px-2 py-1.5 border-b border-terminal-border bg-terminal-bg-secondary/50 flex-wrap" data-testid="pulse-filters">
      <FilterInput
        label="MCap"
        value={filters.minMarketCap}
        onChange={v => update('minMarketCap', v)}
        placeholder="Min"
      />
      <span className="text-[9px] text-terminal-text-muted">-</span>
      <FilterInput
        label=""
        value={filters.maxMarketCap}
        onChange={v => update('maxMarketCap', v)}
        placeholder="Max"
      />

      <div className="w-px h-3 bg-terminal-border" />

      <FilterInput
        label="Liq"
        value={filters.minLiquidity}
        onChange={v => update('minLiquidity', v)}
        placeholder="Min"
      />

      <FilterInput
        label="Vol"
        value={filters.minVolume}
        onChange={v => update('minVolume', v)}
        placeholder="Min"
      />

      <FilterInput
        label="Txns"
        value={filters.minTxns}
        onChange={v => update('minTxns', v)}
        placeholder="Min"
      />

      <FilterInput
        label="Age"
        value={filters.maxAgeMinutes}
        onChange={v => update('maxAgeMinutes', v)}
        placeholder="Max"
        suffix="m"
      />

      <div className="w-px h-3 bg-terminal-border" />

      <FilterInput
        label="Top%"
        value={filters.maxTopHolderPercent}
        onChange={v => update('maxTopHolderPercent', v)}
        placeholder="Max"
        suffix="%"
      />

      <FilterInput
        label="Dev%"
        value={filters.maxDevPercent}
        onChange={v => update('maxDevPercent', v)}
        placeholder="Max"
        suffix="%"
      />

      <FilterInput
        label="Sniper%"
        value={filters.maxSniperPercent}
        onChange={v => update('maxSniperPercent', v)}
        placeholder="Max"
        suffix="%"
      />

      <FilterInput
        label="Bundle"
        value={filters.maxBundleCount}
        onChange={v => update('maxBundleCount', v)}
        placeholder="Max"
      />

      <FilterInput
        label="Insiders%"
        value={filters.maxInsidersPercent}
        onChange={v => update('maxInsidersPercent', v)}
        placeholder="Max"
        suffix="%"
      />

      <FilterInput
        label="Bundle%"
        value={filters.maxBundlePercent}
        onChange={v => update('maxBundlePercent', v)}
        placeholder="Max"
        suffix="%"
      />

      <div className="w-px h-3 bg-terminal-border" />

      <FilterInput
        label="Holders"
        value={filters.minHolders}
        onChange={v => update('minHolders', v)}
        placeholder="Min"
      />

      {hasFilters && (
        <button
          onClick={onReset}
          className="text-[9px] px-1.5 py-0.5 rounded text-red-400 hover:bg-red-500/10 border border-red-500/30 transition-colors"
        >
          Reset
        </button>
      )}
    </div>
  )
}
