export interface ToggleItemProps {
  icon: string
  label: string
  description?: string
  enabled: boolean
  onToggle: () => void
}

export function ToggleItem({
  icon,
  label,
  description,
  enabled,
  onToggle,
}: ToggleItemProps) {
  return (
    <div className="flex items-center gap-3 p-3">
      <span className="text-lg">{icon}</span>
      <div className="flex-1">
        <p className="font-heading font-semibold text-sm text-suwappu-text">{label}</p>
        {description && (
          <p className="text-xs text-suwappu-text-secondary">{description}</p>
        )}
      </div>
      <button
        onClick={onToggle}
        className={`relative w-11 h-6 rounded-full transition-colors ${
          enabled ? 'bg-suwappu-gradient' : 'bg-suwappu-text-secondary/30'
        }`}
      >
        <div
          className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${
            enabled ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  )
}
