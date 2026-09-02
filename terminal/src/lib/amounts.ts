/**
 * Amount + timestamp hygiene for values that arrive from the API as strings.
 *
 * The quote path is served by the Python API, whose serializer historically
 * emitted `str(float)` ("4.2048360001236e-05"), raw base units for the minimum
 * output ("41838118201229"), and naive ISO timestamps with no timezone. The
 * server now formats these properly, but the terminal must never render a
 * scientific-notation amount or mis-parse a naive timestamp again, so both
 * ends are defensive.
 */

const MAX_DISPLAY_DECIMALS = 8
const MAX_SIGNIFICANT_FOR_TINY = 6

/** Render a numeric string / number as a plain decimal — never `1e-7`. */
export function formatTokenAmount(
  value: string | number | null | undefined,
  opts: { maxDecimals?: number } = {},
): string {
  if (value === null || value === undefined) return ''
  const raw = typeof value === 'number' ? String(value) : value.trim()
  if (raw === '') return ''
  const num = Number(raw)
  if (!Number.isFinite(num)) return raw
  if (num === 0) return '0'

  const maxDecimals = opts.maxDecimals ?? MAX_DISPLAY_DECIMALS
  const abs = Math.abs(num)
  let text: string
  if (abs >= 1e15) {
    // toFixed switches to exponent form at 1e21; format without grouping instead.
    text = BigInt(Math.trunc(num)).toString()
  } else if (abs >= 1) {
    text = num.toFixed(Math.min(maxDecimals, 6))
  } else if (abs >= 10 ** -maxDecimals) {
    text = num.toFixed(maxDecimals)
  } else {
    // Sub-display-precision amounts (0.00000004 ETH): keep the leading
    // significant digits instead of collapsing to "0".
    text = num.toFixed(Math.min(20, -Math.floor(Math.log10(abs)) + MAX_SIGNIFICANT_FOR_TINY - 1))
  }
  if (text.includes('.')) text = text.replace(/\.?0+$/, '')
  return text === '' || text === '-' ? '0' : text
}

/**
 * Format a token amount that may be in base units (integer wei/lamports).
 * If `value` is an integer string and `decimals` is known, scale it down;
 * values that already carry a decimal point are treated as human amounts.
 */
export function formatBaseUnitsOrHuman(
  value: string | number | null | undefined,
  decimals: number | undefined,
  humanReference?: string | number | null,
): string {
  if (value === null || value === undefined) return ''
  const raw = typeof value === 'number' ? String(value) : value.trim()
  if (!/^\d+$/.test(raw) || decimals === undefined || decimals === null) {
    return formatTokenAmount(raw)
  }
  const scaled = scaleDown(raw, decimals)
  const ref = humanReference === null || humanReference === undefined ? NaN : Number(humanReference)
  // A whole-number human amount ("5") would also match /^\d+$/. When we know
  // the quoted output, prefer whichever interpretation is plausible against it.
  if (Number.isFinite(ref) && ref > 0) {
    const asHuman = Number(raw)
    const asScaled = Number(scaled)
    if (asScaled <= ref && asScaled >= ref * 0.5) return formatTokenAmount(scaled)
    if (asHuman <= ref && asHuman >= ref * 0.5) return formatTokenAmount(raw)
  }
  return formatTokenAmount(scaled)
}

function scaleDown(integer: string, decimals: number): string {
  const digits = integer.replace(/^0+(?=\d)/, '')
  if (decimals <= 0) return digits
  const padded = digits.padStart(decimals + 1, '0')
  const whole = padded.slice(0, padded.length - decimals)
  const frac = padded.slice(padded.length - decimals).replace(/0+$/, '')
  return frac ? `${whole}.${frac}` : whole
}

const NAIVE_ISO = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/

/**
 * Parse a server timestamp to epoch ms. Naive ISO strings (no `Z` / offset)
 * are treated as UTC — `new Date()` would treat them as local time, which
 * made every quote look expired for users east of UTC.
 */
export function parseServerTimestamp(iso: string | null | undefined): number {
  if (!iso) return NaN
  const trimmed = iso.trim()
  if (NAIVE_ISO.test(trimmed)) {
    return Date.parse(trimmed.replace(' ', 'T') + 'Z')
  }
  return Date.parse(trimmed)
}
