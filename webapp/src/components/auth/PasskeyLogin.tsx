/**
 * PasskeyLogin component - Login with existing passkey
 */

import { usePasskey } from '../../hooks/usePasskey'

interface PasskeyLoginProps {
  onSuccess?: () => void
  onError?: (error: string) => void
  className?: string
}

export function PasskeyLogin({
  onSuccess,
  onError,
  className = '',
}: PasskeyLoginProps) {
  const {
    isSupported,
    isLoading,
    error,
    authenticate,
    clearError,
  } = usePasskey()

  const handleLogin = async () => {
    clearError()
    const success = await authenticate()

    if (success) {
      onSuccess?.()
    } else if (error) {
      onError?.(error)
    }
  }

  if (!isSupported) {
    return null
  }

  return (
    <div className="space-y-2">
      <button
        onClick={handleLogin}
        disabled={isLoading}
        className={`flex items-center justify-center gap-2 w-full px-4 py-3 bg-tg-secondary text-tg-text rounded-lg font-medium transition-opacity disabled:opacity-50 hover:bg-tg-secondary/80 ${className}`}
      >
        {isLoading ? (
          <>
            <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            Authenticating...
          </>
        ) : (
          <>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4" />
            </svg>
            Login with Passkey
          </>
        )}
      </button>

      {error && (
        <p className="text-sm text-red-500 text-center">{error}</p>
      )}
    </div>
  )
}
