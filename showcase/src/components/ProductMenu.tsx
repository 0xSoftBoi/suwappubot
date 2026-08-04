'use client';

import { useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { MENU_PANELS } from './NavMenuData';

/**
 * ProductMenu: the grouped product directory shared by both headers.
 *
 * The site has two header shells: `.summer-nav` (sticky, homepage) and `.nav`
 * (fixed, every other page). They position differently, so they stay separate,
 * but the menu contents must not drift apart. Both render this.
 *
 * `triggerClassName` lets each shell style its own trigger to match its
 * surrounding links.
 */
export default function ProductMenu({
  triggerClassName,
  isActive,
}: {
  triggerClassName: string;
  /** Optional route/section matcher so the open panel can mark the current page. */
  isActive?: (href: string) => boolean;
}) {
  const tm = useTranslations('nav.menu');
  const [openPanel, setOpenPanel] = useState<string | null>(null);

  const close = useCallback(() => setOpenPanel(null), []);

  return (
    <>
      {MENU_PANELS.map((panel) => {
        const open = openPanel === panel.id;
        return (
          <div
            key={panel.id}
            className="nav__panel-wrap"
            onMouseEnter={() => setOpenPanel(panel.id)}
            onMouseLeave={close}
          >
            <button
              type="button"
              className={`${triggerClassName} nav__trigger${open ? ' nav__trigger--open' : ''}`}
              aria-expanded={open}
              aria-controls={`nav-panel-${panel.id}`}
              onClick={() => setOpenPanel(open ? null : panel.id)}
            >
              {tm(panel.key)}
              <svg
                className="nav__chev"
                width="10"
                height="6"
                viewBox="0 0 10 6"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M1 1l4 4 4-4"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>

            <div
              id={`nav-panel-${panel.id}`}
              className={`nav__panel${open ? ' nav__panel--open' : ''}`}
              hidden={!open}
            >
              <div className="nav__panel-inner">
                {panel.groups.map((group) => (
                  <div key={group.key} className="nav__panel-group">
                    <p className="nav__panel-heading">{tm(group.key)}</p>
                    {group.items.map((item) => {
                      const active = isActive?.(item.href) ?? false;
                      return (
                        <a
                          key={item.key}
                          href={item.href}
                          className={`nav__panel-link${active ? ' nav__panel-link--active' : ''}`}
                          aria-current={active ? 'page' : undefined}
                          onClick={close}
                          {...(item.external
                            ? { target: '_blank', rel: 'noopener noreferrer' }
                            : {})}
                        >
                          <span className="nav__panel-title">{tm(`${item.key}Title`)}</span>
                          <span className="nav__panel-desc">{tm(`${item.key}Desc`)}</span>
                        </a>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}
