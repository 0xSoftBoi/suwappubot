/**
 * OAuthLogin component - Login with Google or Twitter and create Turnkey wallet
 */

import { useAuth } from '../../contexts/AuthContext'

interface OAuthLoginProps {
  provider: 'google' | 'twitter'
  oauthToken: string
  onSuccess?: (walletAddress: string) => void
  onError?: (error: string) => void
  className?: string
}

export function OAuthLogin({
  provider,
  oauthToken,
  onSuccess,
  onError,
  className = '',
}: OAuthLoginProps) {
  const { isLoading, error, loginWithOAuth, clearError } = useAuth()

  const handleOAuthLogin = async () => {
    clearError()
    const success = await loginWithOAuth(provider, oauthToken)

    if (success) {
      onSuccess?.('')
    } else if (error) {
      onError?.(error)
    }
  }

  const providerLabel = provider === 'google' ? 'Google' : 'Twitter'

  return (
    <div className="space-y-2">
      <button
        onClick={handleOAuthLogin}
        disabled={isLoading || !oauthToken}
        className={`flex items-center justify-center gap-2 w-full px-4 py-3 bg-tg-secondary text-tg-text rounded-lg font-medium transition-opacity disabled:opacity-50 hover:bg-tg-secondary/80 ${className}`}
      >
        {isLoading ? (
          <>
            <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            Creating Wallet...
          </>
        ) : (
          <>
            {provider === 'google' ? (
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
                <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
            ) : (
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
            )}
            Continue with {providerLabel}
          </>
        )}
      </button>

      {error && (
        <p className="text-sm text-red-500 text-center">{error}</p>
      )}
    </div>
  )
}
