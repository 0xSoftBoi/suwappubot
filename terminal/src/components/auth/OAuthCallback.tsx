import { useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../../lib/api'

/**
 * OAuth provider callback landing page.
 *
 * Google (and other providers) redirect here — to the frontend origin on the
 * `oauth_redirect_base` allowlist — after the user consents, with `?code=&state=`
 * in the query string. The backend, not the browser, must exchange the code, so
 * we immediately do a full-page navigation to the backend callback endpoint.
 *
 * Why a full-page navigation (not fetch): the backend callback responds with a
 * 302 that carries `Set-Cookie: suwappu_auth=…` (httponly). Letting the browser
 * follow that redirect is what persists the session cookie; an XHR/fetch would
 * not store it the same way and can't follow the final cross-origin redirect
 * back to the terminal. The backend then redirects to `?auth=success`, which the
 * AuthContext mount effect detects to establish the authenticated state.
 */
export function OAuthCallback() {
  const { provider } = useParams<{ provider: string }>()

  useEffect(() => {
    if (typeof window === 'undefined') return
    const search = window.location.search
    const params = new URLSearchParams(search)

    // Provider returned an error (e.g. user denied consent) — bounce home
    // with a signal so the landing page can explain why sign-in failed.
    if (params.get('error') || !params.get('code') || !params.get('state')) {
      const reason = params.get('error') || 'auth_failed'
      window.location.replace(`/?auth_error=${encodeURIComponent(reason)}`)
      return
    }

    const p = provider === 'twitter' ? 'twitter' : 'google'
    window.location.replace(api.oauthCallbackUrl(p, search))
  }, [provider])

  return (
    <div className="flex h-screen items-center justify-center bg-terminal-bg text-terminal-text">
      <div className="text-sm text-terminal-text-muted">Completing sign-in…</div>
    </div>
  )
}
