// Shared auth context for the dashboard — kept in its own file so layout.tsx
// only exports the default Layout component (required by Next.js App Router).

import { createContext, useContext } from 'react';

export interface AuthCtx {
  token: string;
  clearToken: () => void;
}

export const DashboardAuthContext = createContext<AuthCtx>({
  token: '',
  clearToken: () => {},
});

export function useDashboardAuth(): AuthCtx {
  return useContext(DashboardAuthContext);
}
