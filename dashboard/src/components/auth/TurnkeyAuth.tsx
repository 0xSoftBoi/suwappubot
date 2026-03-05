"use client";

import React, { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Wallet, LogOut, Loader2, AlertCircle, CheckCircle, Fingerprint } from 'lucide-react';
import { OAuthButtons } from './OAuthButtons';
import { PasskeyAuth } from './PasskeyAuth';

interface TurnkeyAuthProps {
  onSuccess?: () => void;
  compact?: boolean;
  showAllOptions?: boolean;
}

export function TurnkeyAuth({ onSuccess, compact = false, showAllOptions = true }: TurnkeyAuthProps) {
  const {
    isAuthenticated,
    isLoading,
    user,
    address,
    error,
    login,
    loginWithPasskey,
    logout,
    clearError,
    walletAvailable,
    passkeySupported,
    authMethod,
  } = useAuth();

  const [showDropdown, setShowDropdown] = useState(false);
  const [activeTab, setActiveTab] = useState<'wallet' | 'passkey' | 'social'>('wallet');

  const handleLogin = async () => {
    clearError();
    await login();
    if (onSuccess) onSuccess();
  };

  const handleLogout = async () => {
    setShowDropdown(false);
    await logout();
  };

  const truncateAddress = (addr: string) => {
    if (addr.startsWith('oauth:') || addr.startsWith('passkey:')) {
      return addr.split(':').slice(-1)[0].slice(0, 12) + '...';
    }
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  const getAuthMethodLabel = () => {
    switch (authMethod) {
      case 'oauth':
        return 'Social';
      case 'passkey':
        return 'Passkey';
      case 'wallet':
      default:
        return 'Wallet';
    }
  };

  // Compact version for header
  if (compact) {
    if (isAuthenticated && address) {
      return (
        <div className="relative">
          <button
            onClick={() => setShowDropdown(!showDropdown)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 transition-all duration-200"
          >
            <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="text-sm font-medium">{truncateAddress(address)}</span>
          </button>

          {showDropdown && (
            <div className="absolute right-0 mt-2 w-48 rounded-xl bg-[#1A1D26] border border-white/10 shadow-xl overflow-hidden z-50">
              <div className="p-3 border-b border-white/5">
                <p className="text-xs text-gray-400">Connected via {getAuthMethodLabel()}</p>
                <p className="text-sm font-medium truncate">{truncateAddress(address)}</p>
              </div>
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-white/5 transition-colors"
              >
                <LogOut size={16} />
                Disconnect
              </button>
            </div>
          )}
        </div>
      );
    }

    return (
      <button
        onClick={handleLogin}
        disabled={isLoading || !walletAvailable}
        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white font-medium transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isLoading ? (
          <Loader2 size={18} className="animate-spin" />
        ) : (
          <Wallet size={18} />
        )}
        <span className="text-sm">
          {isLoading ? 'Connecting...' : 'Connect Wallet'}
        </span>
      </button>
    );
  }

  // Full card version for auth page
  return (
    <div className="w-full max-w-md mx-auto">
      <div className="glass rounded-2xl p-8 border border-white/10">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center">
            <Wallet size={32} className="text-white" />
          </div>
          <h2 className="text-2xl font-bold mb-2">Welcome to Suwappu</h2>
          <p className="text-gray-400 text-sm">
            Connect securely to access your cross-chain wallet
          </p>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 flex items-start gap-3">
            <AlertCircle size={20} className="text-red-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm text-red-400">{error}</p>
            </div>
          </div>
        )}

        {/* Success State */}
        {isAuthenticated && user && (
          <div className="mb-6 p-4 rounded-xl bg-green-500/10 border border-green-500/20 flex items-start gap-3">
            <CheckCircle size={20} className="text-green-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm text-green-400 font-medium">Connected successfully!</p>
              <p className="text-xs text-gray-400 mt-1">{truncateAddress(address || '')}</p>
            </div>
          </div>
        )}

        {/* Auth options when not authenticated */}
        {!isAuthenticated && showAllOptions && (
          <>
            {/* Tab navigation */}
            <div className="flex gap-1 p-1 mb-6 rounded-xl bg-white/5">
              <button
                onClick={() => setActiveTab('wallet')}
                className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === 'wallet'
                    ? 'bg-white/10 text-white'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                <Wallet size={16} className="inline mr-2" />
                Wallet
              </button>
              {passkeySupported && (
                <button
                  onClick={() => setActiveTab('passkey')}
                  className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                    activeTab === 'passkey'
                      ? 'bg-white/10 text-white'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  <Fingerprint size={16} className="inline mr-2" />
                  Passkey
                </button>
              )}
              <button
                onClick={() => setActiveTab('social')}
                className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === 'social'
                    ? 'bg-white/10 text-white'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                Social
              </button>
            </div>

            {/* Tab content */}
            {activeTab === 'wallet' && (
              <div className="space-y-4">
                {!walletAvailable && (
                  <div className="p-4 rounded-xl bg-yellow-500/10 border border-yellow-500/20 flex items-start gap-3">
                    <AlertCircle size={20} className="text-yellow-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm text-yellow-400">No wallet detected</p>
                      <p className="text-xs text-gray-400 mt-1">
                        Install MetaMask or another Ethereum wallet to continue.
                      </p>
                    </div>
                  </div>
                )}

                <button
                  onClick={handleLogin}
                  disabled={isLoading || !walletAvailable}
                  className="w-full py-4 rounded-xl bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white font-bold transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-blue-600/20"
                >
                  {isLoading ? (
                    <>
                      <Loader2 size={20} className="animate-spin" />
                      Connecting...
                    </>
                  ) : (
                    <>
                      <Wallet size={20} />
                      Connect with MetaMask
                    </>
                  )}
                </button>
              </div>
            )}

            {activeTab === 'passkey' && (
              <PasskeyAuth onSuccess={() => onSuccess?.()} mode="auto" />
            )}

            {activeTab === 'social' && (
              <OAuthButtons showDivider={false} />
            )}
          </>
        )}

        {/* Authenticated actions */}
        {isAuthenticated && (
          <button
            onClick={handleLogout}
            disabled={isLoading}
            className="w-full py-4 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {isLoading ? (
              <Loader2 size={20} className="animate-spin" />
            ) : (
              <LogOut size={20} />
            )}
            Disconnect
          </button>
        )}

        {/* Footer Info */}
        <div className="mt-6 text-center">
          <p className="text-xs text-gray-500">
            By connecting, you agree to our Terms of Service.
            <br />
            Your keys are always secure.
          </p>
        </div>
      </div>
    </div>
  );
}
