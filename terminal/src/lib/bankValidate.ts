// Linear-time input checks for the bank screens. These replace regular expressions with
// adjacent unbounded quantifiers (e.g. /^\d*\.?\d*$/, /^\S+@\S+\.\S+$/), which static
// analysis flags as polynomial on crafted input.

const isDigit = (c: number) => c >= 48 && c <= 57

/** Digits with at most one dot, e.g. "", "12", "12.", ".5", "12.50". */
export function isDecimalInput(v: string): boolean {
  if (v.length > 60) return false
  let dots = 0
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i)
    if (c === 46) {
      if (++dots > 1) return false
    } else if (!isDigit(c)) {
      return false
    }
  }
  return true
}

/** Shape check only: one "@", something before it, a dot inside the domain, no whitespace. */
export function isEmailLike(v: string): boolean {
  const s = v.trim()
  if (s.length < 5 || s.length > 254) return false
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c === 32 || c === 9 || c === 10 || c === 13) return false
  }
  const at = s.indexOf('@')
  if (at <= 0 || at !== s.lastIndexOf('@')) return false
  const domain = s.slice(at + 1)
  const dot = domain.lastIndexOf('.')
  return dot > 0 && dot < domain.length - 1
}

/** Telegram numeric user id: 1-15 digits, no leading zero. */
export function isTelegramId(v: string): boolean {
  if (v.length < 1 || v.length > 15 || v.charCodeAt(0) === 48) return false
  for (let i = 0; i < v.length; i++) if (!isDigit(v.charCodeAt(i))) return false
  return true
}

/** Telegram username (without "@"): 5-32 chars, starts with a letter, then letters, digits or underscore. Single linear pass. */
export function isTelegramUsername(v: string): boolean {
  if (v.length < 5 || v.length > 32) return false
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i)
    const letter = (c >= 65 && c <= 90) || (c >= 97 && c <= 122)
    if (i === 0 ? !letter : !(letter || c === 95 || isDigit(c))) return false
  }
  return true
}
