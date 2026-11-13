'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
  NavigationMenuViewport,
} from '@ui-sdk/react/navigation-menu';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from '@ui-sdk/react/dialog';
import {
  Accordion,
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  AccordionTrigger,
} from '@ui-sdk/react/accordion';
import { TERMINAL_URL } from '@/lib/links';
import { track } from '@/lib/analytics';
import { MENU_PANELS, type MenuItem } from './NavMenuData';
import LanguageSwitcher from './LanguageSwitcher';

/**
 * SummerNav: the one site header.
 *
 * Behaviour (hover intent, arrow keys, focus return, top-layer popups, focus
 * trap, scroll lock) comes from @ui-sdk/react; this file only owns markup.
 * Styles live in app/nav.css and key off `data-slot` / state attributes.
 *
 * Every product surface must stay reachable from here: the top row carries
 * three panels plus Pricing and Docs, and anything not in the row is one hover
 * away inside a panel (see NavMenuData).
 */

const Chevron = () => (
  <svg className="site-nav__chev" width="10" height="6" viewBox="0 0 10 6" fill="none" aria-hidden="true">
    <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const isInternal = (item: Pick<MenuItem, 'href' | 'external'>) =>
  !item.external && item.href.startsWith('/');

export default function SummerNav({ tone }: { tone?: 'light' | 'dark' }) {
  const nav = useTranslations('nav');
  const tm = useTranslations('nav.menu');
  const hero = useTranslations('home.hero');
  const locale = useLocale();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const isCurrent = (href: string) =>
    href === pathname || (href !== '/' && !href.includes('#') && pathname.startsWith(`${href}/`));

  const flatLinks = [
    { href: '/pricing', label: nav('pricing') },
    { href: '/docs', label: nav('docs') },
  ];

  const closeMobile = () => setMobileOpen(false);

  return (
    <header className="site-nav" data-tone={tone}>
      <div className="site-nav__inner">
        <Link className="site-nav__brand" href="/" aria-label="Suwappu home">
          <img src="/logo.svg" alt="" width={28} height={28} aria-hidden="true" />
          <span translate="no">suwappu</span>
        </Link>

        <NavigationMenu aria-label={tm('label')} className="site-nav__menu">
          <NavigationMenuList>
            {MENU_PANELS.map((panel) => (
              <NavigationMenuItem key={panel.id} value={panel.id}>
                <NavigationMenuTrigger>
                  {tm(panel.key)}
                  <Chevron />
                </NavigationMenuTrigger>
                <NavigationMenuContent>
                  <div className="site-nav__panel" data-cols={panel.groups.length}>
                    {panel.groups.map((group) => (
                      <div key={group.key} className="site-nav__group">
                        <p className="site-nav__heading">{tm(group.key)}</p>
                        <ul>
                          {group.items.map((item) => (
                            <li key={item.key}>
                              <NavigationMenuLink
                                href={item.href}
                                current={isCurrent(item.href)}
                                {...(isInternal(item)
                                  ? { render: <Link href={item.href} /> }
                                  : item.external
                                    ? { target: '_blank', rel: 'noopener noreferrer' }
                                    : {})}
                              >
                                <span>
                                  {tm(`${item.key}Title`)}
                                  {item.external && <span className="site-nav__ext" aria-hidden="true"> ↗</span>}
                                </span>
                                <span data-slot="hint">{tm(`${item.key}Desc`)}</span>
                              </NavigationMenuLink>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                  {panel.id === 'products' && (
                    <NavigationMenuLink
                      href="/products"
                      className="site-nav__panel-footer"
                      render={<Link href="/products" />}
                      onClick={() => track('cta_clicked', { surface: 'nav_panel', destination: 'products' })}
                    >
                      {tm('allProducts')} <span aria-hidden="true">→</span>
                    </NavigationMenuLink>
                  )}
                </NavigationMenuContent>
              </NavigationMenuItem>
            ))}
            {flatLinks.map((l) => (
              <NavigationMenuItem key={l.href}>
                <NavigationMenuLink href={l.href} current={isCurrent(l.href)} render={<Link href={l.href} />}>
                  {l.label}
                </NavigationMenuLink>
              </NavigationMenuItem>
            ))}
          </NavigationMenuList>
          <NavigationMenuViewport sideOffset={10} collisionPadding={16} />
        </NavigationMenu>

        <div className="site-nav__actions">
          <div className="site-nav__lang">
            <LanguageSwitcher current={locale} />
          </div>
          <a
            className="site-nav__cta"
            href={TERMINAL_URL}
            onClick={() => track('cta_clicked', { surface: 'homepage_nav', destination: 'terminal' })}
          >
            {hero('ctaTerminal')}
          </a>

          <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
            <DialogTrigger className="site-nav__burger" aria-label={tm('open')}>
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                <path d="M2 5.5h14M2 12.5h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </DialogTrigger>
            <DialogContent className="site-nav__sheet" data-tone={tone}>
              <div className="site-nav__sheet-bar">
                <DialogTitle className="site-nav__sheet-title">{tm('mobileTitle')}</DialogTitle>
                <DialogClose className="site-nav__sheet-close" aria-label={tm('close')}>
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                    <path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                </DialogClose>
              </div>

              <div className="site-nav__sheet-body">
                <Accordion aria-label={tm('label')} className="site-nav__acc">
                  {MENU_PANELS.map((panel) => (
                    <AccordionItem key={panel.id} value={panel.id}>
                      <AccordionHeader render={<h2 />}>
                        <AccordionTrigger>
                          {tm(panel.key)}
                          <Chevron />
                        </AccordionTrigger>
                      </AccordionHeader>
                      <AccordionPanel>
                        <ul>
                          {panel.groups.flatMap((g) => g.items).map((item) => (
                            <li key={item.key}>
                              {isInternal(item) ? (
                                <Link href={item.href} onClick={closeMobile} aria-current={isCurrent(item.href) ? 'page' : undefined}>
                                  {tm(`${item.key}Title`)}
                                </Link>
                              ) : (
                                <a href={item.href} onClick={closeMobile} target="_blank" rel="noopener noreferrer">
                                  {tm(`${item.key}Title`)} <span aria-hidden="true">↗</span>
                                </a>
                              )}
                            </li>
                          ))}
                        </ul>
                      </AccordionPanel>
                    </AccordionItem>
                  ))}
                </Accordion>

                <ul className="site-nav__sheet-links">
                  {[...flatLinks, { href: '/products', label: tm('allProducts') }].map((l) => (
                    <li key={l.href}>
                      <Link href={l.href} onClick={closeMobile} aria-current={isCurrent(l.href) ? 'page' : undefined}>
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="site-nav__sheet-foot">
                <LanguageSwitcher current={locale} />
                <a className="site-nav__cta site-nav__cta--block" href={TERMINAL_URL}>
                  {hero('ctaTerminal')}
                </a>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </header>
  );
}
