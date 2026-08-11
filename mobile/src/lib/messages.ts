/**
 * Plain-language translations for errors and limits shown in the UI.
 *
 * The backend `detail` strings (api/routes/mobile.py) are being rewritten
 * separately and in parallel with this file, so this mapper matches on
 * keywords and HTTP status rather than exact string equality — it keeps
 * working through that transition instead of breaking the moment a detail
 * string's wording changes. Every branch says what happened AND what to do,
 * per the "mom test" rule: no bare status sentences.
 */
import { ApiError } from './api'
import { formatUsd } from './format'

const GENERIC_FALLBACK = "That didn't go through. Please try again."

function includesAny(haystack: string, needles: string[]): boolean {
  return needles.some((n) => haystack.includes(n))
}

/** Maps any thrown value (ApiError, network Error, or unknown) to copy that
 * says what happened and what to do next. Use this everywhere a raw
 * `err.message` or `ApiError.detail` was shown directly before. */
export function friendlyMessage(err: unknown): string {
  if (err instanceof ApiError) return friendlyForStatus(err.status, err.detail)
  if (err instanceof Error && err.name === 'AbortError') {
    return 'That took too long. Check your connection and try again.'
  }
  if (err instanceof TypeError) {
    // fetch() throws a bare TypeError when there's no connectivity/DNS.
    return "Can't reach Suwappu right now. Check your connection and try again."
  }
  return GENERIC_FALLBACK
}

export function friendlyForStatus(status: number, detail?: string | null): string {
  const raw = (detail ?? '').toLowerCase()

  if (status === 429) return "You're going a bit fast. Try again in a minute."

  if (status === 503 || includesAny(raw, ['in progress', 'wallet busy', 'try again shortly'])) {
    return 'Another transfer is still finishing. Give it a moment, then try again.'
  }

  if (includesAny(raw, ['eth for gas', ' gas', 'gas.', 'network fee'])) {
    return "We couldn't cover the network fee for this transfer. Try a smaller amount or try again shortly — a permanent fix is coming."
  }

  if (includesAny(raw, ['insufficient balance', 'insufficient funds', 'not enough'])) {
    return "You don't have enough to send that amount. Try a smaller amount."
  }

  if (includesAny(raw, ['minimum amount', 'invalid amount', 'positive number', 'must be between', 'amount is required'])) {
    return amountBoundsMessage(0.01, 1_000_000)
  }

  if (includesAny(raw, ['own wallet', 'own address'])) {
    return "That's one of your own wallets — pick a different address to send to."
  }

  if (includesAny(raw, ['burn address', 'token contract'])) {
    return "That address can't receive dollars — it isn't a real recipient. Double-check who you're sending to."
  }

  if (includesAny(raw, ['invalid recipient', 'invalid address', 'invalid ens', 'name not found', 'ens resolution unavailable'])) {
    return "That doesn't look like a valid recipient. Use a wallet address starting with 0x (like 0xAbC1…6789) or a name ending in .eth."
  }

  if (includesAny(raw, ['no evm wallet', 'add one first', 'unknown wallet'])) {
    return 'You need a wallet set up first. Add one, then try again.'
  }

  if (status === 401) return 'Your session timed out. Please sign in again.'
  if (status === 404) return "We couldn't find that."
  if (status === 413) return "That's too much at once. Try sending less."
  if (status >= 500) return 'Something went wrong on our end. Please try again in a moment.'

  return detail && detail.trim().length > 0 ? detail : GENERIC_FALLBACK
}

/** Shared amount-bounds copy for Send and Earn (add money / move money out).
 * Mirrors _parse_earn_amount / the send amount validator in
 * api/routes/mobile.py — kept in plain words, not raw token units. */
export function amountBoundsMessage(min: number, max: number): string {
  return `Enter an amount between ${formatUsd(min)} and ${formatUsd(max)}.`
}

/** Insufficient-balance copy that shows real numbers instead of a bare
 * rejection, once the screen already knows what the person has vs. tried
 * to send (client-known context, not parsed out of the error string). */
export function insufficientBalanceMessage(availableUsd: number, triedUsd: number): string {
  return `You have ${formatUsd(availableUsd)} available, but tried to send ${formatUsd(triedUsd)}. Try a smaller amount.`
}

/** Copy for a 202 broadcast-but-unconfirmed response — not an error. */
export const PENDING_MESSAGE = "Sent — we're confirming it now. This usually takes a few seconds."

/** Hard-honesty disclosures. Balances are shown as "$" for readability, but
 * this app is not a bank and carries no deposit protection — never claim
 * otherwise. Keep these two constants in sync with that rule if edited. */
export const DOLLAR_DISCLOSURE =
  "Your balance is shown in dollars, but it's actually held as USDC — a digital token designed to track the value of $1. Suwappu holds it in a crypto wallet, not a traditional financial account, and its value can move slightly instead of staying locked to exactly $1."

export const SAVINGS_DISCLOSURE =
  "Savings automatically puts dollars that would otherwise sit still to work so they can earn something. The rate moves with market conditions and isn't fixed, and the amount you get back can go up or down. This works differently from a regular savings product, and there's no third party promising to make you whole if something goes wrong."
