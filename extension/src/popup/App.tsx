import React, { useEffect, useState } from "react";
import type { WalletState } from "@/shared/protocol";
import { getState, lock } from "./lib/bg";
import { Onboarding } from "./pages/Onboarding";
import { Unlock } from "./pages/Unlock";
import { Accounts } from "./pages/Accounts";
import { Approval } from "./pages/Approval";
import { Settings } from "./pages/Settings";

export function App(): React.ReactElement {
  const [state, setState] = useState<WalletState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  // Fetch state on mount and set up polling interval
  useEffect(() => {
    const fetchState = async () => {
      try {
        setError(null);
        const newState = await getState() as WalletState;
        setState(newState);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch wallet state");
        setState(null);
      } finally {
        setLoading(false);
      }
    };

    fetchState();
    const interval = setInterval(fetchState, 2000);
    return () => clearInterval(interval);
  }, []);

  const handleLock = async () => {
    try {
      await lock();
      setShowSettings(false);
      const newState = await getState() as WalletState;
      setState(newState);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to lock wallet");
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-bg">
        <div className="flex flex-col items-center gap-2">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-accent" />
          <p className="text-xs text-muted">Loading wallet...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-bg p-6">
        <p className="text-center font-mono text-sm text-danger">{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="rounded border border-accent px-3 py-1 font-mono text-xs text-accent hover:bg-elevated"
        >
          Reload
        </button>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="flex h-screen items-center justify-center bg-bg">
        <p className="font-mono text-sm text-muted">No wallet state</p>
      </div>
    );
  }

  // Determine which page to render based on wallet state
  let currentPage: React.ReactElement;

  if (!state.initialized) {
    currentPage = <Onboarding />;
  } else if (!state.unlocked) {
    currentPage = <Unlock />;
  } else if (state.pendingApprovalCount > 0) {
    currentPage = <Approval />;
  } else if (showSettings) {
    currentPage = <Settings onLock={handleLock} />;
  } else {
    currentPage = <Accounts state={state} />;
  }

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      {/* Top bar with brand name, lock button, and settings link */}
      {state.unlocked && !showSettings && (
        <div className="flex items-center justify-between border-b border-border px-6 py-3">
          <div className="font-mono text-sm font-bold text-accent">Suwappu</div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleLock}
              className="rounded bg-surface px-2 py-1 font-mono text-xs text-muted hover:bg-elevated hover:text-accent"
              title="Lock wallet"
            >
              🔒
            </button>
            <button
              onClick={() => setShowSettings(true)}
              className="rounded bg-surface px-2 py-1 font-mono text-xs text-muted hover:bg-elevated hover:text-accent"
              title="Settings"
            >
              ⚙️
            </button>
          </div>
        </div>
      )}

      {/* Page content */}
      <div className="flex-1 overflow-auto">{currentPage}</div>
    </div>
  );
}
