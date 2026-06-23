/**
 * Accounts page — show selected address, chain selector, copy buttons, and lock.
 *
 * Features:
 *   - Display selected EVM and SOL addresses
 *   - Chain selector (switchChain)
 *   - Copy address buttons
 *   - Lock button
 */

import { useEffect, useState } from "react";
import type { WalletState } from "@/shared/protocol";
import { lock, switchChain } from "@/popup/lib/bg";

interface AccountsProps {
  state: WalletState;
  onStateChange?: () => void;
}

const CHAIN_NAMES: Record<number, string> = {
  1: "Ethereum",
  8453: "Base",
  42161: "Arbitrum",
  10: "Optimism",
  137: "Polygon",
  56: "BSC",
};

export function Accounts({ state, onStateChange }: AccountsProps) {
  const [copied, setCopied] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (copied) {
      const timer = setTimeout(() => setCopied(null), 2000);
      return () => clearTimeout(timer);
    }
  }, [copied]);

  const handleCopyAddress = (address: string, label: string) => {
    navigator.clipboard.writeText(address);
    setCopied(label);
  };

  const handleSwitchChain = async (chainId: number) => {
    setLoading(true);
    setError(null);

    try {
      await switchChain(chainId);
      onStateChange?.();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleLock = async () => {
    setLoading(true);
    setError(null);

    try {
      await lock();
      onStateChange?.();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-bg text-accent p-4">
      <div className="w-full max-w-sm mx-auto">
        <h1 className="text-2xl font-bold mb-6 font-mono">My Wallet</h1>

        {/* Selected Address */}
        <div className="bg-surface rounded-lg p-4 mb-4 border border-border">
          <p className="text-muted text-sm mb-2 font-mono">Selected Address</p>
          <p className="text-sm font-mono break-all mb-3">{state.selectedAddress}</p>
          <button
            onClick={() => handleCopyAddress(state.selectedAddress || "", "Address")}
            className="w-full px-3 py-2 text-sm bg-elevated hover:bg-border text-accent rounded transition font-mono"
          >
            {copied === "Address" ? "Copied!" : "Copy Address"}
          </button>
        </div>

        {/* Chain Selector */}
        <div className="mb-4">
          <p className="text-muted text-sm mb-2 font-mono">Active Chain</p>
          <select
            value={state.selectedChainId}
            onChange={(e) => handleSwitchChain(Number(e.target.value))}
            disabled={loading}
            className="w-full px-3 py-2 bg-surface text-accent border border-border rounded-lg focus:outline-none focus:border-accent font-mono"
          >
            {Object.entries(CHAIN_NAMES).map(([chainId, name]) => (
              <option key={chainId} value={chainId}>
                {name}
              </option>
            ))}
          </select>
        </div>

        {/* All Accounts List */}
        {state.accounts.length > 0 && (
          <div className="mb-6">
            <p className="text-muted text-sm mb-2 font-mono">All Accounts</p>
            <div className="space-y-2 max-h-40 overflow-y-auto">
              {state.accounts.map((addr) => (
                <div key={addr} className="flex items-center justify-between bg-surface rounded p-2 border border-border">
                  <p className="text-xs font-mono truncate flex-1 text-muted">{addr}</p>
                  <button
                    onClick={() => handleCopyAddress(addr, addr)}
                    className="ml-2 px-2 py-1 text-xs bg-elevated hover:bg-border text-accent rounded transition"
                  >
                    {copied === addr ? "✓" : "📋"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Error Display */}
        {error && <div className="mb-4 p-3 bg-danger text-bg rounded text-sm font-mono">{error}</div>}

        {/* Lock Button */}
        <button
          onClick={handleLock}
          disabled={loading}
          className="w-full px-4 py-3 bg-danger hover:bg-warn disabled:bg-border disabled:opacity-50 text-bg rounded-lg font-medium transition font-mono"
        >
          {loading ? "Locking..." : "Lock Wallet"}
        </button>
      </div>
    </div>
  );
}
