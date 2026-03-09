type Tab = 'swap' | 'limit' | 'dca'

interface Props {
  active: Tab
  onSelect: (tab: Tab) => void
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'swap', label: 'Swap' },
  { id: 'limit', label: 'Limit' },
  { id: 'dca', label: 'DCA' },
]

export function OrderTabs({ active, onSelect }: Props) {
  return (
    <div className="flex gap-1 border-b border-terminal-border mb-3">
      {TABS.map(tab => (
        <button
          key={tab.id}
          onClick={() => onSelect(tab.id)}
          className={`terminal-tab ${active === tab.id ? 'terminal-tab-active' : ''}`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
