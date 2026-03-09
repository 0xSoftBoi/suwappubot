/**
 * Tests for lib/siriShortcuts.ts — Siri shortcut registry.
 */
import { SHORTCUTS, buildSwapShortcut, donateDefaultShortcuts } from '../../lib/siriShortcuts'

describe('SHORTCUTS', () => {
  it('has pre-defined shortcuts', () => {
    expect(SHORTCUTS.length).toBeGreaterThanOrEqual(5)
  })

  it('all shortcuts have required fields', () => {
    for (const s of SHORTCUTS) {
      expect(s.activityType).toBeTruthy()
      expect(s.title).toBeTruthy()
      expect(s.suggestedPhrase).toBeTruthy()
      expect(s.url).toMatch(/^suwappu:\/\//)
      expect(s.isEligibleForSearch).toBe(true)
      expect(s.isEligibleForPrediction).toBe(true)
    }
  })
})

describe('buildSwapShortcut', () => {
  it('builds a shortcut for a specific token pair', () => {
    const shortcut = buildSwapShortcut('ETH', 'USDC', 'ethereum')

    expect(shortcut.activityType).toBe('xyz.suwappu.app.swap.eth.usdc')
    expect(shortcut.title).toBe('Swap ETH to USDC')
    expect(shortcut.url).toBe('suwappu://swap?from=ETH&to=USDC&chain=ethereum')
  })
})

describe('donateDefaultShortcuts', () => {
  it('runs without error', () => {
    expect(() => donateDefaultShortcuts()).not.toThrow()
  })
})
