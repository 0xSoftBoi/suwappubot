import { randomBytes } from 'node:crypto';
import type { StorageAdapter } from '../types';
import type { PendingOtpState, PendingOtpsStore } from '../types';
import { accent, commandText, muted, outputResult, printCallout } from '../utils/display';

const PENDING_OTPS_KEY = 'pending-otps';

/**
 * Generate a short random ID for pending OTP (e.g. spending_limit when backend has no id).
 */
export function generateOtpId(): string {
  return randomBytes(4).toString('hex');
}

/**
 * Load all pending OTPs from storage.
 */
export async function loadPendingOtps(store: StorageAdapter): Promise<PendingOtpsStore> {
  const data = await store.load<PendingOtpsStore>(PENDING_OTPS_KEY);
  return data ?? {};
}

/**
 * Save a pending OTP state. Merges with existing pendings.
 */
export async function savePendingOtp(
  store: StorageAdapter,
  id: string,
  state: PendingOtpState,
): Promise<void> {
  const all = await loadPendingOtps(store);
  all[id] = state;
  await store.save(PENDING_OTPS_KEY, all);
}

/**
 * Remove a single pending OTP by id.
 */
export async function removePendingOtp(store: StorageAdapter, id: string): Promise<void> {
  const all = await loadPendingOtps(store);
  delete all[id];
  await store.save(PENDING_OTPS_KEY, all);
}

/**
 * Clear pending OTPs. If id provided, only clear that id.
 * If account provided (and no id), clear all pendings for that account.
 * If neither provided, clear all pendings.
 */
export async function clearPendingOtps(
  store: StorageAdapter,
  options?: { account?: string; id?: string },
): Promise<void> {
  const all = await loadPendingOtps(store);
  if (options?.id) {
    delete all[options.id];
  } else if (options?.account) {
    const accountLower = options.account.toLowerCase();
    for (const id of Object.keys(all)) {
      if (all[id].account.toLowerCase() === accountLower) {
        delete all[id];
      }
    }
  } else {
    // Clear all
    for (const id of Object.keys(all)) {
      delete all[id];
    }
  }
  await store.save(PENDING_OTPS_KEY, all);
}

/**
 * Save pending OTP and output the otpPending result for deferred completion.
 * Call this when a command needs to exit and let the user run `otp submit` later.
 */
export async function savePendingOtpAndOutput(
  store: StorageAdapter,
  state: PendingOtpState,
): Promise<void> {
  await savePendingOtp(store, state.id, state);
  const submitCommand = `elytro otp submit ${state.id} <6-digit-code>`;
  outputResult({
    status: 'otp_pending',
    otpPending: {
      id: state.id,
      maskedEmail: state.maskedEmail,
      otpExpiresAt: state.otpExpiresAt,
      submitCommand,
    },
  });
  const lines = [`OTP sent to ${accent(state.maskedEmail ?? 'your email')}.`];
  if (state.otpExpiresAt) {
    lines.push(`${muted('Expires at:')} ${state.otpExpiresAt}`);
  }
  lines.push(`${muted('Run:')} ${commandText(submitCommand)}`);
  printCallout('Action needed', lines, 'warning');
}

/**
 * Get a single pending OTP by id.
 */
export async function getPendingOtp(
  store: StorageAdapter,
  id: string,
): Promise<PendingOtpState | null> {
  const all = await loadPendingOtps(store);
  return all[id] ?? null;
}
