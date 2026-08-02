import { useTranslation } from 'react-i18next'
import { api } from '../lib/api'

const LANGUAGES = [
  { code: 'en', label: 'EN' },
  { code: 'es', label: 'ES' },
  { code: 'fr', label: 'FR' },
  { code: 'zh', label: '中' },
] as const

export function LanguageSwitcher() {
  const { i18n } = useTranslation()
  const currentLang = i18n.language

  return (
    <div className="flex gap-1">
      {LANGUAGES.map(({ code, label }) => (
        <button
          key={code}
          onClick={() => {
            // Instant local switch — never block the UI on the network call
            i18n.changeLanguage(code)
            localStorage.setItem('suwappu_locale', code)
            // Best-effort persist to backend so the choice follows the user
            // across devices/sessions; failures are non-fatal (local switch
            // already applied).
            api.updateLanguage(code).catch((err) => {
              console.error('Failed to persist language preference:', err)
            })
          }}
          className={`px-3 py-1.5 rounded-suwappu-lg text-xs font-semibold font-heading transition-colors ${
            currentLang === code
              ? 'bg-suwappu-gradient text-white'
              : 'bg-suwappu-sakura-light/50 text-suwappu-text-secondary hover:bg-suwappu-sakura-light'
          }`}
          aria-label={code}
          aria-pressed={currentLang === code}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
