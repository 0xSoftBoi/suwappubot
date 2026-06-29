// Approval queue: survives SW restarts by persisting to chrome.storage.session.
// Each approval request is enqueued and the user is prompted via the popup.
// The originating RPC handler registers a one-shot listener via waitFor(id).
//
// LIFETIME CAVEAT: When the SW restarts, any promises registered via waitFor()
// are lost. A resumed request must be re-requested from the dApp. For this reason,
// waitFor() is only guaranteed to resolve if the user responds within a single
// SW lifetime (~30s idle). If the popup is closed and the SW dies, the waiting
// promise rejects and the dApp must retry.

import type { ApprovalRequest } from "@/shared/protocol";
import { getSession, setSession } from "@/background/storage/session";

// Session storage key for pending approvals (persisted array).
const PENDING_APPROVALS_KEY = "pending_approvals";

// In-memory map: approvalId -> { resolve, reject } for waitFor() promise callbacks.
// LOST on SW restart (expected — caller will re-request from dApp).
const waitForResolvers: Map<string, {
  resolve: (value: { approved: boolean; result?: unknown }) => void;
  reject: (err: Error) => void;
}> = new Map();

/**
 * Enqueue an approval request. Persists to session storage, updates badge count,
 * and opens the popup. Returns the generated approval ID immediately.
 *
 * IMPORTANT: The returned promise from waitFor(id) will only resolve if the user
 * responds within the current SW lifetime. If the SW restarts before response,
 * the waiting promise is lost and the dApp must re-request.
 */
export async function enqueue(
  req: Omit<ApprovalRequest, "id" | "createdAt">
): Promise<{ id: string }> {
  const id = crypto.randomUUID();
  const createdAt = Date.now();

  const approval: ApprovalRequest = {
    ...req,
    id,
    createdAt,
  };

  // Get current queue from session storage.
  const current = (await getSession<ApprovalRequest[]>(PENDING_APPROVALS_KEY)) ?? [];

  // Append and persist.
  const updated = [...current, approval];
  await setSession(PENDING_APPROVALS_KEY, updated);

  // Update badge to show count.
  await updateBadge();

  // Open popup (with fallback to chrome.windows.create if openPopup not available).
  try {
    await chrome.action.openPopup();
  } catch (_e) {
    // Fallback: open as a small window.
    try {
      await chrome.windows.create({
        url: chrome.runtime.getURL("index.html"),
        type: "popup",
        width: 400,
        height: 600,
      });
    } catch (fallbackErr) {
      console.error("Failed to open popup (both methods):", fallbackErr);
      // Continue anyway; the user can still access the extension via the toolbar.
    }
  }

  return { id };
}

/**
 * List all pending approval requests from session storage.
 */
export async function list(): Promise<ApprovalRequest[]> {
  const result = await getSession<ApprovalRequest[]>(PENDING_APPROVALS_KEY);
  return result ?? [];
}

/**
 * Resolve an approval by ID. Removes from storage, updates badge, fires the waitFor resolver.
 *
 * If `approved` is true and `result` is provided, the result is passed to waitFor().
 * If `approved` is false, the waiting promise resolves with `{ approved: false }`.
 * If the approval was already resolved (ID not found), reject the internal resolver.
 */
export async function resolve(
  id: string,
  approved: boolean,
  result?: unknown
): Promise<void> {
  // Get current queue from session storage.
  const current = (await getSession<ApprovalRequest[]>(PENDING_APPROVALS_KEY)) ?? [];

  // Find and remove by ID.
  const index = current.findIndex((r) => r.id === id);
  if (index < 0) {
    // Already resolved or never existed. Reject any waiting promise.
    const resolver = waitForResolvers.get(id);
    if (resolver) {
      resolver.reject(new Error(`Approval ${id} was already resolved or does not exist`));
      waitForResolvers.delete(id);
    }
    return;
  }

  // Remove from queue and persist.
  const updated = current.filter((r) => r.id !== id);
  await setSession(PENDING_APPROVALS_KEY, updated);

  // Update badge to show new count.
  await updateBadge();

  // Fire the waitFor resolver if registered.
  const resolver = waitForResolvers.get(id);
  if (resolver) {
    resolver.resolve({ approved, result });
    waitForResolvers.delete(id);
  }
}

/**
 * Remove an approval by ID without resolving (e.g., if the popup closes).
 * Cleans up the waitFor resolver if registered.
 */
export async function remove(id: string): Promise<void> {
  // Get current queue from session storage.
  const current = (await getSession<ApprovalRequest[]>(PENDING_APPROVALS_KEY)) ?? [];

  // Remove by ID.
  const updated = current.filter((r) => r.id !== id);
  await setSession(PENDING_APPROVALS_KEY, updated);

  // Update badge to show new count.
  await updateBadge();

  // Clean up waitFor resolver if registered.
  const resolver = waitForResolvers.get(id);
  if (resolver) {
    resolver.reject(new Error(`Approval ${id} was cancelled`));
    waitForResolvers.delete(id);
  }
}

/**
 * Wait for an approval to be resolved. Returns a promise that resolves when
 * resolve() is called with this ID, or rejects if the approval is removed
 * or the SW restarts.
 *
 * LIFETIME CAVEAT: If the SW dies before the user responds, this promise is lost.
 * The originating RPC handler should use a reasonable timeout and fall back to
 * rejecting the dApp request if waitFor() does not resolve in time.
 */
export async function waitFor(id: string): Promise<{ approved: boolean; result?: unknown }> {
  return new Promise((resolve, reject) => {
    waitForResolvers.set(id, { resolve, reject });
  });
}

/**
 * Update the extension action badge to show the count of pending approvals.
 * If the count is 0, the badge is cleared.
 */
async function updateBadge(): Promise<void> {
  const approvals = await list();
  if (approvals.length === 0) {
    await chrome.action.setBadgeText({ text: "" });
  } else {
    await chrome.action.setBadgeText({ text: String(approvals.length) });
  }
}
