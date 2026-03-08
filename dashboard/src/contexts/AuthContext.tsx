"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import {
  AuthStatus,
  AuthUser,
  getAuthStatus,
  authenticateWithWallet,
  logout as logoutApi,
  isWalletAvailable,
  getCurrentAddress,
} from '@/lib/turnkey';
import {
  isPasskeySupported,
  authenticateWithPasskey,
  PasskeyAuthResult,
} from '@/lib/turnkey-embedded';

// Auth methods
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
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

export function AuthProvider({ children }: AuthProviderProps) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isWalletConnected, setIsWalletConnected] = useState(false);
  const [walletAvailable, setWalletAvailable] = useState(false);
  const [passkeySupported, setPasskeySupported] = useState(false);
  const [authMethod, setAuthMethod] = useState<AuthMethod>(null);
  const [oauthProvider, setOAuthProvider] = useState<OAuthProvider>(null);
  const [wallets, setWallets] = useState<WalletInfo[]>([]);

  // Check wallet and passkey availability on mount
  useEffect(() => {
    setWalletAvailable(isWalletAvailable());
    setPasskeySupported(isPasskeySupported());

    // Check if wallet is already connected
    getCurrentAddress().then((addr) => {
      if (addr) {
        setIsWalletConnected(true);
        setAddress(addr);
      }
    });

    // Listen for account changes
    if (typeof window !== 'undefined' && (window as any).ethereum) {
      const ethereum = (window as any).ethereum;

      ethereum.on('accountsChanged', (accounts: string[]) => {
        if (accounts.length === 0) {
          setIsWalletConnected(false);
          setAddress(null);
          setIsAuthenticated(false);
          setUser(null);
          setAuthMethod(null);
        } else {
          setAddress(accounts[0]);
          checkAuth();
        }
      });

      ethereum.on('chainChanged', () => {
        window.location.reload();
      });
    }
  }, []);

  // Fetch wallets when authenticated
  const refreshWallets = useCallback(async () => {
    if (!user) return;

    try {
      const response = await fetch(`${API_BASE}/users/${user.id}/wallets`, {
        credentials: 'include',
      });

      if (response.ok) {
        const data = await response.json();
        setWallets(
          data.map((w: any) => ({
            id: String(w.id),
            address: w.address,
            name: w.name || 'Unnamed',
            chainType: w.chainType || 'evm',
            isDefault: w.isDefault || false,
            provider: w.provider || 'local',
          }))
        );
      }
    } catch (err) {
      console.error('Failed to fetch wallets:', err);
    }
  }, [user]);

  useEffect(() => {
    if (isAuthenticated && user) {
      refreshWallets();
    }
  }, [isAuthenticated, user, refreshWallets]);

  // Check authentication status
  const checkAuth = useCallback(async () => {
    try {
      setIsLoading(true);
      const status: AuthStatus = await getAuthStatus();

      setIsAuthenticated(status.authenticated);
      if (status.authenticated && status.address) {
        setAddress(status.address);
        setUser({
          id: status.userId!,
          address: status.address,
          username: `user_${status.userId}`,
        });
        setIsWalletConnected(true);

        // Determine auth method from address pattern
        if (status.address.startsWith('oauth:')) {
          setAuthMethod('oauth');
          const provider = status.address.split(':')[1] as OAuthProvider;
          setOAuthProvider(provider);
        } else if (status.address.startsWith('passkey:')) {
          setAuthMethod('passkey');
        } else {
          setAuthMethod('wallet');
        }
      }
    } catch (err) {
      console.error('Auth check failed:', err);
      setIsAuthenticated(false);
      setUser(null);
      setAuthMethod(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Check auth on mount
  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  // Login with wallet (MetaMask)
  const login = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const session = await authenticateWithWallet();

      if (session.success && session.user) {
        setIsAuthenticated(true);
        setUser(session.user);
        setAddress(session.user.address);
        setIsWalletConnected(true);
        setAuthMethod('wallet');
      } else {
        throw new Error('Authentication failed');
      }
    } catch (err: any) {
      console.error('Login failed:', err);
      setError(err.message || 'Failed to authenticate');
      setIsAuthenticated(false);
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Login with passkey
  const loginWithPasskey = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const result: PasskeyAuthResult = await authenticateWithPasskey();

      if (result.success) {
        setIsAuthenticated(true);
        setUser({
          id: result.userId,
          address: result.walletAddress,
          username: `user_${result.userId}`,
        });
        setAddress(result.walletAddress);
        setAuthMethod('passkey');
      } else {
        throw new Error(result.error || 'Passkey authentication failed');
      }
    } catch (err: any) {
      console.error('Passkey login failed:', err);
      setError(err.message || 'Failed to authenticate with passkey');
      setIsAuthenticated(false);
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Login with OAuth
  const loginWithOAuth = useCallback((provider: 'google' | 'twitter') => {
    // Redirect to OAuth flow
    const authUrl = `${API_BASE}/auth/oauth/${provider}/authorize`;
    window.location.href = authUrl;
  }, []);

  // Logout
  const logout = useCallback(async () => {
    try {
      setIsLoading(true);
      await logoutApi();
      setIsAuthenticated(false);
      setUser(null);
      setAuthMethod(null);
      setOAuthProvider(null);
      setWallets([]);
    } catch (err) {
      console.error('Logout failed:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Clear error
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const value: AuthContextType = {
    isAuthenticated,
    isLoading,
    user,
    address,
    error,
    authMethod,
    oauthProvider,
    wallets,
    login,
    loginWithPasskey,
    loginWithOAuth,
    logout,
    checkAuth,
    clearError,
    refreshWallets,
    isWalletConnected,
    walletAvailable,
    passkeySupported,
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
