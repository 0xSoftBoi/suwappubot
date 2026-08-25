'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { API_BASE_URL, AUTH_BASE_URL } from '@/lib/links';
import SignInPanel from '@/components/auth/SignInPanel';
import signInStyles from '@/components/auth/sign-in.module.css';
import { type AuthState, DashboardAuthContext } from './auth-context';
import styles from './dashboard.module.css';

const TOKEN_KEY = 'suwappu_dashboard_token';

function currentDashboardDestination(): string {
  if (typeof window === 'undefined') return 'https://suwappu.bot/dashboard';
  const url = new URL(window.location.href);
  // OAuth result flags are transport metadata, not part of the destination.
  url.searchParams.delete('auth');
  url.searchParams.delete('provider');
  return url.toString();
}

/**
 * The gate shown to an unauthenticated visitor.
 *
 * The card itself is <SignInPanel>, shared verbatim with /login, so the
 * dashboard gate and the standalone sign-in page can never offer a different
 * set of auth methods.
 */
function LoginScreen({ onToken }: { onToken: (t: string) => void }) {
  return (
    <div className={`summer-page ${signInStyles.page}`}>
      <SignInPanel destination={currentDashboardDestination()} onToken={onToken} />
    </div>
  );
}

function WorkspaceNav({ onSignOut }: { onSignOut: () => void }) {
  const linkStyle: React.CSSProperties = {
    color: '#c9d0da', textDecoration: 'none', fontSize: 14, padding: '9px 12px',
    borderRadius: 8, border: '1px solid transparent', whiteSpace: 'nowrap',
  };
  return (
    <div style={{ maxWidth: 1240, margin: '0 auto', padding: '18px 24px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', border: '1px solid #202631', borderRadius: 12, background: '#0d1117', overflowX: 'auto' }}>
        <Link href="/" style={{ ...linkStyle, fontWeight: 800, color: '#fff' }}>suwappu</Link>
        <span style={{ color: '#48505c' }}>/</span>
        <Link href="/dashboard" style={linkStyle}>Home</Link>
        <Link href="/dashboard/signals" style={{ ...linkStyle, color: '#fff', background: '#171d26', borderColor: '#2a3340', fontWeight: 700 }}>Signal Intelligence <span aria-hidden="true">●</span></Link>
        <Link href="/products" style={linkStyle}>All products</Link>
        <Link href="/research" style={linkStyle}>Research</Link>
        <Link href="/docs" style={linkStyle}>Docs</Link>
        <span style={{ flex: 1 }} />
        <button onClick={onSignOut} style={{ ...linkStyle, cursor: 'pointer', background: 'transparent', border: '1px solid #2a313b' }}>Sign out</button>
      </div>
    </div>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(TOKEN_KEY) ?? '';
    if (stored) {
      setAuth({ kind: 'token', value: stored });
      setReady(true);
      return;
    }
    let cancelled = false;
    // Bound the probe. `ready` gates the ENTIRE dashboard, so a request that
    // never settles — API down, a blocked cross-origin preflight, a captive
    // network — left the page blank forever with nothing on screen to explain
    // it or act on. Failing to the sign-in gate is always recoverable; hanging
    // is not.
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 8000);
    fetch(`${API_BASE_URL}/enterprise/orgs/me`, { credentials: 'include', signal: abort.signal })
      .then((r) => {
        if (!cancelled) setAuth(r.status === 401 ? { kind: 'none' } : { kind: 'cookie' });
      })
      .catch(() => { if (!cancelled) setAuth({ kind: 'none' }); })
      .finally(() => {
        clearTimeout(timer);
        if (!cancelled) setReady(true);
      });
    return () => { cancelled = true; clearTimeout(timer); abort.abort(); };
  }, []);

  const handleToken = useCallback((t: string) => {
    localStorage.setItem(TOKEN_KEY, t);
    setAuth({ kind: 'token', value: t });
  }, []);

  const clearToken = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setAuth({ kind: 'none' });
    fetch(`${AUTH_BASE_URL}/auth/logout`, { method: 'POST', credentials: 'include' }).catch(() => {});
  }, []);

  // A bare `return null` here shipped an empty <body> for as long as the
  // session probe took, so every visit to /dashboard began as a blank white
  // page — indistinguishable from the site being down.
  if (!ready) {
    return (
      <div className={`summer-page ${signInStyles.page}`}>
        <p role="status" aria-live="polite" style={{ opacity: 0.7, fontSize: '0.9rem' }}>
          Checking your session…
        </p>
      </div>
    );
  }
  if (!auth || auth.kind === 'none') return <LoginScreen onToken={handleToken} />;

  return (
    <DashboardAuthContext.Provider value={{ auth, clearToken }}>
      <div className="summer-page">
        <WorkspaceNav onSignOut={clearToken} />
        <div className={styles.shell} style={{ paddingTop: 24 }}>{children}</div>
      </div>
    </DashboardAuthContext.Provider>
  );
}
