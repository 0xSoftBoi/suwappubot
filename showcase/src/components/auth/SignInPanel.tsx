'use client';

/**
 * The one sign-in surface for the web product.
 *
 * Every auth method the backend already supports is presented here as a peer:
 * Google, Telegram, MetaMask, Phantom. Previously the only web sign-in lived
 * inline in the dashboard layout and offered Google plus "paste a bearer
 * token" — the wallet endpoints (/auth/turnkey/*, /auth/solana/*) had shipped
 * months earlier with nothing on the web calling them.
 *
 * Shared, not copied: rendered both by /login (a real, linkable route) and by
 * the dashboard's auth gate, so the two can never drift apart.
 *
 * All four methods converge on the SAME `suwappu_auth` cookie on the parent
 * domain, which is why `onAuthenticated` takes no argument for the cookie
 * cases — the caller re-checks the session rather than threading a token
 * around. Only the Telegram widget and the token escape hatch hand back a
 * bearer, and both are optional extras on top of the cookie.
 */

import { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import { AUTH_BASE_URL, API_BASE_URL, TELEGRAM_URL } from '@/lib/links';
import {
  WalletLoginCancelled,
  WALLET_INSTALL_URL,
  isWalletAvailable,
  loginWithWallet,
  type WalletKind,
} from '@/lib/wallet-login';
import TelegramLoginButton from '@/app/dashboard/components/TelegramLoginButton';
import styles from './sign-in.module.css';

interface Props {
  /** Where to send the browser after a wallet/Google sign-in completes. */
  destination: string;
  /** Called with a bearer token for the methods that produce one. */
  onToken: (token: string) => void;
  /** Called after a cookie-session sign-in (wallets). */
  onCookieSession?: () => void;
}

type Busy = WalletKind | null;

const GOOGLE_MARK = (
  <svg width="17" height="17" viewBox="0 0 18 18" aria-hidden="true">
    <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" />
    <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z" />
    <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z" />
    <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
  </svg>
);

const METAMASK_MARK = (
  <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="#E2761B" d="m21.8 2.4-8.2 6.1 1.5-3.6 6.7-2.5Z" />
    <path fill="#E4761B" d="m2.2 2.4 8.1 6.2-1.4-3.7-6.7-2.5ZM18.9 16.2l-2.2 3.3 4.7 1.3 1.3-4.5-3.8-.1ZM1.3 16.3l1.3 4.5 4.7-1.3-2.2-3.3-3.8.1Z" />
    <path fill="#E4761B" d="m7 10.6-1.3 2 4.6.2-.1-5-3.2 2.8ZM17 10.6l-3.3-2.9-.1 5.1 4.6-.2-1.2-2ZM7 19.5l2.8-1.4-2.4-1.9-.4 3.3ZM14.2 18.1l2.8 1.4-.4-3.3-2.4 1.9Z" />
  </svg>
);

const PHANTOM_MARK = (
  <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
    <rect width="24" height="24" rx="6" fill="#AB9FF2" />
    <path
      fill="#fff"
      d="M19.4 12.1c0 3.6-2.9 6.5-6.5 6.5H5.3c-.4 0-.6-.4-.4-.7 1-1.5 2.4-3.6 2.4-5.9 0-3 2-5.1 4.5-5.1s4.4 2 4.4 4.6c0 .8.4 1.3 1 1.3s1-.5 1-1.3c0-.2 0-.4.1-.6.3 0 .6.5.6 1.2Z"
    />
    <circle cx="10" cy="11.4" r="1" fill="#AB9FF2" />
    <circle cx="13.2" cy="11.4" r="1" fill="#AB9FF2" />
  </svg>
);

export default function SignInPanel({ destination, onToken, onCookieSession }: Props) {
  const [busy, setBusy] = useState<Busy>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [draft, setDraft] = useState('');

  // Extension detection only exists after hydration — `window.ethereum` is
  // injected client-side, so deciding "Install MetaMask" vs "Continue with
  // MetaMask" during SSR would render the wrong label and hydrate mismatched.
  const [detected, setDetected] = useState<Record<WalletKind, boolean>>({
    evm: false,
    solana: false,
  });
  useEffect(() => {
    // Extensions can inject slightly after first paint; re-check once.
    const check = () =>
      setDetected({ evm: isWalletAvailable('evm'), solana: isWalletAvailable('solana') });
    check();
    const t = setTimeout(check, 400);
    return () => clearTimeout(t);
  }, []);

  const signInWithWallet = useCallback(
    async (kind: WalletKind) => {
      if (!isWalletAvailable(kind)) {
        window.open(WALLET_INSTALL_URL[kind], '_blank', 'noopener,noreferrer');
        return;
      }
      setBusy(kind);
      setErr(null);
      try {
        const { token } = await loginWithWallet(kind);
        onToken(token);
        onCookieSession?.();
      } catch (e) {
        // A closed wallet popup is a normal outcome, not a failure to report.
        if (!(e instanceof WalletLoginCancelled)) {
          setErr(e instanceof Error ? e.message : 'Wallet sign-in failed.');
        }
      } finally {
        setBusy(null);
      }
    },
    [onToken, onCookieSession],
  );

  function submitToken() {
    const t = draft.trim();
    if (!t) {
      setErr('Paste a valid Bearer token to continue.');
      return;
    }
    setErr(null);
    fetch(`${API_BASE_URL}/enterprise/orgs/me`, { headers: { Authorization: `Bearer ${t}` } })
      .then((r) => {
        if (r.status === 401 || r.status === 403) setErr('Token rejected: check it and try again.');
        else onToken(t);
      })
      .catch(() => onToken(t));
  }

  const googleHref = `${AUTH_BASE_URL}/auth/oauth/google/authorize?redirect_url=${encodeURIComponent(destination)}`;

  return (
    <div className={styles.card}>
      <Image src="/logo.svg" alt="Suwappu" width={52} height={52} className={styles.logo} />
      <h1 className={styles.title}>Sign in to Suwappu</h1>
      <p className={styles.lead}>
        One account across the bot, the terminal, and the API. Sign in with an email account or
        connect a wallet — either way you land in the same workspace.
      </p>

      <div className={styles.methods}>
        <a className={`${styles.method} ${styles.methodPrimary}`} href={googleHref}>
          {GOOGLE_MARK}
          <span>Continue with Google</span>
        </a>

        <TelegramLoginButton onToken={onToken} onError={setErr} />

        <button
          type="button"
          className={styles.method}
          onClick={() => signInWithWallet('evm')}
          disabled={busy !== null}
        >
          {METAMASK_MARK}
          <span>
            {busy === 'evm'
              ? 'Check your wallet…'
              : detected.evm
                ? 'Continue with MetaMask'
                : 'Install MetaMask'}
          </span>
        </button>

        <button
          type="button"
          className={styles.method}
          onClick={() => signInWithWallet('solana')}
          disabled={busy !== null}
        >
          {PHANTOM_MARK}
          <span>
            {busy === 'solana'
              ? 'Check your wallet…'
              : detected.solana
                ? 'Continue with Phantom'
                : 'Install Phantom'}
          </span>
        </button>
      </div>

      <p className={styles.walletNote}>
        Connecting a wallet is a signature, not a transaction. It never moves funds and we never
        hold your keys.
      </p>

      <div className={styles.footerLinks}>
        <a href={`${TELEGRAM_URL}?start=link`} target="_blank" rel="noopener noreferrer">
          Open the Suwappu bot
        </a>
        <button type="button" onClick={() => setShowToken((v) => !v)} aria-expanded={showToken}>
          {showToken ? 'Hide' : 'Use an access token instead'}
        </button>
      </div>

      {showToken && (
        <>
          <input
            className={styles.tokenInput}
            type="password"
            placeholder="Bearer eyJ…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submitToken()}
            aria-label="Access token"
            autoComplete="off"
          />
          <button className={styles.tokenSubmit} onClick={submitToken}>
            Continue
          </button>
        </>
      )}

      {err && (
        <p className={styles.error} role="alert">
          {err}
        </p>
      )}
    </div>
  );
}
