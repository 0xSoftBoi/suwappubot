/**
 * Onboarding page for wallet creation or import.
 *
 * Flow:
 *   1. Choose "Create new wallet" or "Import mnemonic"
 *   2. Call createPasskey() or getPrfOutput() depending on choice
 *   3. Send to background: createVault(prfOutput) or importVault(prfOutput, mnemonic)
 *   4. Display the generated address on success
 */

import React, { useState } from "react";
import { createPasskey, getPrfOutput } from "@/popup/lib/webauthn";
import { sendToBackground } from "@/popup/lib/bg";

type Step = "choose" | "create" | "import" | "success";

interface OnboardingState {
  step: Step;
  loading: boolean;
  error: string | null;
  address: string | null;
  mnemonic: string;
}

export function Onboarding() {
  const [state, setState] = useState<OnboardingState>({
    step: "choose",
    loading: false,
    error: null,
    address: null,
    mnemonic: "",
  });

  const handleCreateWallet = async () => {
    setState((prev) => ({ ...prev, step: "create", loading: true, error: null }));
    try {
      // 1. Create passkey in authenticator
      await createPasskey("Suwappu Wallet User");

      // 2. Get PRF output via WebAuthn
      const prfOutput = await getPrfOutput();

      // 3. Send to background to create vault (no mnemonic = generate new)
      const response = await sendToBackground({
        type: "createVault",
        prfOutput,
      });

      // On success, extract the address from the response
      const address = (response as any)?.data?.selectedAddress;
      setState((prev) => ({
        ...prev,
        step: "success",
        loading: false,
        address: address || "Vault created",
      }));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setState((prev) => ({ ...prev, loading: false, error: message }));
    }
  };

  const handleImportWallet = async () => {
    setState((prev) => ({ ...prev, step: "import", error: null }));
  };

  const handleImportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const mnemonic = state.mnemonic.trim();
      if (!mnemonic) {
        throw new Error("Mnemonic cannot be empty.");
      }

      // 1. Get PRF output via WebAuthn
      const prfOutput = await getPrfOutput();

      // 2. Send to background to import vault
      const response = await sendToBackground({
        type: "importVault",
        prfOutput,
        mnemonic,
      });

      // On success, extract the address
      const address = (response as any)?.data?.selectedAddress;
      setState((prev) => ({
        ...prev,
        step: "success",
        loading: false,
        address: address || "Vault imported",
      }));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setState((prev) => ({ ...prev, loading: false, error: message }));
    }
  };

  const handleBackClick = () => {
    setState((prev) => ({ ...prev, step: "choose", mnemonic: "", error: null }));
  };

  // Step 1: Choose create or import
  if (state.step === "choose") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-bg text-accent p-4">
        <div className="w-full max-w-sm">
          <h1 className="text-3xl font-bold text-center mb-8 font-mono">Suwappu Wallet</h1>
          <div className="space-y-4">
            <button
              onClick={handleCreateWallet}
              className="w-full px-4 py-3 bg-accent hover:bg-accent-dim text-bg rounded-lg font-medium transition font-mono"
              disabled={state.loading}
            >
              {state.loading ? "Creating..." : "Create New Wallet"}
            </button>
            <button
              onClick={handleImportWallet}
              className="w-full px-4 py-3 bg-surface hover:bg-elevated text-accent rounded-lg font-medium transition font-mono border border-border"
              disabled={state.loading}
            >
              Import Mnemonic
            </button>
          </div>
          {state.error && (
            <div className="mt-4 p-3 bg-danger text-bg rounded text-sm font-mono">{state.error}</div>
          )}
        </div>
      </div>
    );
  }

  // Step 2: Create wallet (creating passkey)
  if (state.step === "create") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-bg text-accent p-4">
        <div className="w-full max-w-sm text-center">
          <h2 className="text-2xl font-bold mb-4 font-mono">Creating Wallet</h2>
          <p className="text-muted mb-6 font-mono text-sm">Unlocking your device's passkey...</p>
          {state.error ? (
            <>
              <div className="p-3 bg-danger text-bg rounded text-sm mb-4 font-mono">{state.error}</div>
              <button
                onClick={handleBackClick}
                className="w-full px-4 py-2 bg-surface hover:bg-elevated text-accent rounded-lg font-medium transition font-mono border border-border"
              >
                Back
              </button>
            </>
          ) : (
            <div className="flex justify-center">
              <div className="w-8 h-8 border-4 border-accent border-t-transparent rounded-full animate-spin" />
            </div>
          )}
        </div>
      </div>
    );
  }

  // Step 3: Import wallet (show mnemonic input)
  if (state.step === "import") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-bg text-accent p-4">
        <div className="w-full max-w-sm">
          <h2 className="text-2xl font-bold mb-4 font-mono">Import Wallet</h2>
          <form onSubmit={handleImportSubmit}>
            <textarea
              value={state.mnemonic}
              onChange={(e) => setState((prev) => ({ ...prev, mnemonic: e.target.value }))}
              placeholder="Enter your 12 or 24 word mnemonic..."
              className="w-full p-3 bg-surface text-accent border border-border rounded-lg font-mono text-sm mb-4 focus:outline-none focus:border-accent placeholder-muted"
              rows={4}
              disabled={state.loading}
            />
            <button
              type="submit"
              className="w-full px-4 py-3 bg-accent hover:bg-accent-dim text-bg rounded-lg font-medium transition disabled:opacity-50 font-mono disabled:bg-border"
              disabled={state.loading || !state.mnemonic.trim()}
            >
              {state.loading ? "Importing..." : "Import Wallet"}
            </button>
            <button
              type="button"
              onClick={handleBackClick}
              className="w-full px-4 py-2 mt-2 bg-surface hover:bg-elevated text-accent rounded-lg font-medium transition font-mono border border-border"
              disabled={state.loading}
            >
              Back
            </button>
          </form>
          {state.error && (
            <div className="mt-4 p-3 bg-danger text-bg rounded text-sm font-mono">{state.error}</div>
          )}
        </div>
      </div>
    );
  }

  // Step 4: Success (show generated address)
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-bg text-accent p-4">
      <div className="w-full max-w-sm text-center">
        <h2 className="text-2xl font-bold mb-4 font-mono">Wallet Created</h2>
        <div className="p-4 bg-surface rounded-lg mb-6 border border-border">
          <p className="text-muted text-sm mb-2 font-mono">Your Address</p>
          <p className="text-lg font-mono break-all">{state.address}</p>
        </div>
        <p className="text-muted text-sm font-mono">Your wallet is now ready to use.</p>
      </div>
    </div>
  );
}
