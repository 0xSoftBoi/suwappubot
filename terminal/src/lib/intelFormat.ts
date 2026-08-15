// Pure formatting/scaling helpers for the Token Intel panel — kept dependency-
// free and DOM-free so they're cheap to unit test (see intelFormat.test.ts).
import type { IntelFlag } from '../types/api'

/** Truncates a chain address to `front...back`. Returns '--' for empty input. */
export function truncateAddress(address: string | null | undefined, front = 6, back = 4): string {
  if (!address) return '--'
  if (address.length <= front + back + 3) return address
  return `${address.slice(0, front)}...${address.slice(-back)}`
}

/** Formats a percentage (0-100 scale). Null/undefined render as '--'. */
export function formatPct(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '--'
  return `${value.toFixed(decimals)}%`
}

/** Formats a raw token balance with K/M/B/T suffixes. Null renders as '--'. */
export function formatBalance(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '--'
  const abs = Math.abs(value)
  if (abs >= 1_000_000_000_000) return `${(value / 1_000_000_000_000).toFixed(2)}T`
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000) return `${(value / 1_000).toFixed(2)}K`
  return value.toFixed(2)
}

export type FlagSeverity = 'danger' | 'warn' | 'ok'

export interface FlagMeta {
  severity: FlagSeverity
  label: string
  description: string
}

// The five contract flags. Severity drives the TerminalStatusPill tone;
// description is the plain-language hover/tap explanation.
export const FLAG_META: Record<IntelFlag, FlagMeta> = {
  HIGH_TOP10: {
    severity: 'danger',
    label: 'High Top10',
    description: 'The top 10 wallets hold an outsized share of supply — a few holders can move the price.',
  },
  BUNDLED: {
    severity: 'warn',
    label: 'Bundled',
    description: 'Multiple wallets bought in the launch block — likely coordinated, not organic demand.',
  },
  SNIPED: {
    severity: 'warn',
    label: 'Sniped',
    description: 'Bots bought within seconds of launch, ahead of public traders.',
  },
  SERIAL_DEPLOYER: {
    severity: 'danger',
    label: 'Serial Deployer',
    description: "This wallet has deployed many tokens before — check its rug rate before trusting it.",
  },
  CLUSTERED: {
    severity: 'warn',
    label: 'Clustered',
    description: 'Groups of top holders show wallet-linkage patterns consistent with a single controller.',
  },
}

/** Looks up flag metadata, falling back to a neutral 'ok' shape for unknown flags. */
export function flagSeverity(flag: string): FlagSeverity {
  return FLAG_META[flag as IntelFlag]?.severity ?? 'ok'
}

const MIN_RADIUS = 6
const MAX_RADIUS = 48

/**
 * Bubble radius for a holder's `pct` share. Uses sqrt scaling so *area* (not
 * radius) encodes percentage, clamped to a sane min/max so 0.01% holders and
 * 40% whales both stay legible on screen.
 */
export function bubbleRadius(pct: number, min = MIN_RADIUS, max = MAX_RADIUS): number {
  const clampedPct = Math.max(0, Math.min(100, pct || 0))
  const scaled = Math.sqrt(clampedPct / 100) * max
  return Math.max(min, Math.min(max, scaled))
}

// A small deterministic palette — cluster index maps to a fixed hue so the
// same cluster always renders the same color across rerenders/sessions.
const CLUSTER_PALETTE = [
  '#f97066', // red
  '#f79009', // amber
  '#7a5af8', // violet
  '#36bffa', // sky
  '#66c61c', // green
  '#ee46bc', // pink
  '#2e90fa', // blue
  '#fdb022', // gold
]

/** Deterministic color for a cluster index — cycles through a fixed palette. */
export function clusterColor(clusterIndex: number): string {
  if (clusterIndex < 0) return '#8b93a7' // neutral (unclustered)
  return CLUSTER_PALETTE[clusterIndex % CLUSTER_PALETTE.length]
}

/**
 * Rug rate: dead deploys / prior deploys, as a 0-100 percentage.
 * Returns null (not NaN/Infinity) when priorDeploys is null, undefined, or 0.
 */
export function rugRate(deadDeploys: number | null | undefined, priorDeploys: number | null | undefined): number | null {
  if (!priorDeploys || priorDeploys <= 0) return null
  const dead = deadDeploys ?? 0
  return Math.max(0, Math.min(100, (dead / priorDeploys) * 100))
}

/** Deterministic 32-bit hash of a string (djb2 variant) — used to seed layout. */
export function hashString(input: string): number {
  let hash = 5381
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33) ^ input.charCodeAt(i)
  }
  return hash >>> 0
}

/**
 * Deterministic pseudo-random float in [0, 1) seeded by an integer.
 * mulberry32 — small, fast, good-enough distribution for layout jitter that
 * must NOT reshuffle on rerender (only reseed when the address changes).
 */
export function seededRandom(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
