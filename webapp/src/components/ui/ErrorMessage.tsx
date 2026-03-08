/**
 * ErrorMessage - Display error states with action buttons
 * Stub implementation — to be fully built out later.
 */

export type ErrorCode = 'NETWORK' | 'AUTH' | 'VALIDATION' | 'UNKNOWN'

export interface ErrorAction {
  label: string
  onClick: () => void
}

export interface ErrorMessageProps {
  code?: ErrorCode
  message?: string
  actions?: ErrorAction[]
}

export function ErrorMessage({ message, actions }: ErrorMessageProps) {
  return (
    <div className="bg-red-50 rounded-suwappu-xl p-4 text-center">
      <p className="text-sm text-red-600">{message || 'Something went wrong'}</p>
      {actions && (
        <div className="flex justify-center gap-2 mt-2">
          {actions.map((action, i) => (
            <button key={i} onClick={action.onClick} className="text-xs text-red-700 underline">
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function parseErrorCode(_error: unknown): ErrorCode {
  return 'UNKNOWN'
}

export function useErrorHandler() {
  return {
    handleError: (_error: unknown) => {},
    clearError: () => {},
    error: null as string | null,
  }
}
