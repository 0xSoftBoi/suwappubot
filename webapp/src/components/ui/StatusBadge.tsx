export type StatusType = 'success' | 'warning' | 'error' | 'info' | 'pending'

export interface StatusBadgeProps {
  status: StatusType
  label?: string
  showDot?: boolean
}

const statusStyles: Record<StatusType, { bg: string; text: string; dot: string }> = {
  success: {
    bg: 'bg-suwappu-success/20',
    text: 'text-suwappu-success',
    dot: 'bg-suwappu-success',
  },
  warning: {
    bg: 'bg-suwappu-warning/20',
    text: 'text-orange-700',
    dot: 'bg-suwappu-warning',
  },
  error: {
    bg: 'bg-suwappu-error/20',
    text: 'text-red-700',
    dot: 'bg-suwappu-error',
  },
  info: {
    bg: 'bg-suwappu-info/20',
    text: 'text-suwappu-info',
    dot: 'bg-suwappu-info',
  },
  pending: {
    bg: 'bg-suwappu-sakura-light',
    text: 'text-suwappu-magenta-mid',
    dot: 'bg-suwappu-magenta-mid',
  },
}

export function StatusBadge({ status, label, showDot = true }: StatusBadgeProps) {
  const styles = statusStyles[status]

  return (
    <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full ${styles.bg}`}>
      {showDot && (
        <div className={`w-2 h-2 rounded-full ${styles.dot} ${status === 'pending' ? 'animate-pulse' : ''}`} />
      )}
      {label && (
        <span className={`text-[10px] font-medium ${styles.text}`}>{label}</span>
      )}
    </div>
  )
}
