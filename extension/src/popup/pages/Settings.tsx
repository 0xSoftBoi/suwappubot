/**
 * Settings page — app version, lock button, backup to KMS (placeholder), and approved origins list.
 *
 * Features:
 *   - Display app version
 *   - Lock wallet button
 *   - Placeholder "Back up to Suwappu (KMS)" button (TODO: implement server-side backup)
 *   - List of connected/approved origins
 */

import { useEffect, useState } from "react";
import { lock } from "@/popup/lib/bg";

interface SettingsProps {
  onLock?: () => void;
}

interface ApprovedOrigin {
  origin: string;
  approvedAt?: string;
}

export function Settings({ onLock }: SettingsProps) {
  const [approvedOrigins, setApprovedOrigins] = useState<ApprovedOrigin[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const version = "0.1.0";

  useEffect(() => {
    // Fetch approved origins from chrome.storage (assumes background has a handler for this)
    // For now, we'll show a static message if this is not yet wired
    loadApprovedOrigins();
  }, []);

  const loadApprovedOrigins = async () => {
    try {
      // This would typically be a chrome.storage.local.get("approved_origins") call
      // or a sendToBackground request to fetch them. For now, we'll use chrome.storage directly
      // since this is not a secret operation.
      chrome.storage.local.get("approved_origins", (result: any) => {
        if (result.approved_origins && typeof result.approved_origins === "object") {
          const origins = Object.keys(result.approved_origins).map((origin) => ({
            origin,
            approvedAt: (result.approved_origins[origin] as any)?.approvedAt,
          }));
          setApprovedOrigins(origins);
        }
      });
    } catch (err: unknown) {
      console.error("Failed to load approved origins:", err);
    }
  };

  const handleLock = async () => {
    setLoading(true);
    setError(null);

    try {
      await lock();
      onLock?.();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setLoading(false);
    }
  };

  // TODO: Implement KMS backup flow once server-side passkey verification exists.
  // Blocked on the missing `passkey_credentials` table (server-side) — without
  // verified passkey credentials we cannot authenticate the encrypted-vault upload.
  // When unblocked this would:
  //   1. Prompt user for confirmation
  //   2. Verify the user's passkey against passkey_credentials
  //   3. Send the encrypted vault to api.suwappu.bot/backup-blob
  //   4. Store the backup reference locally
  // Until then the button below is rendered disabled (no network call wired).

  return (
    <div className="min-h-screen bg-bg text-accent p-4">
      <div className="w-full max-w-sm mx-auto">
        <h1 className="text-2xl font-bold mb-6 font-mono">Settings</h1>

        {/* Version */}
        <div className="bg-surface rounded-lg p-4 mb-4 border border-border">
          <p className="text-muted text-sm mb-1 font-mono">App Version</p>
          <p className="text-accent font-mono">{version}</p>
        </div>

        {/* Approved Origins */}
        {approvedOrigins.length > 0 && (
          <div className="mb-4">
            <p className="text-muted text-sm mb-2 font-mono">Connected Origins</p>
            <div className="space-y-2 max-h-40 overflow-y-auto">
              {approvedOrigins.map((item) => (
                <div key={item.origin} className="bg-surface rounded p-2 border border-border">
                  <p className="text-xs font-mono break-all text-accent">{item.origin}</p>
                  {item.approvedAt && (
                    <p className="text-xs text-muted mt-1">
                      {new Date(item.approvedAt).toLocaleString()}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Error Display */}
        {error && <div className="mb-4 p-3 bg-danger text-bg rounded text-sm font-mono">{error}</div>}

        {/* Action Buttons */}
        <div className="space-y-3">
          <button
            type="button"
            disabled
            title="Coming soon — requires server-side passkey verification"
            className="w-full px-4 py-3 bg-warn text-bg rounded-lg font-medium transition text-sm font-mono opacity-50 cursor-not-allowed"
          >
            Back up to Suwappu (KMS) — coming soon
          </button>
          <button
            onClick={handleLock}
            disabled={loading}
            className="w-full px-4 py-3 bg-danger hover:bg-warn disabled:bg-border disabled:opacity-50 text-bg rounded-lg font-medium transition font-mono"
          >
            {loading ? "Locking..." : "Lock Wallet"}
          </button>
        </div>
      </div>
    </div>
  );
}
