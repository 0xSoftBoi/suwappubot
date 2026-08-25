'use client';

/**
 * /login — the addressable front door.
 *
 * Until now the only web sign-in was rendered *inside* the dashboard's auth
 * gate, so "where do I log in?" had no answer you could link to, bookmark, or
 * put in the nav. This route is that answer; the card is the same
 * <SignInPanel> the dashboard gate renders, so there is exactly one place
 * where the set of auth methods is defined.
 *
 * After a successful sign-in we send the browser to `?next=` when present,
 * else /dashboard.
 */

import { Suspense, useCallback, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import SummerNav from '@/components/SummerNav';
import SignInPanel from '@/components/auth/SignInPanel';
import { API_BASE_URL } from '@/lib/links';
import styles from '@/components/auth/sign-in.module.css';

const TOKEN_KEY = 'suwappu_dashboard_token';

/**
 * Only same-origin, path-absolute destinations. A caller-supplied `next` that
 * could name another origin is an open redirect, and this page is reachable
 * (and linkable) by anyone. `//evil.com` is path-absolute to a reader and
 * protocol-relative to a browser, hence the second check.
 */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/dashboard';
  return raw;
}

function LoginInner() {
  const params = useSearchParams();
  const next = safeNext(params.get('next'));

  const goNext = useCallback(() => {
    // A hard navigation, not router.push: the dashboard layout reads the
    // session cookie during its own mount effect, and a client-side
    // transition can reuse a tree that already decided the user is signed out.
    window.location.assign(next);
  }, [next]);

  // Someone already signed in has no business staring at a sign-in form —
  // but this check does NOT gate the render. Blocking the render on a
  // cross-origin session probe served an empty document to everyone, which is
  // exactly the "the page is just blank" failure this work exists to fix. The
  // form paints immediately; an existing session redirects out from under it.
  useEffect(() => {
    let cancelled = false;
    if (localStorage.getItem(TOKEN_KEY)) {
      goNext();
      return;
    }
    fetch(`${API_BASE_URL}/enterprise/orgs/me`, { credentials: 'include' })
      .then((r) => {
        if (!cancelled && r.status !== 401) goNext();
      })
      .catch(() => {
        /* Offline or API down: leave the form up so the user can still try. */
      });
    return () => {
      cancelled = true;
    };
  }, [goNext]);

  const handleToken = useCallback(
    (t: string) => {
      localStorage.setItem(TOKEN_KEY, t);
      goNext();
    },
    [goNext],
  );

  const destination =
    typeof window === 'undefined' ? 'https://suwappu.bot/dashboard' : `${window.location.origin}${next}`;

  return (
    <div className={styles.page}>
      <SignInPanel destination={destination} onToken={handleToken} onCookieSession={goNext} />
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="summer-page">
      <SummerNav />
      <Suspense fallback={null}>
        <LoginInner />
      </Suspense>
    </div>
  );
}
