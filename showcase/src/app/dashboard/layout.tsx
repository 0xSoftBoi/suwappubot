'use client';

import { useEffect, useState, useCallback } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { TELEGRAM_URL, API_BASE_URL, AUTH_BASE_URL } from '@/lib/links';
import TelegramLoginButton from './components/TelegramLoginButton';
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

function LoginScreen({ onToken }: { onToken: (t: string) => void }) {
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);

  function handlePaste() {
    const t = draft.trim();
    if (!t) {
      setErr('Paste a valid Bearer token to continue.');
      return;
    }
    setErr(null);
    fetch(`${API_BASE_URL}/enterprise/orgs/me`, {
      headers: { Authorization: `Bearer ${t}` },
    })
      .then((r) => {
        if (r.status === 401 || r.status === 403) setErr('Token rejected: check it and try again.');
        else onToken(t);
      })
      .catch(() => onToken(t));
  }

  const destination = currentDashboardDestination();

  return (
    <div className={`summer-page ${styles.loginPage}`}>
      <div className={styles.loginCard}>
        <Image src="/logo.svg" alt="Suwappu" width={52} height={52} className={styles.loginLogo} />
        <h1 className={styles.loginTitle}>Sign in to Suwappu</h1>
        <p className={styles.loginLead}>Continue to the product you opened. Your account also gives you Signal Intelligence, API management, and billing in one workspace.</p>
        <a
          className="summer-button summer-button--primary"
          style={{ display: 'inline-flex', width: '100%', justifyContent: 'center' }}
          href={`${AUTH_BASE_URL}/auth/oauth/google/authorize?redirect_url=${encodeURIComponent(destination)}`}
        >
          Continue with Google
        </a>
        <TelegramLoginButton onToken={onToken} onError={setErr} />
        <div className={styles.loginFooterLinks}>
          <a className={styles.loginAdvancedToggle} href={`${TELEGRAM_URL}?start=link`} target="_blank" rel="noopener noreferrer">Open the Suwappu bot</a>
          <button type="button" className={styles.loginAdvancedToggle} onClick={() => setShowToken((v) => !v)} aria-expanded={showToken}>
            {showToken ? 'Hide' : 'Use an access token instead'}
          </button>
        </div>
        {showToken && (<>
          <input className={styles.tokenInput} type="password" placeholder="Bearer eyJ…" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handlePaste()} aria-label="Access token" autoComplete="off" />
          <button className={styles.tokenSubmit} onClick={handlePaste}>Continue</button>
        </>)}
        {err && <p className={styles.loginError} role="alert">{err}</p>}
      </div>
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
        <Link href="/dashboard/bots" style={linkStyle}>Bots</Link>
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
    fetch(`${API_BASE_URL}/enterprise/orgs/me`, { credentials: 'include' })
      .then((r) => {
        if (!cancelled) setAuth(r.status === 401 ? { kind: 'none' } : { kind: 'cookie' });
      })
      .catch(() => { if (!cancelled) setAuth({ kind: 'none' }); })
      .finally(() => { if (!cancelled) setReady(true); });
    return () => { cancelled = true; };
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

  if (!ready) return null;
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
