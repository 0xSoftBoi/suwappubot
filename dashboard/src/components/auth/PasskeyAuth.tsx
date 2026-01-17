"use client";

import React, { useState, useEffect } from 'react';
import {
  Fingerprint,
  Loader2,
  AlertCircle,
  CheckCircle,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import {
  isPasskeySupported,
  isPlatformAuthenticatorAvailable,
  registerPasskey,
  authenticateWithPasskey,
  PasskeyRegistration,
  PasskeyAuthResult,
} from '@/lib/turnkey-embedded';

interface PasskeyAuthProps {
  onSuccess?: (result: PasskeyAuthResult) => void;
  mode?: 'login' | 'register' | 'auto';
  email?: string;
}

export function PasskeyAuth({ onSuccess, mode = 'auto', email }: PasskeyAuthProps) {
  const [isSupported, setIsSupported] = useState<boolean | null>(null);
  const [hasPlatformAuth, setHasPlatformAuth] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Check passkey support on mount
  useEffect(() => {
    const checkSupport = async () => {
      const supported = isPasskeySupported();
      setIsSupported(supported);

      if (supported) {
        const platformAuth = await isPlatformAuthenticatorAvailable();
        setHasPlatformAuth(platformAuth);
      }
    };

    checkSupport();
  }, []);

  const handleRegister = async () => {
    setIsLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const result = await registerPasskey(email);

      if (result.success) {
        setSuccess(`Wallet created: ${result.walletAddress.slice(0, 10)}...`);

        // Auto-login after registration
        const authResult = await authenticateWithPasskey();
        if (authResult.success && onSuccess) {
          onSuccess(authResult);
        }
      } else {
        setError(result.error || 'Registration failed');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to create passkey');
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogin = async () => {
    setIsLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const result = await authenticateWithPasskey();

      if (result.success) {
        setSuccess('Authenticated successfully!');
        if (onSuccess) {
          onSuccess(result);
        }
      } else {
        setError(result.error || 'Authentication failed');
      }
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
    } finally {
      setIsLoading(false);
    }
  };

  // Loading state for support check
  if (isSupported === null) {
    return (
      <div className="flex items-center justify-center p-4">
        <Loader2 className="animate-spin text-gray-400" size={24} />
      </div>
    );
  }

  // Not supported
  if (!isSupported) {
    return (
      <div className="p-4 rounded-xl bg-yellow-500/10 border border-yellow-500/20">
        <div className="flex items-start gap-3">
          <AlertCircle size={20} className="text-yellow-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-yellow-400 font-medium">Passkeys not supported</p>
            <p className="text-xs text-gray-400 mt-1">
              Your browser doesn't support passkeys. Try Chrome, Safari, or Edge.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="text-center">
        <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-gradient-to-br from-purple-600 to-purple-400 flex items-center justify-center">
          <Fingerprint size={24} className="text-white" />
        </div>
        <h3 className="text-lg font-semibold">Passkey Authentication</h3>
        <p className="text-sm text-gray-400 mt-1">
          {mode === 'register'
            ? 'Create a wallet secured by your device'
            : 'Sign in with Face ID, Touch ID, or Windows Hello'}
        </p>
      </div>

      {/* Platform authenticator badge */}
      {hasPlatformAuth && (
        <div className="flex items-center justify-center gap-2 text-xs text-green-400">
          <ShieldCheck size={14} />
          <span>Biometric authentication available</span>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 flex items-start gap-3">
          <AlertCircle size={18} className="text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {/* Success Message */}
      {success && (
        <div className="p-3 rounded-xl bg-green-500/10 border border-green-500/20 flex items-start gap-3">
          <CheckCircle size={18} className="text-green-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-green-400">{success}</p>
        </div>
      )}

      {/* Action Buttons */}
      <div className="space-y-3">
        {(mode === 'login' || mode === 'auto') && (
          <button
            onClick={handleLogin}
            disabled={isLoading}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-purple-600 to-purple-500 hover:from-purple-500 hover:to-purple-400 text-white font-medium transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Fingerprint size={18} />
            )}
            {isLoading ? 'Authenticating...' : 'Sign in with Passkey'}
          </button>
        )}

        {(mode === 'register' || mode === 'auto') && (
          <button
            onClick={handleRegister}
            disabled={isLoading}
            className={`w-full py-3 rounded-xl font-medium transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed ${
              mode === 'register'
                ? 'bg-gradient-to-r from-purple-600 to-purple-500 hover:from-purple-500 hover:to-purple-400 text-white'
                : 'bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300'
            }`}
          >
            {isLoading ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Smartphone size={18} />
            )}
            {isLoading ? 'Creating wallet...' : 'Create Passkey Wallet'}
          </button>
        )}
      </div>

      {/* Info */}
      <div className="text-center">
        <p className="text-xs text-gray-500">
          Passkeys use your device's biometrics or PIN.
          <br />
          Your private key never leaves Turnkey's secure enclave.
        </p>
      </div>
    </div>
  );
}
