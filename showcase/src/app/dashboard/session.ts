// The single session probe shared by the dashboard shell (client) and the
// signals proxy (server). Kept out of layout.tsx because a Next.js App Router
// layout may only export the default component — see auth-context.ts.

import { AUTH_BASE_URL } from '@/lib/links';

/**
 * Is this browser signed in? — the ONLY question either gate should ask.
 *
 * Both gates used to ask `/enterprise/orgs/me`, which sits behind
 * `requireTier('enterprise')`. So Google sign-in worked perfectly and then
 * every surface behind it refused you: the probe came back 403 (right session,
 * wrong plan) and the signals proxy read that as "not logged in", 401ing every
 * request the Signal Intelligence page makes. Being signed in is not the same
 * question as being entitled to enterprise org administration, and a sign-in
 * gate must only ask the first one.
 *
 * `/auth/me` is that question. It is tier-free, accepts the parent-domain
 * `suwappu_auth` cookie minted by every auth flow (Google, Telegram, passkey,
 * SIWE) as well as a pasted bearer, and — importantly — answers **200 with
 * `authenticated: false`** when there is no session. Status alone is not the
 * answer here; the body is.
 */
export async function probeSession(init: RequestInit = {}): Promise<boolean> {
  try {
    const res = await fetch(`${AUTH_BASE_URL}/auth/me`, {
      ...init,
      cache: 'no-store',
      headers: { Accept: 'application/json', ...(init.headers ?? {}) },
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { authenticated?: boolean };
    return body?.authenticated === true;
  } catch {
    return false;
  }
}
