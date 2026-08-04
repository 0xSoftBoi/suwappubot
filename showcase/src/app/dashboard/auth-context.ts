// Shared auth context for the dashboard: kept in its own file so layout.tsx
// only exports the default Layout component (required by Next.js App Router).

import { createContext, useContext } from 'react';

export interface AuthCtx {
  auth: AuthState;
  clearToken: () => void;
}

/**
 * How this browser is authenticated.
 *
 * A discriminated union, NOT a nullable token string. It used to be the
 * latter, with the literal 'cookie-session' stashed in the token slot to mean
 * "authenticated by cookie" — and the fetch helper duly sent that sentinel as
 * `Authorization: Bearer cookie-session`, which the server tried to verify as
 * a JWT and rejected, 401ing a session that was perfectly valid.
 *
 * Guarding the one call site that remembered to check was a bandaid. Modelling
 * the states makes shipping a non-token as a token unrepresentable.
 */
export type AuthState =
  | { kind: 'none' }
  /** Parent-domain HttpOnly cookie carries the session; nothing to send. */
  | { kind: 'cookie' }
  /** A real bearer token the user pasted. */
  | { kind: 'token'; value: string };

export const DashboardAuthContext = createContext<AuthCtx>({
  auth: { kind: 'none' },
  clearToken: () => {},
});

export function useDashboardAuth(): AuthCtx {
  return useContext(DashboardAuthContext);
}
