'use client';

import DocsSearch from './DocsSearch';
import styles from './DocsNav.module.css';

type Section = {
  id: string;
  title: string;
  pages: { slug: string; title: string }[];
};

export default function DocsNav({ sections, currentSection, currentSlug }: {
  sections: Section[];
  currentSection?: string;
  currentSlug?: string;
}) {
  return (
    <nav className={`docs-nav ${styles.nav}`} aria-label="Documentation">
      <DocsSearch />
      <a href="/" className="docs-nav__back">&larr; Home</a>
      {sections.map((section) => {
        const isCurrentSection = currentSection === section.id;
        return (
          <div key={section.id} className="docs-nav__section">
            <a
              href={`/docs#${section.id}`}
              className={`docs-nav__heading ${isCurrentSection ? 'docs-nav__heading--active' : ''}`}
              aria-current={isCurrentSection ? 'true' : undefined}
            >
              {section.title}
            </a>
            {isCurrentSection && (
              <ul className="docs-nav__list">
                {section.pages.map((page) => (
                  <li key={page.slug}>
                    <a
                      href={`/docs/${section.id}/${page.slug}`}
                      className="docs-nav__link"
                      aria-current={page.slug === currentSlug ? 'page' : undefined}
                    >
                      {page.title}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </nav>
  );
}
