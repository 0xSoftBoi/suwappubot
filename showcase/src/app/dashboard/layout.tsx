'use client';

import { useEffect, useState, useCallback } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Bank, ChartLine, ClipboardText, Gauge, ListChecks, Scroll, ShieldCheck,
} from '@phosphor-icons/react';
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
  url.searchParams.delete('auth_error');
  return url.toString();
}

/**
 * Plain-language translations of the backend's `auth_error` slugs
 * (api/routes/oauth.py `_oauth_failure_redirect`). Before this, a failed
 * Google sign-in silently returned the user to the login screen — or worse,
 * to a different product's home page — with the reason living only in the
 * address bar. Nobody reads query strings; the card has to say what happened
 * and what to do next, in words a non-engineer can act on.
 */
const AUTH_ERROR_COPY: Record<string, string> = {
  state_not_found:
    'That sign-in link was stale, so we started over for safety. Please try again.',
  state_expired:
    'The sign-in took a little too long and expired. Please try again — it only needs a few seconds.',
  nonce_missing:
    'We couldn’t confirm this sign-in started on this page, so we stopped it for your security. Please try again from here.',
  nonce_mismatch:
    'We couldn’t confirm this sign-in started on this page, so we stopped it for your security. Please try again from here.',
  provider_rejected:
    'Google couldn’t complete the sign-in. Please try again; if it keeps happening, email support@suwappu.bot and we’ll sort it out.',
};

function readAuthFlags(): { error: string | null; success: boolean } {
  if (typeof window === 'undefined') return { error: null, success: false };
  const params = new URLSearchParams(window.location.search);
  const slug = params.get('auth_error');
  return {
    error: slug
      ? (AUTH_ERROR_COPY[slug] ?? 'Sign-in didn’t complete. Please try again.')
      : null,
    success: params.get('auth') === 'success',
  };
}

/** Drop the OAuth transport flags from the address bar once they're handled,
 *  so a reload or a shared link doesn't replay a stale success/error. */
function clearAuthFlags() {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has('auth') && !url.searchParams.has('auth_error')) return;
  url.searchParams.delete('auth');
  url.searchParams.delete('provider');
  url.searchParams.delete('auth_error');
  window.history.replaceState(null, '', url.toString());
}

function LoginScreen({ onToken, initialError }: { onToken: (t: string) => void; initialError?: string | null }) {
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState<string | null>(initialError ?? null);
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
          <p className={styles.tokenHelp}>
            For advanced setups: paste the access token your administrator or the API gave you.
            Most people can ignore this and use Google above.
          </p>
          <input className={styles.tokenInput} type="password" placeholder="Paste your access token" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handlePaste()} aria-label="Access token" autoComplete="off" />
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

/**
 * Left sidebar nav shared by every /dashboard/* route. Overview is the
 * existing page.tsx content; Signals links out to the pre-existing
 * /dashboard/signals workspace (its own nav lives inside that page). The
 * rest are the enterprise-parity sections from
 * docs/plans/enterprise-dashboard.md — placeholder pages today, filled in by
 * later nodes.
 */
const SIDEBAR_LINKS: [href: string, label: string, icon: React.ReactNode][] = [
  ['/dashboard', 'Overview', <Gauge key="overview" size={17} />],
  ['/dashboard/treasury', 'Treasury', <Bank key="treasury" size={17} />],
  ['/dashboard/transactions', 'Transactions', <ChartLine key="transactions" size={17} />],
  ['/dashboard/policies', 'Policies', <ListChecks key="policies" size={17} />],
  ['/dashboard/compliance', 'Compliance', <ShieldCheck key="compliance" size={17} />],
  ['/dashboard/audit', 'Audit', <Scroll key="audit" size={17} />],
  ['/dashboard/security', 'Security', <ClipboardText key="security" size={17} />],
  ['/dashboard/signals', 'Signal Intelligence', <ChartLine key="signals" size={17} weight="fill" />],
];

function DashboardSidebar() {
  const pathname = usePathname();
  return (
    <nav className={styles.sidebarNav} aria-label="Dashboard sections">
      {SIDEBAR_LINKS.map(([href, label, icon]) => {
        // Overview is the index route — match it exactly so it doesn't stay
        // "active" while looking at every other section.
        const active = href === '/dashboard' ? pathname === href : pathname?.startsWith(href);
        return (
          <Link key={href} href={href} className={styles.sidebarLink} data-active={active || undefined}>
            {icon}
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [ready, setReady] = useState(false);
  // OAuth flags from the URL, captured once. `signingIn` keeps the branded
  // "finishing sign-in" state on screen while the session probe runs, so the
  // moment after Google hands the user back is never a blank page.
  const [loginError, setLoginError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => {
    const flags = readAuthFlags();
    if (flags.error) setLoginError(flags.error);
    if (flags.success) setSigningIn(true);

    const stored = localStorage.getItem(TOKEN_KEY) ?? '';
    if (stored) {
      setAuth({ kind: 'token', value: stored });
      setReady(true);
      clearAuthFlags();
      return;
    }
    let cancelled = false;
    fetch(`${API_BASE_URL}/enterprise/orgs/me`, { credentials: 'include' })
      .then((r) => {
        if (cancelled) return;
        if (r.status === 401) {
          setAuth({ kind: 'none' });
          // Google said success but the session didn't stick — say so instead
          // of silently re-presenting the same login card.
          if (flags.success) {
            setLoginError('We couldn’t finish signing you in. Please try again.');
          }
        } else {
          setAuth({ kind: 'cookie' });
        }
      })
      .catch(() => { if (!cancelled) setAuth({ kind: 'none' }); })
      .finally(() => {
        if (!cancelled) {
          setSigningIn(false);
          setReady(true);
          clearAuthFlags();
        }
      });
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

  if (!ready) {
    // Never a blank page while we check the session — especially right after
    // an OAuth return, when "did that work?" is the only question on screen.
    return (
      <div className={`summer-page ${styles.loginPage}`}>
        <div className={styles.stateBox} role="status">
          <div className={styles.spinner} aria-hidden="true" />
          <span>{signingIn ? 'Finishing sign-in…' : 'Checking your session…'}</span>
        </div>
      </div>
    );
  }
  if (!auth || auth.kind === 'none') return <LoginScreen onToken={handleToken} initialError={loginError} />;

  return (
    <DashboardAuthContext.Provider value={{ auth, clearToken }}>
      <div className="summer-page">
        <WorkspaceNav onSignOut={clearToken} />
        <div className={styles.shell} style={{ paddingTop: 24 }}>
          <div className={styles.shellGrid}>
            <DashboardSidebar />
            <div className={styles.sidebarContent}>{children}</div>
          </div>
        </div>
      </div>
    </DashboardAuthContext.Provider>
  );
}
