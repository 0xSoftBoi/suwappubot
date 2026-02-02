/**
 * Parse flexible amount input formats
 * 
 * Supports:
 * - "0.01" - decimal
 * - "1" - whole number
 * - "1,000.50" - with commas
 * - "0.5 ETH" - with token symbol (stripped)
 * - "$50" or "50 USD" - fiat amount (needs price conversion)
 * - "1e18" or "1000000000000000000" - raw wei (detected by size)
 */

export interface ParsedAmount {
  /** Cleaned numeric string (no commas, no symbols) */
  value: string
  /** Original input */
  original: string
  /** Whether this looks like a fiat amount */
  isFiat: boolean
  /** Detected fiat currency if any */
  fiatCurrency?: 'USD' | 'EUR' | 'GBP'
  /** Whether this looks like raw wei/smallest unit */
  isRawUnit: boolean
}

/**
 * Clean and normalize amount input
 */
export function parseAmountInput(input: string, _tokenDecimals = 18): ParsedAmount {
  const original = input.trim()
  
  // Check for fiat indicators
  const fiatMatch = original.match(/^[\$€£]|USD|EUR|GBP$/i)
  const isFiat = !!fiatMatch
  let fiatCurrency: 'USD' | 'EUR' | 'GBP' | undefined
  
  if (fiatMatch) {
    const symbol = fiatMatch[0].toUpperCase()
    if (symbol === '$' || symbol === 'USD') fiatCurrency = 'USD'
    else if (symbol === '€' || symbol === 'EUR') fiatCurrency = 'EUR'
    else if (symbol === '£' || symbol === 'GBP') fiatCurrency = 'GBP'
  }
  
  // Remove currency symbols and token names
  let cleaned = original
    .replace(/[\$€£]/g, '')
    .replace(/\s*(USD|EUR|GBP|ETH|USDC|USDT|BTC|SOL|MATIC|BNB|ARB|OP)\s*/gi, '')
    .trim()
  
  // Remove commas
  cleaned = cleaned.replace(/,/g, '')
  
  // Handle scientific notation
  if (/^\d+e\d+$/i.test(cleaned)) {
    const num = parseFloat(cleaned)
    if (!isNaN(num)) {
      cleaned = num.toLocaleString('fullwide', { useGrouping: false })
    }
  }
  
  // Check if it looks like raw wei (very large number with no decimals)
  const isRawUnit = /^\d{10,}$/.test(cleaned) && !cleaned.includes('.')
  
  // Validate it's a valid number
  if (!/^\d*\.?\d*$/.test(cleaned) || cleaned === '' || cleaned === '.') {
    return {
      value: '',
      original,
      isFiat,
      fiatCurrency,
      isRawUnit: false,
    }
  }
  
  return {
    value: cleaned,
    original,
    isFiat,
    fiatCurrency,
    isRawUnit,
  }
}

/**
 * Convert parsed amount to smallest unit (wei)
 */
export function toSmallestUnit(amount: string, decimals: number): string {
  if (!amount || amount === '0') return '0'
  
  const [intPart, decPart = ''] = amount.split('.')
  const paddedDecimal = decPart.padEnd(decimals, '0').slice(0, decimals)
  const result = intPart + paddedDecimal
  
  // Remove leading zeros but keep at least one digit
  return result.replace(/^0+/, '') || '0'
}

/**
 * Convert from smallest unit to human readable
 */
export function fromSmallestUnit(amount: string, decimals: number): string {
  if (!amount || amount === '0') return '0'
  
  // Pad with leading zeros if needed
  const padded = amount.padStart(decimals + 1, '0')
  const intPart = padded.slice(0, -decimals) || '0'
  const decPart = padded.slice(-decimals)
  
  // Remove trailing zeros from decimal part
  const trimmedDec = decPart.replace(/0+$/, '')
  
  return trimmedDec ? `${intPart}.${trimmedDec}` : intPart
}

/**
 * Format for display with appropriate precision
 */
export function formatDisplayAmount(amount: string, maxDecimals = 6): string {
  const num = parseFloat(amount)
  if (isNaN(num)) return '0'
  
  if (num === 0) return '0'
  if (num < 0.000001) return '<0.000001'
  if (num >= 1000000) return num.toLocaleString('en-US', { maximumFractionDigits: 2 })
  if (num >= 1) return num.toLocaleString('en-US', { maximumFractionDigits: 4 })
  
  return num.toLocaleString('en-US', { maximumFractionDigits: maxDecimals })
}
