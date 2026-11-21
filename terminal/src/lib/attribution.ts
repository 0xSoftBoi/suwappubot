// Launch attribution. A landing URL can carry ?ref=<source> (sign_url sets
// ref=mcp, launches use ref=producthunt, swap links use ref=<product>). We keep
// the first ref seen in this tab and send it with the swap record, so every
// micro product and launch can be measured by the swaps it actually drove.
//
// Privacy: the value is a short campaign label, never a user identifier.
// Storage can throw (private mode, blocked site data), so every access is
// guarded and attribution silently degrades to "none".

const KEY = 'suwappu_ref'
const VALID = /^[a-z0-9_-]{1,32}$/

export function normalizeRef(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined
  const ref = raw.trim().toLowerCase()
  return VALID.test(ref) ? ref : undefined
}

/** Remember the ref from a query string. First touch wins within a tab session. */
export function captureRef(search: string): void {
  const ref = normalizeRef(new URLSearchParams(search).get('ref'))
  if (!ref) return
  try {
    if (!window.sessionStorage.getItem(KEY)) window.sessionStorage.setItem(KEY, ref)
  } catch {
    // storage unavailable: attribution is best-effort
  }
}

export function getRef(): string | undefined {
  try {
    return normalizeRef(window.sessionStorage.getItem(KEY))
  } catch {
    return undefined
  }
}
