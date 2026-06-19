/**
 * plain-language - Translate financial / DeFi jargon into plain language.
 *
 * Accessibility goal: low-literacy, ESL, and non-expert users should be able
 * to understand error and status copy without knowing trading terminology.
 * Each entry pairs a plain-language phrase (shown first) with the precise term
 * (surfaced via an optional inline tooltip / expandable), so power users still
 * get the exact vocabulary.
 *
 * Sources: WCAG 3.1.5 (Reading Level), plain-language guidance.
 */

export interface PlainTerm {
  /** The precise / jargon term as it appears in raw error text. */
  term: string
  /** Plain-language replacement shown to the user first. */
  plain: string
  /** One-line precise definition for the optional tooltip / expandable. */
  definition: string
}

/**
 * Ordered map of jargon → plain language. Order matters: longer / more specific
 * phrases come first so they match before their shorter substrings.
 */
export const PLAIN_TERMS: PlainTerm[] = [
  {
    term: 'price impact',
    plain: 'cost in lost value',
    definition:
      'Price impact: how much your own trade moves the price against you. Bigger trades in small pools lose more value.',
  },
  {
    term: 'slippage',
    plain: 'price moved since your quote',
    definition:
      'Slippage: the gap between the price you were quoted and the price you actually get, because the market moved while the trade was sent.',
  },
  {
    term: 'gas',
    plain: 'network fee',
    definition:
      'Gas: the fee the blockchain network charges to process your transaction. It is paid in the network’s native coin.',
  },
  {
    term: 'liquidity',
    plain: 'available trading funds',
    definition:
      'Liquidity: how much of a token is available to trade. Low liquidity means large trades get worse prices.',
  },
  {
    term: 'route',
    plain: 'trade path',
    definition:
      'Route: the path your swap takes through one or more pools to convert one token into another.',
  },
  {
    term: 'revert',
    plain: 'trade was cancelled by the network',
    definition:
      'Revert: the network rejected the transaction and undid it, usually because a condition (like your price limit) was not met. No funds were moved.',
  },
  {
    term: 'nonce',
    plain: 'transaction order number',
    definition:
      'Nonce: a counter that keeps your transactions in order. A mismatch means an earlier transaction is still pending.',
  },
]

/** Look up a single term (case-insensitive, exact key match). */
export function getPlainTerm(term: string): PlainTerm | undefined {
  const key = term.trim().toLowerCase()
  return PLAIN_TERMS.find((t) => t.term === key)
}

/**
 * Replace any known jargon term inside a string with its plain-language phrase.
 * Returns the rewritten text plus the list of terms that were translated (so a
 * caller can render tooltips / "what does this mean?" expandables for them).
 */
export function toPlainLanguage(text: string): {
  text: string
  terms: PlainTerm[]
} {
  if (!text) return { text, terms: [] }

  let out = text
  const matched: PlainTerm[] = []

  for (const entry of PLAIN_TERMS) {
    // Whole-word, case-insensitive match.
    const re = new RegExp(`\\b${escapeRegExp(entry.term)}\\b`, 'gi')
    if (re.test(out)) {
      out = out.replace(re, entry.plain)
      matched.push(entry)
    }
  }

  return { text: out, terms: matched }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
