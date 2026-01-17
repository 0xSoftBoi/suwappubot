"use client";

import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Loader2, CheckCircle, XCircle } from 'lucide-react';

export default function OAuthCallbackPage({
  params,
}: {
  params: { provider: string };
}) {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [provider] = useState(params.provider);

  useEffect(() => {
    const authStatus = searchParams.get('auth');
    const errorMsg = searchParams.get('error');
    const errorDescription = searchParams.get('error_description');

    if (authStatus === 'success') {
      setStatus('success');
      // Redirect to dashboard after brief delay
      setTimeout(() => {
        window.location.href = '/dashboard';
      }, 1500);
    } else if (errorMsg) {
      setStatus('error');
      setError(errorDescription || errorMsg || 'Authentication failed');
    } else {
      // Still processing or no status - might be initial redirect
      setStatus('loading');
    }
  }, [searchParams]);

  const getProviderName = (p: string) => {
    switch (p) {
      case 'google':
        return 'Google';
      case 'twitter':
        return 'X (Twitter)';
      default:
        return p.charAt(0).toUpperCase() + p.slice(1);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0A0B0F] text-white p-4">
      <div className="w-full max-w-md">
        <div className="glass rounded-2xl p-8 border border-white/10 text-center">
          {status === 'loading' && (
            <>
              <Loader2 size={48} className="mx-auto mb-6 animate-spin text-blue-500" />
              <h2 className="text-xl font-bold mb-2">Authenticating with {getProviderName(provider)}</h2>
              <p className="text-gray-400">Please wait while we complete your sign in...</p>
            </>
          )}

          {status === 'success' && (
            <>
              <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-green-500/20 flex items-center justify-center">
                <CheckCircle size={32} className="text-green-500" />
              </div>
              <h2 className="text-xl font-bold mb-2">Authentication Successful</h2>
              <p className="text-gray-400 mb-4">
                You've signed in with {getProviderName(provider)}
              </p>
              <p className="text-sm text-gray-500">Redirecting to dashboard...</p>
            </>
          )}

          {status === 'error' && (
            <>
              <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-red-500/20 flex items-center justify-center">
                <XCircle size={32} className="text-red-500" />
              </div>
              <h2 className="text-xl font-bold mb-2">Authentication Failed</h2>
              <p className="text-gray-400 mb-4">{error || 'Something went wrong'}</p>
              <div className="flex gap-3 justify-center">
                <button
                  onClick={() => (window.location.href = '/')}
                  className="px-6 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-sm font-medium transition-colors"
                >
                  Back to Login
                </button>
                <button
                  onClick={() => window.location.reload()}
                  className="px-6 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-sm font-medium transition-colors"
                >
                  Try Again
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
