"use client";

import React, { createContext, useContext, useCallback, ReactNode } from 'react';
import { useTurnkey, AuthState, type ClientContextType } from '@turnkey/react-wallet-kit';

// Auth methods — kept for downstream compatibility
export type AuthMethod = 'wallet' | 'oauth' | 'passkey' | null;
export type OAuthProvider = 'google' | 'twitter' | null;

// Wallet info
export interface WalletInfo {
  id: string;
  address: string;
  name: string;
  chainType: 'evm' | 'solana';
  isDefault: boolean;
  provider: 'local' | 'turnkey';
}

// Re-export a compatible AuthUser shape
export interface AuthUser {
  id: string;
  address: string;
  username: string;
}

interface AuthContextType {
  // State
  isAuthenticated: boolean;
  isLoading: boolean;
  user: AuthUser | null;
  address: string | null;
  error: string | null;

  // Auth method info
  authMethod: AuthMethod;
  oauthProvider: OAuthProvider;

  // Wallet state
  wallets: WalletInfo[];
  isWalletConnected: boolean;
  walletAvailable: boolean;
  passkeySupported: boolean;

  // Actions
  login: () => Promise<void>;
  loginWithPasskey: () => Promise<void>;
  loginWithOAuth: (provider: 'google' | 'twitter') => void;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  clearError: () => void;
  refreshWallets: () => Promise<void>;

  // EWK-specific — expose for advanced usage
  turnkey: ClientContextType;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const turnkey = useTurnkey();

  const isAuthenticated = turnkey.authState === AuthState.Authenticated;
  const isLoading = turnkey.clientState?.toString() === 'loading';

  // Map EWK user to our AuthUser shape
  const firstAddress =
    (turnkey.wallets?.[0] as any)?.accounts?.[0]?.address ?? '';

  const user: AuthUser | null = turnkey.user
    ? {
        id: turnkey.user.userId ?? '',
        address: firstAddress,
        username: turnkey.user.userName ?? `user_${turnkey.user.userId}`,
      }
    : null;

  const address = user?.address ?? null;

  // Map EWK wallets to our WalletInfo shape
  const wallets: WalletInfo[] = (turnkey.wallets ?? []).flatMap((w) => {
    const accounts = (w as any).accounts ?? [];
    return accounts.map((acct: any) => ({
      id: acct.walletAccountId ?? w.walletId,
      address: acct.address,
      name: w.walletName ?? 'Unnamed',
      chainType: acct.address?.startsWith('0x') ? 'evm' as const : 'solana' as const,
      isDefault: false,
      provider: 'turnkey' as const,
    }));
  });

  // Login — opens EWK modal
  const login = useCallback(async () => {
    await turnkey.handleLogin();
  }, [turnkey]);

  // Passkey and OAuth both route through handleLogin; EWK modal handles method selection
  const loginWithPasskey = useCallback(async () => {
    await turnkey.handleLogin();
  }, [turnkey]);

  const loginWithOAuth = useCallback(
    (provider: 'google' | 'twitter') => {
      if (provider === 'google') {
        turnkey.handleGoogleOauth().catch(console.error);
      } else {
        turnkey.handleXOauth().catch(console.error);
      }
    },
    [turnkey]
  );

  // Logout
  const logout = useCallback(async () => {
    try {
      await turnkey.logout();
    } catch (err) {
      console.error('Logout failed:', err);
    }
  }, [turnkey]);

  // checkAuth is a no-op; EWK manages session state automatically
  const checkAuth = useCallback(async () => {}, []);

  const clearError = useCallback(() => {}, []);

  const refreshWallets = useCallback(async () => {
    await turnkey.refreshWallets();
  }, [turnkey]);

  const value: AuthContextType = {
    isAuthenticated,
    isLoading,
    user,
    address,
    error: null,
    authMethod: isAuthenticated ? 'wallet' : null,
    oauthProvider: null,
    wallets,
    login,
    loginWithPasskey,
    loginWithOAuth,
    logout,
    checkAuth,
    clearError,
    refreshWallets,
    isWalletConnected: isAuthenticated,
    walletAvailable: true,
    passkeySupported: true,
    turnkey,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

// HOC for protected routes
export function withAuth<P extends object>(
  Component: React.ComponentType<P>
): React.FC<P> {
  return function ProtectedComponent(props: P) {
    const { isAuthenticated, isLoading } = useAuth();

    if (isLoading) {
      return (
        <div className="min-h-screen flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500" />
        </div>
      );
    }

    if (!isAuthenticated) {
      return (
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-center">
            <h2 className="text-2xl font-bold mb-4">Authentication Required</h2>
            <p className="text-gray-400">Please connect your wallet to continue.</p>
          </div>
        </div>
      );
    }

    return <Component {...props} />;
  };
}
