/**
 * Client for the waitlist + referral leaderboard API.
 * Field names and shapes match scratchpad/CONTRACT.md exactly — do not
 * rename anything here without updating the backend in lockstep.
 */
import { API_BASE_URL } from '@/lib/links';
import type { Attribution } from '@/lib/attribution';

export const HANDLE_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?$/;
export const RESERVED_HANDLES = new Set([
  'admin', 'root', 'support', 'suwappu', 'help', 'api', 'www', 'mod',
  'moderator', 'team', 'official', 'staff', 'security', 'billing', 'system',
  'null', 'undefined',
]);

/** Client-side pre-check only — the server is the source of truth. */
export function isPlausibleHandle(raw: string): boolean {
  const h = raw.trim().toLowerCase();
  if (h.length < 3 || h.length > 32) return false;
  if (h.includes('--')) return false;
  if (RESERVED_HANDLES.has(h)) return false;
  return HANDLE_PATTERN.test(h);
}

export type AvailabilityReason = 'taken' | 'invalid' | 'reserved' | null;

export interface AvailabilityResponse {
  ok: true;
  handle: string;
  available: boolean;
  reason: AvailabilityReason;
}

export interface ReserveSuccess {
  ok: true;
  handle: string;
  position: number;
  referral_code: string;
  referral_url: string;
  referral_count: number;
  total_signups: number;
  seed: number;
  already: boolean;
}

export type ReserveErrorCode = 'handle_taken' | 'invalid_handle' | 'invalid_email';
export interface ReserveError {
  ok: false;
  error: ReserveErrorCode | string;
}

export interface StatusSuccess {
  ok: true;
  handle: string;
  position: number;
  referral_count: number;
  total_signups: number;
  referrals_to_next_rank: number;
  seed: number;
}
export interface StatusError {
  ok: false;
  error: 'not_found' | string;
}

export interface LeaderboardEntry {
  rank: number;
  handle: string;
  referral_count: number;
}
export interface LeaderboardResponse {
  ok: true;
  total_signups: number;
  entries: LeaderboardEntry[];
}

export async function checkAvailability(
  handle: string,
  signal?: AbortSignal,
): Promise<AvailabilityResponse | null> {
  const res = await fetch(
    `${API_BASE_URL}/webapp/waitlist/availability?handle=${encodeURIComponent(handle)}`,
    { signal },
  );
  if (!res.ok) return null;
  return res.json();
}

export interface ReservePayload {
  handle: string;
  email: string;
  telegram?: string;
  ref?: string;
  website: string;
  attribution?: Attribution;
}

export async function reserveHandle(
  payload: ReservePayload,
): Promise<{ status: number; body: ReserveSuccess | ReserveError }> {
  const res = await fetch(`${API_BASE_URL}/webapp/waitlist/reserve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  return { status: res.status, body };
}

export async function fetchStatus(
  code: string,
  signal?: AbortSignal,
): Promise<StatusSuccess | StatusError> {
  const res = await fetch(
    `${API_BASE_URL}/webapp/waitlist/status?code=${encodeURIComponent(code)}`,
    { signal },
  );
  return res.json();
}

export async function fetchLeaderboard(
  limit = 10,
  signal?: AbortSignal,
): Promise<LeaderboardResponse> {
  const res = await fetch(`${API_BASE_URL}/webapp/waitlist/leaderboard?limit=${limit}`, { signal });
  return res.json();
}
