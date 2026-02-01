"use client";

import React, { useEffect } from 'react';
import { Loader2 } from 'lucide-react';

/**
 * OAuth callback landing page.
 *
 * With EWK, OAuth callbacks are normally handled by the TurnkeyProvider
 * automatically (via popup or in-page redirect). This page acts as a
 * fallback: if the user lands here, redirect them to the root so the
 * TurnkeyProvider can pick up any pending OAuth state.
 */
export default function OAuthCallbackPage() {
  useEffect(() => {
    // Preserve query params so TurnkeyProvider can process the OAuth response
    const params = window.location.search;
    window.location.href = `/${params}`;
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0A0B0F] text-white p-4">
      <div className="w-full max-w-md text-center">
        <Loader2 size={48} className="mx-auto mb-6 animate-spin text-blue-500" />
        <h2 className="text-xl font-bold mb-2">Completing authentication...</h2>
        <p className="text-gray-400">Redirecting you back to the app.</p>
      </div>
    </div>
  );
}
