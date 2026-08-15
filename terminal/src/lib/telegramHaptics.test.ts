import { describe, expect, it } from 'bun:test'
import {
  telegramErrorHaptic,
  telegramSelectionHaptic,
  telegramSuccessHaptic,
  telegramTapHaptic,
  type TelegramHapticFeedbackLike,
} from './telegramHaptics'

function feedbackSpy() {
  const events: string[] = []
  const feedback: TelegramHapticFeedbackLike = {
    impactOccurred: (style) => events.push(`impact:${style}`),
    notificationOccurred: (type) => events.push(`notification:${type}`),
    selectionChanged: () => events.push('selection'),
  }
  return { events, feedback }
}

describe('Telegram haptics', () => {
  it('keeps taps and selection changes semantically neutral', () => {
    const { events, feedback } = feedbackSpy()

    expect(telegramTapHaptic(feedback)).toBe(true)
    expect(telegramSelectionHaptic(feedback)).toBe(true)

    expect(events).toEqual(['impact:light', 'selection'])
  })

  it('maps authoritative success and errors to notification haptics', () => {
    const { events, feedback } = feedbackSpy()

    expect(telegramSuccessHaptic(feedback)).toBe(true)
    expect(telegramErrorHaptic(feedback)).toBe(true)

    expect(events).toEqual(['notification:success', 'notification:error'])
  })

  it('never lets an unavailable or throwing Telegram SDK break the trade UI', () => {
    const throwing: TelegramHapticFeedbackLike = {
      impactOccurred: () => { throw new Error('sdk unavailable') },
      notificationOccurred: () => { throw new Error('sdk unavailable') },
      selectionChanged: () => { throw new Error('sdk unavailable') },
    }

    expect(telegramTapHaptic(throwing)).toBe(false)
    expect(telegramSuccessHaptic(throwing)).toBe(false)
  })
})
