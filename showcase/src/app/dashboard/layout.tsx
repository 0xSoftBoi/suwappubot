'use client';

import { useEffect, useState, useCallback } from 'react';
import Image from 'next/image';
import { TELEGRAM_URL, API_BASE_URL, AUTH_BASE_URL } from '@/lib/links';
import TelegramLoginButton from './components/TelegramLoginButton';
import { DashboardAuthContext } from './auth-context';
import styles from './dashboard.module.css';

const TOKEN_KEY = 'suwappu_dashboard_token';

/** Marks "authenticated by cookie" — there is no token to store. */
const SESSION_SENTINEL = 'cookie-session';

// ── Login screen ────────────────────────────────────────────────────────────

function LoginScreen({ onToken }: { onToken: (t: string) => void }) {
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);

  function handlePaste() {
    // Token pasted manually: validate minimally and store
    const t = draft.trim();
    if (!t) {
      setErr('Paste a valid Bearer token to continue.');
      return;
    }
    // Verify the token works against the API before committing
    setErr(null);
    fetch(`${API_BASE_URL}/enterprise/orgs/me`, {
      headers: { Authorization: `Bearer ${t}` },
    })
      .then((r) => {
        if (r.status === 401 || r.status === 403) {
          setErr('Token rejected: check it and try again.');
        } else {
          // Accept any non-401 (even 404) because the org endpoint may not exist in dev
          onToken(t);
        }
      })
      .catch(() => {
        // If the network is down, still let the user in: the page will show errors
        onToken(t);
      });
  }

  return (
    <div className={`summer-page ${styles.loginPage}`}>
      <div className={styles.loginCard}>
        <Image
          src="/logo.svg"
          alt="Suwappu"
          width={52}
          height={52}
          className={styles.loginLogo}
        />
        <h1 className={styles.loginTitle}>Sign in</h1>
        <p className={styles.loginLead}>
          Connect the account you use with Suwappu to see usage, manage API keys
          and handle billing.
        </p>

        {/* Google is the primary path: python-api's OAuth flow is already
            live in production (GET /auth/oauth/providers -> {"google":true})
            and provisions a Turnkey wallet on first sign-in. It leaves an
            HttpOnly session cookie, so there is no token for this page to
            hold — the dashboard probes the session on load. */}
        <a
          className="summer-button summer-button--primary"
          style={{ display: 'inline-flex', width: '100%', justifyContent: 'center' }}
          href={`${AUTH_BASE_URL}/auth/oauth/google/authorize?redirect_url=${encodeURIComponent(
            typeof window !== 'undefined'
              ? `${window.location.origin}/dashboard`
              : 'https://suwappu.bot/dashboard',
          )}`}
        >
          Continue with Google
        </a>

        {/* Telegram is hidden until its domain is registered (see
            TelegramLoginButton), so the divider must not render alone. */}
        <TelegramLoginButton onToken={onToken} onError={setErr} />

        <div className={styles.loginFooterLinks}>
          <a
            className={styles.loginAdvancedToggle}
            href={`${TELEGRAM_URL}?start=link`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open the Suwappu bot
          </a>

        {/* Token entry is a fallback, not a peer of the primary action.
            Presenting "paste a Bearer token" as a co-equal sign-in option made
            the first screen of a paid product read like a debug console, so it
            is collapsed behind a disclosure. */}
          <button
            type="button"
            className={styles.loginAdvancedToggle}
            onClick={() => setShowToken((v) => !v)}
            aria-expanded={showToken}
          >
            {showToken ? 'Hide' : 'Use an access token instead'}
          </button>
        </div>

        {showToken && (<>
        <input
          className={styles.tokenInput}
          type="password"
          placeholder="Bearer eyJ…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handlePaste()}
          aria-label="Access token"
          autoComplete="off"
        />
        <button className={styles.tokenSubmit} onClick={handlePaste}>
          Continue
        </button>
        </>)}

        {err && (
          <p className={styles.loginError} role="alert">
            {err}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Layout root ─────────────────────────────────────────────────────────────

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null); // null = not yet checked
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(TOKEN_KEY) ?? '';
    if (stored) {
      setToken(stored);
      setReady(true);
      return;
    }
    // No pasted token — probe for a parent-domain cookie session. This is the
    // normal path now: Google OAuth and Telegram both leave an HttpOnly cookie
    // that the browser sends to api-ts automatically, so there is nothing for
    // the page to store. Previously the absence of a token meant "logged out",
    // which is why an OAuth round-trip could not sign anyone in.
    let cancelled = false;
    fetch(`${API_BASE_URL}/enterprise/orgs/me`, { credentials: 'include' })
      .then((r) => {
        if (cancelled) return;
        // Any non-401 means the cookie authenticated us. SESSION is a sentinel:
        // there is no token to hold, and holding one would defeat HttpOnly.
        setToken(r.status === 401 ? '' : SESSION_SENTINEL);
      })
      .catch(() => {
        if (!cancelled) setToken('');
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleToken = useCallback((t: string) => {
    localStorage.setItem(TOKEN_KEY, t);
    setToken(t);
  }, []);

  const clearToken = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setToken('');
    // Also end the server session, or a cookie-authenticated user would be
    // signed straight back in by the probe above on the next page load.
    fetch(`${AUTH_BASE_URL}/auth/logout`, {
      method: 'POST',
      credentials: 'include',
    }).catch(() => {});
  }, []);

  // SSR / hydration guard
  if (!ready) return null;

  if (!token) {
    return <LoginScreen onToken={handleToken} />;
  }

  return (
    <DashboardAuthContext.Provider value={{ token, clearToken }}>
      <div className="summer-page">
        <div className={styles.shell} style={{ paddingTop: 24 }}>
          {children}
        </div>
      </div>
    </DashboardAuthContext.Provider>
  );
}
