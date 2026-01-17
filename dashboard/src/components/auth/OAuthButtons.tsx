"use client";

import React, { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

interface OAuthProvider {
  id: string;
  name: string;
  icon: React.ReactNode;
  color: string;
  hoverColor: string;
}

interface OAuthButtonsProps {
  onSuccess?: () => void;
  redirectUrl?: string;
  showDivider?: boolean;
}

// Google icon SVG
const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24">
    <path
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      fill="#4285F4"
    />
    <path
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      fill="#34A853"
    />
    <path
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      fill="#FBBC05"
    />
    <path
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      fill="#EA4335"
    />
  </svg>
);

// Twitter/X icon SVG
const TwitterIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

const OAUTH_PROVIDERS: OAuthProvider[] = [
  {
    id: 'google',
    name: 'Google',
    icon: <GoogleIcon />,
    color: 'bg-white text-gray-800',
    hoverColor: 'hover:bg-gray-100',
  },
  {
    id: 'twitter',
    name: 'X (Twitter)',
    icon: <TwitterIcon />,
    color: 'bg-black text-white',
    hoverColor: 'hover:bg-gray-900',
  },
];

export function OAuthButtons({
  onSuccess,
  redirectUrl,
  showDivider = true,
}: OAuthButtonsProps) {
  const [loadingProvider, setLoadingProvider] = useState<string | null>(null);
  const [availableProviders, setAvailableProviders] = useState<Record<string, boolean>>({});
  const [isCheckingProviders, setIsCheckingProviders] = useState(true);

  // Check which OAuth providers are available
  useEffect(() => {
    const checkProviders = async () => {
      try {
        const response = await fetch(`${API_BASE}/auth/oauth/providers`);
        if (response.ok) {
          const data = await response.json();
          setAvailableProviders(data);
        }
      } catch {
        // If check fails, show all providers (they'll redirect to error if not configured)
        setAvailableProviders({ google: true, twitter: true });
      } finally {
        setIsCheckingProviders(false);
      }
    };

    checkProviders();
  }, []);

  const handleOAuthLogin = async (providerId: string) => {
    setLoadingProvider(providerId);

    // Build OAuth URL with optional redirect
    let authUrl = `${API_BASE}/auth/oauth/${providerId}/authorize`;
    if (redirectUrl) {
      authUrl += `?redirect_url=${encodeURIComponent(redirectUrl)}`;
    }

    // Redirect to OAuth provider
    window.location.href = authUrl;
  };

  // Check if any providers are available
  const hasAvailableProviders = Object.values(availableProviders).some(Boolean);

  // Don't show if no providers configured
  if (isCheckingProviders) {
    return (
      <div className="flex justify-center py-4">
        <Loader2 size={20} className="animate-spin text-gray-400" />
      </div>
    );
  }

  if (!hasAvailableProviders) {
    return null;
  }

  const enabledProviders = OAUTH_PROVIDERS.filter(
    (p) => availableProviders[p.id]
  );

  return (
    <div className="space-y-4">
      {showDivider && (
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-white/10" />
          </div>
          <div className="relative flex justify-center text-xs">
            <span className="px-4 bg-[#12141A] text-gray-500">
              or continue with
            </span>
          </div>
        </div>
      )}

      <div className="grid gap-3">
        {enabledProviders.map((provider) => (
          <button
            key={provider.id}
            onClick={() => handleOAuthLogin(provider.id)}
            disabled={loadingProvider !== null}
            className={`w-full py-3 px-4 rounded-xl font-medium transition-all duration-200 flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed ${provider.color} ${provider.hoverColor}`}
          >
            {loadingProvider === provider.id ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              provider.icon
            )}
            <span>
              {loadingProvider === provider.id
                ? 'Redirecting...'
                : `Continue with ${provider.name}`}
            </span>
          </button>
        ))}
      </div>

      <p className="text-xs text-center text-gray-500">
        By continuing, you agree to our Terms of Service and Privacy Policy.
      </p>
    </div>
  );
}

// Callback handler component for OAuth redirects
export function OAuthCallback() {
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authStatus = params.get('auth');
    const provider = params.get('provider');
    const errorMsg = params.get('error');

    if (authStatus === 'success') {
      setStatus('success');
      // Redirect to dashboard after brief delay
      setTimeout(() => {
        window.location.href = '/dashboard';
      }, 1500);
    } else if (errorMsg) {
      setStatus('error');
      setError(errorMsg);
    } else {
      // No auth params, redirect to login
      window.location.href = '/';
    }
  }, []);

  if (status === 'loading') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[200px] gap-4">
        <Loader2 size={32} className="animate-spin text-blue-500" />
        <p className="text-gray-400">Completing authentication...</p>
      </div>
    );
  }

  if (status === 'success') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[200px] gap-4">
        <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center">
          <svg
            className="w-8 h-8 text-green-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 13l4 4L19 7"
            />
          </svg>
        </div>
        <p className="text-green-400 font-medium">Authentication successful!</p>
        <p className="text-sm text-gray-400">Redirecting to dashboard...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[200px] gap-4">
      <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center">
        <svg
          className="w-8 h-8 text-red-500"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </div>
      <p className="text-red-400 font-medium">Authentication failed</p>
      <p className="text-sm text-gray-400">{error || 'Please try again'}</p>
      <button
        onClick={() => (window.location.href = '/')}
        className="mt-4 px-6 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-sm font-medium transition-colors"
      >
        Back to Login
      </button>
    </div>
  );
}
