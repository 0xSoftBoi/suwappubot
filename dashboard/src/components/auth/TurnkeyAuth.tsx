"use client";

import React, { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Wallet, LogOut, Loader2 } from 'lucide-react';

interface TurnkeyAuthProps {
  onSuccess?: () => void;
  compact?: boolean;
  showAllOptions?: boolean;
}

export function TurnkeyAuth({ onSuccess, compact = false }: TurnkeyAuthProps) {
  const {
    isAuthenticated,
    isLoading,
    address,
    login,
    logout,
    authMethod,
  } = useAuth();

  const [showDropdown, setShowDropdown] = useState(false);

  const handleLogin = async () => {
    await login();
    onSuccess?.();
  };

  const handleLogout = async () => {
    setShowDropdown(false);
    await logout();
  };

  const truncateAddress = (addr: string) => {
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
        disabled={isLoading}
        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white font-medium transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isLoading ? (
          <Loader2 size={18} className="animate-spin" />
        ) : (
          <Wallet size={18} />
        )}
        <span className="text-sm">
          {isLoading ? 'Connecting...' : 'Connect'}
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

        {/* Login / Logout */}
        {!isAuthenticated ? (
          <button
            onClick={handleLogin}
            disabled={isLoading}
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
                Connect
              </>
            )}
          </button>
        ) : (
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-green-500/10 border border-green-500/20 text-center">
              <p className="text-sm text-green-400 font-medium">Connected</p>
              {address && (
                <p className="text-xs text-gray-400 mt-1">{truncateAddress(address)}</p>
              )}
            </div>
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
          </div>
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
