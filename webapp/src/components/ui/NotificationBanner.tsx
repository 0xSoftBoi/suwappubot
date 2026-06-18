export interface NotificationBannerProps {
  message: string
  type?: 'info' | 'success' | 'warning' | 'error'
  onClose?: () => void
}

const typeStyles = {
  info: 'bg-suwappu-info/10 border-suwappu-info/20 text-suwappu-info',
  success: 'bg-suwappu-success/10 border-suwappu-success/20 text-green-700',
  warning: 'bg-suwappu-warning/10 border-suwappu-warning/20 text-orange-700',
  error: 'bg-suwappu-error/10 border-suwappu-error/20 text-red-700',
}

const typeIcons = {
  info: 'ℹ',
  success: '✓',
  warning: '⚠',
  error: '✕',
}

export function NotificationBanner({ message, type = 'info', onClose }: NotificationBannerProps) {
  return (
    <div className={`mx-3 mt-2 p-2 border rounded-suwappu-lg flex items-center gap-2 ${typeStyles[type]}`}>
      <span>{typeIcons[type]}</span>
      <p className="flex-1 text-xs">{message}</p>
      {onClose && (
        <button onClick={onClose} className="opacity-60 hover:opacity-100">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  )
}
