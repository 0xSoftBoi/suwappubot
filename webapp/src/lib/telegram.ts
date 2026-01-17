/**
 * Telegram WebApp SDK utilities
 */

// Re-export WebApp from the global scope (loaded via script tag)
declare global {
  interface Window {
    Telegram?: {
      WebApp: TelegramWebApp
    }
  }
}

export interface TelegramUser {
  id: number
  first_name: string
  last_name?: string
  username?: string
  language_code?: string
  photo_url?: string
  is_premium?: boolean
}

export interface TelegramWebApp {
  initData: string
  initDataUnsafe: {
    query_id?: string
    user?: TelegramUser
    auth_date?: number
    hash?: string
  }
  version: string
  platform: string
  colorScheme: 'light' | 'dark'
  themeParams: {
    bg_color?: string
    text_color?: string
    hint_color?: string
    link_color?: string
    button_color?: string
    button_text_color?: string
    secondary_bg_color?: string
  }
  isExpanded: boolean
  viewportHeight: number
  viewportStableHeight: number
  headerColor: string
  backgroundColor: string

  // Methods
  ready: () => void
  expand: () => void
  close: () => void

  // Main Button
  MainButton: {
    text: string
    color: string
    textColor: string
    isVisible: boolean
    isActive: boolean
    isProgressVisible: boolean
    setText: (text: string) => void
    onClick: (callback: () => void) => void
    offClick: (callback: () => void) => void
    show: () => void
    hide: () => void
    enable: () => void
    disable: () => void
    showProgress: (leaveActive?: boolean) => void
    hideProgress: () => void
  }

  // Back Button
  BackButton: {
    isVisible: boolean
    onClick: (callback: () => void) => void
    offClick: (callback: () => void) => void
    show: () => void
    hide: () => void
  }

  // Haptic Feedback
  HapticFeedback: {
    impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void
    notificationOccurred: (type: 'error' | 'success' | 'warning') => void
    selectionChanged: () => void
  }

  // Events
  onEvent: (eventType: string, callback: () => void) => void
  offEvent: (eventType: string, callback: () => void) => void

  // Popup
  showPopup: (params: {
    title?: string
    message: string
    buttons?: Array<{
      id?: string
      type?: 'default' | 'ok' | 'close' | 'cancel' | 'destructive'
      text?: string
    }>
  }, callback?: (buttonId: string) => void) => void

  showAlert: (message: string, callback?: () => void) => void
  showConfirm: (message: string, callback?: (confirmed: boolean) => void) => void
}

/**
 * Get the Telegram WebApp instance
 */
export function getWebApp(): TelegramWebApp | null {
  if (typeof window !== 'undefined' && window.Telegram?.WebApp) {
    return window.Telegram.WebApp
  }
  return null
}

/**
 * Check if running inside Telegram
 */
export function isTelegramWebApp(): boolean {
  const webApp = getWebApp()
  return webApp !== null && webApp.initData !== ''
}

/**
 * Get the current user from Telegram
 */
export function getTelegramUser(): TelegramUser | null {
  const webApp = getWebApp()
  return webApp?.initDataUnsafe?.user || null
}

/**
 * Get the init data for backend validation
 */
export function getInitData(): string {
  const webApp = getWebApp()
  return webApp?.initData || ''
}
