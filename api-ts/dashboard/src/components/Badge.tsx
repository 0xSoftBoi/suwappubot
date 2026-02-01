interface BadgeProps {
  label: string
  variant?: 'success' | 'warning' | 'error' | 'info' | 'neutral'
}

const variantStyles = {
  success: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  warning: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  error: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  info: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  neutral: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
}

export default function Badge({ label, variant = 'neutral' }: BadgeProps) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-suwappu-pill ${variantStyles[variant]}`}>
      {label}
    </span>
  )
}

export function statusBadgeVariant(status: string | null): BadgeProps['variant'] {
  switch (status) {
    case 'completed':
    case 'delivered':
    case 'active':
      return 'success'
    case 'pending':
    case 'processing':
      return 'warning'
    case 'failed':
    case 'error':
      return 'error'
    default:
      return 'neutral'
  }
}
