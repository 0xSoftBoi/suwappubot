'use client';

import styles from './LanguageSwitcher.module.css';

export const LOCALES = [
  { code: 'en', label: 'EN', name: 'English' },
  { code: 'es', label: 'ES', name: 'Español' },
  { code: 'fr', label: 'FR', name: 'Français' },
  { code: 'zh', label: '中文', name: '中文' },
] as const;

export type Locale = (typeof LOCALES)[number]['code'];

interface Props {
  current: string;
}

export function switchLocale(locale: Locale, current: string) {
  if (locale === current) return;
  // Persist to cookie (read by i18n/request.ts on the server).
  const secure = window.location.protocol === 'https:' ? ';Secure' : '';
  document.cookie = `NEXT_LOCALE=${locale};path=/;max-age=31536000;SameSite=Lax${secure}`;
  // Mirror to localStorage so client code can read it without a round-trip.
  try { localStorage.setItem('NEXT_LOCALE', locale); } catch {}
  // Hard navigation: full document request so the server sees the cookie
  // and re-renders layout + route together. Preserve any query string.
  window.location.assign(window.location.pathname + window.location.search);
}

/**
 * Cookie-based locale switch for the static site (no next-intl middleware,
 * no path prefixes). A full document navigation is required, not
 * router.refresh(): the messages live in the shared root layout, and a
 * refresh only re-fetches the current route segment, so the provider keeps
 * the old locale's messages. Setting the cookie then navigating forces the
 * server to re-render the whole tree with the new language (verified: a
 * fresh document request after the cookie is set renders Spanish).
 */
export default function LanguageSwitcher({ current }: Props) {
  return (
    <div className={styles.switcher} aria-label="Select language" role="group">
      {LOCALES.map(({ code, label }) => (
        <button
          key={code}
          className={`${styles.option} ${current === code ? styles.active : ''}`}
          onClick={() => switchLocale(code, current)}
          aria-pressed={current === code}
          aria-label={code.toUpperCase()}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
