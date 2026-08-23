export const DEFAULT_MAX_LEVERAGE = 20

export function normalizeMaxLeverage(maxLeverage: number | null | undefined): number {
  if (!Number.isFinite(maxLeverage) || (maxLeverage as number) < 1) return DEFAULT_MAX_LEVERAGE
  return Math.max(1, Math.trunc(maxLeverage as number))
}

export function clampLeverage(value: number, maxLeverage: number | null | undefined): number {
  const max = normalizeMaxLeverage(maxLeverage)
  const finite = Number.isFinite(value) ? Math.trunc(value) : 1
  return Math.min(Math.max(finite, 1), max)
}

export function isLeverageValid(value: number, maxLeverage: number | null | undefined): boolean {
  const max = normalizeMaxLeverage(maxLeverage)
  return Number.isInteger(value) && value >= 1 && value <= max
}
