export interface SettingsItemProps {
  icon: string
  label: string
  value?: string
  hasArrow?: boolean
  danger?: boolean
  onClick?: () => void
}

export function SettingsItem({
  icon,
  label,
  value,
  hasArrow,
  danger,
  onClick,
}: SettingsItemProps) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 p-2.5 rounded-suwappu-lg hover:bg-suwappu-sakura-light/30 transition-colors ${danger ? 'text-suwappu-error' : ''}`}
    >
      <span className="text-lg">{icon}</span>
      <span className={`flex-1 text-left text-sm font-heading font-medium ${danger ? 'text-suwappu-error' : 'text-suwappu-text'}`}>
        {label}
      </span>
      {value && <span className="text-xs text-suwappu-text-secondary">{value}</span>}
      {hasArrow && (
        <svg className="w-4 h-4 text-suwappu-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      )}
    </button>
  )
}
