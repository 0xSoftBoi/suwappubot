'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { SettingsProvider } from './SettingsProvider';
import { TxProvider, TxToasts } from './TxProvider';
import { WalletProvider } from './WalletProvider';

export function DappProviders({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            refetchOnWindowFocus: false,
            staleTime: 10_000,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={client}>
      <WalletProvider>
        <SettingsProvider>
          <TxProvider>
            {children}
            <TxToasts />
          </TxProvider>
        </SettingsProvider>
      </WalletProvider>
    </QueryClientProvider>
  );
}
