'use client';

import { useTranslations } from 'next-intl';
import {
  Menu,
  MenuContent,
  MenuItemIndicator,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
} from '@ui-sdk/react/menu';
import { LOCALES, switchLocale, type Locale } from './LanguageSwitcher';

/**
 * Compact globe dropdown for the desktop header. Same cookie + hard-navigation
 * switch as LanguageSwitcher (which stays in the mobile sheet and footer);
 * open/close, arrow keys, Esc and focus return come from @ui-sdk/react/menu.
 */
export default function LanguageMenu({ current }: { current: string }) {
  const tm = useTranslations('nav.menu');
  const active = LOCALES.find((l) => l.code === current) ?? LOCALES[0];

  return (
    <Menu>
      <MenuTrigger className="site-nav__langbtn" aria-label={`${tm('language')}: ${active.name}`}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.3" />
          <path d="M1.75 8h12.5M8 1.75c1.8 1.7 2.7 3.8 2.7 6.25S9.8 12.55 8 14.25C6.2 12.55 5.3 10.45 5.3 8S6.2 3.45 8 1.75Z" stroke="currentColor" strokeWidth="1.3" />
        </svg>
        <span>{active.label}</span>
      </MenuTrigger>
      <MenuContent className="site-nav__langmenu">
        <MenuRadioGroup
          name="locale"
          value={active.code}
          onValueChange={(value) => switchLocale(value as Locale, current)}
        >
          {LOCALES.map(({ code, name }) => (
            <MenuRadioItem key={code} value={code} lang={code}>
              <MenuItemIndicator>✓</MenuItemIndicator>
              {name}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  );
}
