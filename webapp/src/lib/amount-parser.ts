export interface ParsedAmount {
  value: string
  isRawUnit: boolean
}

export function parseAmountInput(input: string, _decimals: number): ParsedAmount | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  // If already in wei / smallest unit (integer with no decimal)
  if (/^\d+$/.test(trimmed) && trimmed.length > 10) {
    return { value: trimmed, isRawUnit: true }
  }

  // Normal human-readable amount
  const num = parseFloat(trimmed)
  if (isNaN(num) || num < 0) return null
  return { value: trimmed, isRawUnit: false }
}

export function toSmallestUnit(amount: string, decimals: number): string {
  const parts = amount.split('.')
  const whole = parts[0] || '0'
  let frac = (parts[1] || '').slice(0, decimals).padEnd(decimals, '0')
  const raw = whole + frac
  // Strip leading zeros but keep at least "0"
  return raw.replace(/^0+/, '') || '0'
}
