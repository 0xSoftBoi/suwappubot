import { useNavigate } from 'react-router-dom'

export interface QuickAction {
  icon: string
  label: string
  color: string
  path?: string
  onClick?: () => void
}

export interface QuickActionsProps {
  actions?: QuickAction[]
  onAction?: (action: QuickAction) => void
}

const defaultActions: QuickAction[] = [
  { icon: '↓', label: 'Receive', color: 'bg-suwappu-success/10 text-suwappu-success', path: '/wallet/receive' },
  { icon: '↑', label: 'Send', color: 'bg-suwappu-info/10 text-suwappu-info', path: '/wallet/send' },
  { icon: '⇄', label: 'Swap', color: 'bg-suwappu-magenta-light/30 text-suwappu-magenta-mid', path: '/swap' },
  { icon: '◎', label: 'Buy', color: 'bg-suwappu-warning/10 text-suwappu-warning', path: '/buy' },
]

export function QuickActions({ actions = defaultActions, onAction }: QuickActionsProps) {
  const navigate = useNavigate()

  const handleClick = (action: QuickAction) => {
    if (onAction) {
      onAction(action)
    } else if (action.onClick) {
      action.onClick()
    } else if (action.path) {
      navigate(action.path)
    }
  }

  return (
    <div className="grid grid-cols-4 gap-2">
      {actions.map((action) => (
        <button
          key={action.label}
          onClick={() => handleClick(action)}
          className="flex flex-col items-center gap-1 p-2 rounded-suwappu-lg hover:bg-suwappu-sakura-light/30 transition-colors"
        >
          <div className={`w-10 h-10 rounded-full ${action.color} flex items-center justify-center text-lg`}>
            {action.icon}
          </div>
          <span className="text-[10px] font-heading font-medium text-suwappu-text">{action.label}</span>
        </button>
      ))}
    </div>
  )
}
