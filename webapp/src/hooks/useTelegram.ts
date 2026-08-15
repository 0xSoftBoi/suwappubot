import { useState, useEffect, useCallback } from 'react'
import {
  getWebApp,
  getTelegramUser,
  getInitData,
  type TelegramWebApp,
  type TelegramUser
} from '../lib/telegram'
import a11yToast from '../lib/a11yToast'

interface UseTelegramReturn {
  webApp: TelegramWebApp | null
  user: TelegramUser | null
  initData: string
  isReady: boolean
  colorScheme: 'light' | 'dark'

  // Actions
  hapticFeedback: (type: 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error') => void
  showMainButton: (text: string, onClick: () => void) => void
  hideMainButton: () => void
  showBackButton: (onClick: () => void) => void
  hideBackButton: () => void
  showAlert: (message: string) => Promise<void>
  showConfirm: (message: string) => Promise<boolean>
  close: () => void
  requestFullscreen: () => void
  exitFullscreen: () => void
  addToHomeScreen: () => void
}

export function useTelegram(): UseTelegramReturn {
  const [webApp, setWebApp] = useState<TelegramWebApp | null>(null)
  const [user, setUser] = useState<TelegramUser | null>(null)
  const [isReady, setIsReady] = useState(false)
  const [colorScheme, setColorScheme] = useState<'light' | 'dark'>('light')

  useEffect(() => {
    const app = getWebApp()
    if (app) {
      setWebApp(app)
      setUser(getTelegramUser())
      setColorScheme(app.colorScheme)
      setIsReady(true)

      // Listen for theme changes
      const handleThemeChange = () => {
        setColorScheme(app.colorScheme)
      }
      app.onEvent('themeChanged', handleThemeChange)

      return () => {
        app.offEvent('themeChanged', handleThemeChange)
      }
    } else {
      // Not in Telegram, but still mark as ready for development
      setIsReady(true)
    }
  }, [])

  const hapticFeedback = useCallback((type: 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error') => {
    if (!webApp?.HapticFeedback) return

    if (type === 'success' || type === 'warning' || type === 'error') {
      webApp.HapticFeedback.notificationOccurred(type)
    } else {
      webApp.HapticFeedback.impactOccurred(type)
    }
  }, [webApp])

  const showMainButton = useCallback((text: string, onClick: () => void) => {
    if (!webApp?.MainButton) return

    webApp.MainButton.setText(text)
    webApp.MainButton.onClick(onClick)
    webApp.MainButton.show()
  }, [webApp])

  const hideMainButton = useCallback(() => {
    if (!webApp?.MainButton) return
    webApp.MainButton.hide()
  }, [webApp])

  const showBackButton = useCallback((onClick: () => void) => {
    if (!webApp?.BackButton) return

    webApp.BackButton.onClick(onClick)
    webApp.BackButton.show()
  }, [webApp])

  const hideBackButton = useCallback(() => {
    if (!webApp?.BackButton) return
    webApp.BackButton.hide()
  }, [webApp])

  const showAlert = useCallback((message: string): Promise<void> => {
    return new Promise((resolve) => {
      if (webApp?.showAlert) {
        webApp.showAlert(message, resolve)
      } else {
        a11yToast.info(message)
        resolve()
      }
    })
  }, [webApp])

  const showConfirm = useCallback((message: string): Promise<boolean> => {
    return new Promise((resolve) => {
      if (webApp?.showConfirm) {
        webApp.showConfirm(message, resolve)
      } else {
        resolve(confirm(message))
      }
    })
  }, [webApp])

  const close = useCallback(() => {
    webApp?.close()
  }, [webApp])

  const requestFullscreen = useCallback(() => {
    if ((webApp as unknown as Record<string, unknown>)?.requestFullscreen) {
      ;(webApp as unknown as Record<string, CallableFunction>).requestFullscreen()
    }
  }, [webApp])

  const exitFullscreen = useCallback(() => {
    if ((webApp as unknown as Record<string, unknown>)?.exitFullscreen) {
      ;(webApp as unknown as Record<string, CallableFunction>).exitFullscreen()
    }
  }, [webApp])

  const addToHomeScreen = useCallback(() => {
    if ((webApp as unknown as Record<string, unknown>)?.addToHomeScreen) {
      ;(webApp as unknown as Record<string, CallableFunction>).addToHomeScreen()
    }
  }, [webApp])

  return {
    webApp,
    user,
    initData: getInitData(),
    isReady,
    colorScheme,
    hapticFeedback,
    showMainButton,
    hideMainButton,
    showBackButton,
    hideBackButton,
    showAlert,
    showConfirm,
    close,
    requestFullscreen,
    exitFullscreen,
    addToHomeScreen,
  }
}
