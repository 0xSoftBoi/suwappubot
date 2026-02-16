'use client'

import { TurnkeyProvider as TurnkeyEWKProvider } from '@turnkey/react-wallet-kit'

const turnkeyConfig = {
  organizationId: '5cf56ed5-5d6b-4290-8edb-f52670162aab',
  authProxyConfigId: process.env.NEXT_PUBLIC_AUTH_PROXY_CONFIG_ID,
}

export function TurnkeyProvider({ children }: { children: React.ReactNode }) {
  return (
    <TurnkeyEWKProvider config={turnkeyConfig}>
      {children}
    </TurnkeyEWKProvider>
  )
}
