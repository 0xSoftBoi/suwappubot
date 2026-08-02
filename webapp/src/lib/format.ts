/**
 * Locale-aware money formatting helpers built on Intl.NumberFormat.
 *
 * PARTIAL ROLLOUT NOTE: this is only applied to the highest-value money-facing
 * displays (total balance in Wallet/Portfolio, swap confirmation amount/fee
 * summary). Roughly ~30 other files under webapp/src still use raw
 * `toFixed`/`toLocaleString('en-US', ...)` for numeric/money display and have
 * NOT been migrated yet — that is a follow-up pass, not done here.
 */
import i18n from './i18n'

const INTL_LOCALE_MAP: Record<string, string> = {
  en: 'en-US',
  es: 'es-ES',
  fr: 'fr-FR',
  zh: 'zh-CN',
}

const DEFAULT_LOCALE = 'en-US'

/**
 * Map the app's bare i18next language code (en/es/fr/zh) to a BCP-47 tag
 * that Intl APIs expect, defaulting to the current i18next language.
 * Normalizes regioned/scripted tags (e.g. 'zh-Hans', 'en-GB') to their base
 * subtag before lookup so they still resolve instead of silently falling
 * through to the default locale.
 */
export function getIntlLocale(locale?: string): string {
  const lang = (locale || i18n.language || 'en').toLowerCase().split('-')[0]
  return INTL_LOCALE_MAP[lang] || DEFAULT_LOCALE
}

/**
 * Format a fiat currency amount (e.g. USD balances/fees) using the current
 * (or given) i18n locale. Returns '—' for non-finite input (null/undefined/
 * NaN/Infinity) instead of silently rendering a misleading "$0.00" or
 * "$NaN" — callers on money-facing screens must not present those as real
 * amounts.
 */
export function formatCurrency(amount: number, currency = 'USD', locale?: string): string {
  if (!Number.isFinite(amount)) return '—'
  try {
    return new Intl.NumberFormat(getIntlLocale(locale), {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount)
  } catch {
    // Fall back to a plain, locale-agnostic rendering rather than throwing
    return `$${amount.toFixed(2)}`
  }
}

/**
 * Format a raw token amount (not a fiat currency) using the current (or
 * given) i18n locale. `decimals` is the token's on-chain decimals; it's
 * capped at 6 fraction digits so very-high-decimal tokens (e.g. 18 for ETH)
 * don't render an unreadable number of digits.
 *
 * Display-only: the output may include locale-specific group separators
 * (e.g. "1.234,56" in es-ES) and is truncated to 6 fraction digits, so it
 * must never be parsed back into a number. Currently unreferenced — kept
 * for future money-facing token amount displays.
 */
export function formatTokenAmount(amount: number, decimals: number, locale?: string): string {
  if (!Number.isFinite(amount)) return '—'
  const maxFractionDigits = Math.min(Math.max(decimals, 0), 6)
  try {
    return new Intl.NumberFormat(getIntlLocale(locale), {
      minimumFractionDigits: 0,
      maximumFractionDigits: maxFractionDigits,
    }).format(amount)
  } catch {
    return amount.toFixed(maxFractionDigits)
  }
}
