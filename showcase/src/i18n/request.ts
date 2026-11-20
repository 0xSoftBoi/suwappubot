import { getRequestConfig } from 'next-intl/server';
import { cookies, headers } from 'next/headers';

export const locales = ['en', 'es', 'fr', 'zh'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'en';

/** Resolve the active locale for the current request.
 *  Priority: NEXT_LOCALE cookie → Accept-Language header → default (en). */
async function resolveLocale(): Promise<Locale> {
  // 1. Explicit override from cookie (set by LanguageSwitcher).
  const cookieStore = await cookies();
  const fromCookie = cookieStore.get('NEXT_LOCALE')?.value;
  if (fromCookie && (locales as readonly string[]).includes(fromCookie)) {
    return fromCookie as Locale;
  }

  // 2. Browser preference via Accept-Language.
  const headerStore = await headers();
  const acceptLang = headerStore.get('accept-language') ?? '';
  for (const segment of acceptLang.split(',')) {
    const tag = segment.split(';')[0].trim().slice(0, 2).toLowerCase();
    if ((locales as readonly string[]).includes(tag)) {
      return tag as Locale;
    }
  }

  return defaultLocale;
}

export default getRequestConfig(async () => {
  const locale = await resolveLocale();
  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
