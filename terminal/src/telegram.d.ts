// Minimal typing for the Telegram WebApp SDK loaded via telegram-web-app.js.
// Only the surface the terminal touches is declared.
type TelegramHapticImpactStyle = 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'
type TelegramHapticNotificationType = 'error' | 'success' | 'warning'

interface TelegramHapticFeedback {
  impactOccurred: (style: TelegramHapticImpactStyle) => void
  notificationOccurred: (type: TelegramHapticNotificationType) => void
  selectionChanged: () => void
}

interface TelegramWebApp {
  initData: string
  ready: () => void
  expand: () => void
  HapticFeedback?: TelegramHapticFeedback
}

interface TelegramNamespace {
  WebApp?: TelegramWebApp
}

interface Window {
  Telegram?: TelegramNamespace
}
