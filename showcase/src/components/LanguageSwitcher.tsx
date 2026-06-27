'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import styles from './LanguageSwitcher.module.css';

const LOCALES = [
  { code: 'en', label: 'EN' },
  { code: 'es', label: 'ES' },
  { code: 'fr', label: 'FR' },
  { code: 'zh', label: '中文' },
] as const;

type Locale = (typeof LOCALES)[number]['code'];

interface Props {
  current: string;
}

export default function LanguageSwitcher({ current }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function switchLocale(locale: Locale) {
    // Persist to cookie (read by i18n/request.ts on the server).
    const secure = window.location.protocol === 'https:' ? ';Secure' : '';
    document.cookie = `NEXT_LOCALE=${locale};path=/;max-age=31536000;SameSite=Lax${secure}`;
    // Mirror to localStorage so client code can read it without a round-trip.
    try { localStorage.setItem('NEXT_LOCALE', locale); } catch {}
    startTransition(() => router.refresh());
  }

  return (
    <div className={styles.switcher} aria-label="Select language" role="group">
      {LOCALES.map(({ code, label }) => (
        <button
          key={code}
          className={`${styles.option} ${current === code ? styles.active : ''}`}
          onClick={() => switchLocale(code)}
          aria-pressed={current === code}
          disabled={isPending}
          aria-label={code.toUpperCase()}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
