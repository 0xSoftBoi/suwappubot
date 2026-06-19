import { describe, it, expect } from 'bun:test'
import { toPlainLanguage, getPlainTerm, PLAIN_TERMS } from './plain-language'
import { SEVERITY_META, type ToastSeverity } from './a11yToast'

describe('toPlainLanguage', () => {
  it('translates a single jargon term', () => {
    expect(toPlainLanguage('slippage exceeded').text).toBe('price moved since your quote exceeded')
  })

  it('reports which terms were translated so callers can render tooltips', () => {
    const { terms } = toPlainLanguage('not enough gas for this swap')
    expect(terms.map((t) => t.term)).toContain('gas')
  })

  it('is case-insensitive and whole-word only', () => {
    // "Gas" matches; a substring like "gasket" must NOT match.
    expect(toPlainLanguage('Gas is high').text).toBe('network fee is high')
    expect(toPlainLanguage('gasket failure').text).toBe('gasket failure')
  })

  it('matches longer phrases before their shorter substrings', () => {
    // "price impact" must win over a bare "price" style match.
    const { text } = toPlainLanguage('high price impact warning')
    expect(text).toContain('cost in lost value')
  })

  it('leaves plain copy untouched and handles empty input', () => {
    expect(toPlainLanguage('Failed to load alerts').text).toBe('Failed to load alerts')
    expect(toPlainLanguage('').text).toBe('')
  })
})

describe('getPlainTerm', () => {
  it('returns the precise definition for tooltips', () => {
    const term = getPlainTerm('Slippage')
    expect(term?.plain).toBe('price moved since your quote')
    expect(term?.definition).toContain('quoted')
  })

  it('returns undefined for unknown terms', () => {
    expect(getPlainTerm('nonsense')).toBeUndefined()
  })
})

describe('a11yToast SEVERITY_META — never color alone (WCAG 1.4.1)', () => {
  const severities: ToastSeverity[] = ['success', 'error', 'info', 'warning']

  it('pairs every severity with a visible word and an icon, not just color', () => {
    for (const s of severities) {
      const meta = SEVERITY_META[s]
      expect(meta.word.length).toBeGreaterThan(0)
      expect(meta.icon.length).toBeGreaterThan(0)
    }
  })

  it('uses distinct human-readable words per severity', () => {
    const words = severities.map((s) => SEVERITY_META[s].word)
    expect(new Set(words).size).toBe(words.length)
  })
})

describe('PLAIN_TERMS table integrity', () => {
  it('stores every term lowercased so case-insensitive lookup is reliable', () => {
    for (const entry of PLAIN_TERMS) {
      expect(entry.term).toBe(entry.term.toLowerCase())
      expect(entry.plain.length).toBeGreaterThan(0)
      expect(entry.definition.length).toBeGreaterThan(0)
    }
  })
})
