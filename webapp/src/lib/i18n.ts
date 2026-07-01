import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import en from '../locales/en.json'
import es from '../locales/es.json'
import fr from '../locales/fr.json'
import zh from '../locales/zh.json'

function detectLanguage(): string {
  try {
    const stored = localStorage.getItem('suwappu_locale')
    if (stored && ['en', 'es', 'fr', 'zh'].includes(stored)) return stored

    const tgLang =
      (window as any).Telegram?.WebApp?.initDataUnsafe?.user?.language_code as
        | string
        | undefined

    if (tgLang) {
      const code = tgLang.toLowerCase()
      if (code.startsWith('es')) return 'es'
      if (code.startsWith('fr')) return 'fr'
      if (code.startsWith('zh')) return 'zh'
    }
  } catch {
    // not in Telegram WebApp context
  }
  return 'en'
}

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    es: { translation: es },
    fr: { translation: fr },
    zh: { translation: zh },
  },
  lng: detectLanguage(),
  fallbackLng: 'en',
  interpolation: {
    escapeValue: true,
  },
})

export default i18n
