export type TelegramHapticFeedbackLike = {
  impactOccurred: (style: TelegramHapticImpactStyle) => void
  notificationOccurred: (type: TelegramHapticNotificationType) => void
  selectionChanged: () => void
}

function currentFeedback(): TelegramHapticFeedbackLike | undefined {
  if (typeof window === 'undefined') return undefined
  return window.Telegram?.WebApp?.HapticFeedback
}

function safelyHaptic(
  effect: (feedback: TelegramHapticFeedbackLike) => void,
  feedback: TelegramHapticFeedbackLike | undefined,
): boolean {
  if (!feedback) return false
  try {
    effect(feedback)
    return true
  } catch {
    // Telegram can expose a partial/older WebApp bridge. Haptics are polish,
    // never a reason for a trade control to stop working.
    return false
  }
}

/** Neutral acknowledgement of a deliberate action; never means execution succeeded. */
export function telegramTapHaptic(feedback = currentFeedback()): boolean {
  return safelyHaptic((target) => target.impactOccurred('light'), feedback)
}

/** Telegram explicitly reserves selectionChanged for a selection actually changing. */
export function telegramSelectionHaptic(feedback = currentFeedback()): boolean {
  return safelyHaptic((target) => target.selectionChanged(), feedback)
}

/** Only call after an authoritative operation reports completed successfully. */
export function telegramSuccessHaptic(feedback = currentFeedback()): boolean {
  return safelyHaptic((target) => target.notificationOccurred('success'), feedback)
}

/** Failure feedback for an authoritative rejected/failed operation. */
export function telegramErrorHaptic(feedback = currentFeedback()): boolean {
  return safelyHaptic((target) => target.notificationOccurred('error'), feedback)
}
