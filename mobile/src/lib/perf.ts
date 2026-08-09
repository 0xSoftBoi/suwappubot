/**
 * Lightweight performance instrumentation.
 *
 * The point is not to build an APM — it's to make regressions *visible*. Every
 * network call and every screen mount records a duration, and slow ones warn in
 * dev. Without this, "the app feels slow" is unactionable; with it you get a
 * ranked list of what to fix.
 */
import { InteractionManager } from 'react-native'

const marks = new Map<string, number>()
const samples = new Map<string, number[]>()

/** Wall clock since JS bundle evaluation started. */
export const appStartedAt = Date.now()

export function mark(name: string): void {
  marks.set(name, Date.now())
}

/** Close a mark and record the sample. Returns duration in ms, or -1 if unmarked. */
export function measure(name: string, warnOverMs = 500): number {
  const start = marks.get(name)
  if (start === undefined) return -1
  const duration = Date.now() - start
  marks.delete(name)

  const bucket = samples.get(name) ?? []
  bucket.push(duration)
  // Keep the window bounded — this lives for the whole app session.
  if (bucket.length > 50) bucket.shift()
  samples.set(name, bucket)

  if (__DEV__ && duration > warnOverMs) {
    console.warn(`[perf] ${name} took ${duration}ms (budget ${warnOverMs}ms)`)
  }
  return duration
}

export interface PerfStat {
  name: string
  count: number
  p50: number
  p95: number
  max: number
}

/** Snapshot for a debug screen or for shipping to your telemetry backend. */
export function stats(): PerfStat[] {
  return [...samples.entries()].map(([name, values]) => {
    const sorted = [...values].sort((a, b) => a - b)
    const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0
    return {
      name,
      count: sorted.length,
      p50: at(0.5),
      p95: at(0.95),
      max: sorted[sorted.length - 1] ?? 0,
    }
  })
}

/**
 * Time to interactive: fired once the first batch of interactions/animations
 * after mount has drained. This is the number that actually correlates with
 * "the app opened fast".
 */
export function reportTimeToInteractive(onReport?: (ms: number) => void): void {
  InteractionManager.runAfterInteractions(() => {
    const ttiMs = Date.now() - appStartedAt
    if (__DEV__) console.log(`[perf] time-to-interactive ${ttiMs}ms`)
    onReport?.(ttiMs)
  })
}

/**
 * Defer non-urgent work (analytics flush, prefetch, cache trim) until after the
 * current interaction finishes, so it can't drop frames.
 */
export function afterInteractions(work: () => void): void {
  InteractionManager.runAfterInteractions(work)
}
