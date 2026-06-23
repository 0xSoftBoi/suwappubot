/**
 * Approval page — render pending ApprovalRequest and handle approve/reject.
 *
 * Displays the first pending approval, decoded by kind (connect/signMessage/signTypedData/sendTransaction),
 * showing origin, details, and Approve/Reject buttons.
 */

import { useEffect, useState } from "react";
import type { ApprovalRequest } from "@/shared/protocol";
import { listPendingApprovals, resolveApproval } from "@/popup/lib/bg";

interface ApprovalProps {
  onResolve?: () => void;
}

export function Approval({ onResolve }: ApprovalProps) {
  const [approval, setApproval] = useState<ApprovalRequest | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchPendingApprovals();
  }, []);

  const fetchPendingApprovals = async () => {
    try {
      const approvals = (await listPendingApprovals()) as ApprovalRequest[];
      if (approvals && approvals.length > 0) {
        setApproval(approvals[0]);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    }
  };

  const handleApprove = async () => {
    if (!approval) return;
    setLoading(true);
    setError(null);

    try {
      await resolveApproval(approval.id, true);
      onResolve?.();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setLoading(false);
    }
  };

  const handleReject = async () => {
    if (!approval) return;
    setLoading(true);
    setError(null);

    try {
      await resolveApproval(approval.id, false);
      onResolve?.();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setLoading(false);
    }
  };

  if (!approval) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-bg text-accent p-4">
        <div className="w-full max-w-sm text-center">
          <p className="text-muted font-mono">No pending approvals.</p>
        </div>
      </div>
    );
  }

  // Render approval details by kind
  const renderDetails = () => {
    const data = approval.data as any;
    switch (approval.kind) {
      case "connect":
        return (
          <div className="bg-surface rounded-lg p-4 mb-4 border border-border">
            <p className="text-muted text-sm mb-2 font-mono">Request</p>
            <p className="text-accent font-mono">Connect your wallet</p>
          </div>
        );
      case "signMessage":
        return (
          <div className="bg-surface rounded-lg p-4 mb-4 border border-border">
            <p className="text-muted text-sm mb-2 font-mono">Message to Sign</p>
            <p className="text-sm font-mono break-all text-accent">{data?.message || String(data)}</p>
          </div>
        );
      case "signTypedData":
        return (
          <div className="bg-surface rounded-lg p-4 mb-4 border border-border">
            <p className="text-muted text-sm mb-2 font-mono">Typed Data</p>
            <pre className="text-xs font-mono break-all text-accent max-h-32 overflow-y-auto">
              {JSON.stringify(data, null, 2)}
            </pre>
          </div>
        );
      case "sendTransaction":
        return (
          <div className="bg-surface rounded-lg p-4 mb-4 border border-border">
            <p className="text-muted text-sm mb-2 font-mono">Transaction</p>
            <div className="text-xs font-mono text-accent space-y-1">
              <p>To: {data?.to || "?"}</p>
              <p>Value: {data?.value || "0"} wei</p>
              {data?.data && <p>Data: {String(data.data).slice(0, 64)}...</p>}
            </div>
          </div>
        );
      default:
        return (
          <div className="bg-surface rounded-lg p-4 mb-4 border border-border">
            <p className="text-muted text-sm mb-2 font-mono">Details</p>
            <pre className="text-xs font-mono break-all text-accent max-h-32 overflow-y-auto">
              {JSON.stringify(data, null, 2)}
            </pre>
          </div>
        );
    }
  };

  return (
    <div className="min-h-screen bg-bg text-accent p-4">
      <div className="w-full max-w-sm mx-auto">
        <h1 className="text-2xl font-bold mb-4 font-mono">Approval Requested</h1>

        {/* Origin */}
        <div className="mb-4">
          <p className="text-muted text-sm mb-1 font-mono">From Origin</p>
          <p className="text-lg break-all font-mono">{approval.origin}</p>
        </div>

        {/* Request Type */}
        <div className="mb-4">
          <p className="text-muted text-sm mb-1 font-mono">Request Type</p>
          <p className="inline-block bg-surface px-3 py-1 rounded text-sm capitalize font-mono border border-border">
            {approval.kind}
          </p>
        </div>

        {/* Details */}
        {renderDetails()}

        {/* Error Display */}
        {error && <div className="mb-4 p-3 bg-danger text-bg rounded text-sm font-mono">{error}</div>}

        {/* Approve / Reject Buttons */}
        <div className="flex gap-3">
          <button
            onClick={handleApprove}
            disabled={loading}
            className="flex-1 px-4 py-3 bg-accent hover:bg-accent-dim text-bg disabled:bg-border disabled:opacity-50 rounded-lg font-medium transition font-mono"
          >
            {loading ? "..." : "Approve"}
          </button>
          <button
            onClick={handleReject}
            disabled={loading}
            className="flex-1 px-4 py-3 bg-danger hover:bg-warn text-bg disabled:bg-border disabled:opacity-50 rounded-lg font-medium transition font-mono"
          >
            {loading ? "..." : "Reject"}
          </button>
        </div>
      </div>
    </div>
  );
}
