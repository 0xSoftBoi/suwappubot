// Minimal typing for the Telegram WebApp SDK loaded via telegram-web-app.js.
// Only the surface the terminal touches is declared.
interface TelegramWebApp {
  initData: string
  ready: () => void
  expand: () => void
}

interface TelegramNamespace {
  WebApp?: TelegramWebApp
}

interface Window {
  Telegram?: TelegramNamespace
}
