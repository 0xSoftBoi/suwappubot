// Shared auth context for the dashboard: kept in its own file so layout.tsx
// only exports the default Layout component (required by Next.js App Router).

import { createContext, useContext } from 'react';

export interface AuthCtx {
  token: string;
  clearToken: () => void;
}

/**
 * Marks "authenticated by parent-domain cookie" — there is no token to hold.
 *
 * Exported so the fetch helper can recognise it and NOT send it as a bearer
 * token. Sending it poisons the request: the server prefers the Authorization
 * header over the cookie, so a sentinel string in that header fails JWT
 * verification and 401s a session that was otherwise valid.
 */
export const SESSION_SENTINEL = 'cookie-session';

export const DashboardAuthContext = createContext<AuthCtx>({
  token: '',
  clearToken: () => {},
});

export function useDashboardAuth(): AuthCtx {
  return useContext(DashboardAuthContext);
}
