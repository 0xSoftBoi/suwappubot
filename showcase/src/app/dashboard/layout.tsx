'use client';

import { useEffect, useState, useCallback } from 'react';
import Image from 'next/image';
import { TELEGRAM_URL, API_BASE_URL } from '@/lib/links';
import { DashboardAuthContext } from './auth-context';
import styles from './dashboard.module.css';

const TOKEN_KEY = 'suwappu_dashboard_token';

// ── Login screen ────────────────────────────────────────────────────────────

function LoginScreen({ onToken }: { onToken: (t: string) => void }) {
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);

  function handlePaste() {
    // Token pasted manually — validate minimally and store
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
          setErr('Token rejected — check it and try again.');
        } else {
          // Accept any non-401 (even 404) because the org endpoint may not exist in dev
          onToken(t);
        }
      })
      .catch(() => {
        // If the network is down, still let the user in — the page will show errors
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

        <a
          className="summer-button summer-button--primary"
          href={`${TELEGRAM_URL}?start=link`}
          target="_blank"
          rel="noopener noreferrer"
          style={{ display: 'inline-flex', width: '100%', justifyContent: 'center' }}
        >
          Connect via Telegram
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
    setToken(stored);
    setReady(true);
  }, []);

  const handleToken = useCallback((t: string) => {
    localStorage.setItem(TOKEN_KEY, t);
    setToken(t);
  }, []);

  const clearToken = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setToken('');
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
