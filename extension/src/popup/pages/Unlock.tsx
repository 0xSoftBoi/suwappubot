/**
 * Unlock page — single "Unlock with passkey" button.
 *
 * Flow:
 *   1. User clicks "Unlock"
 *   2. getPrfOutput() prompts for passkey
 *   3. Send to background: unlock(prfOutput)
 *   4. On success, the app router moves to Accounts
 */

import { useState } from "react";
import { getPrfOutput } from "@/popup/lib/webauthn";
import { unlock } from "@/popup/lib/bg";

export function Unlock() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleUnlock = async () => {
    setLoading(true);
    setError(null);

    try {
      // Get PRF output from the user's passkey
      const prfOutput = await getPrfOutput();

      // Send to background to unlock the vault
      await unlock(prfOutput);

      // On success, the app will re-fetch state and route to Accounts
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-bg text-accent p-4">
      <div className="w-full max-w-sm text-center">
        <h1 className="text-3xl font-bold mb-8 font-mono">Suwappu Wallet</h1>
        <p className="text-muted mb-8 font-mono text-sm">Your wallet is locked. Unlock with your passkey to continue.</p>

        <button
          onClick={handleUnlock}
          disabled={loading}
          className="w-full px-4 py-4 bg-accent hover:bg-accent-dim disabled:bg-border disabled:opacity-50 text-bg rounded-lg font-medium text-lg transition font-mono"
        >
          {loading ? "Unlocking..." : "Unlock with Passkey"}
        </button>

        {error && (
          <div className="mt-4 p-3 bg-danger text-bg rounded text-sm font-mono">{error}</div>
        )}
      </div>
    </div>
  );
}
