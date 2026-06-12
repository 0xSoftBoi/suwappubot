const tg = (window as any).Telegram?.WebApp?.HapticFeedback

export function useHaptic() {
  return {
    selection: () => tg?.selectionChanged?.(),
    impact: (style: 'light' | 'medium' | 'heavy' = 'medium') => tg?.impactOccurred?.(style),
    notification: (type: 'success' | 'warning' | 'error') => tg?.notificationOccurred?.(type),
  }
}
