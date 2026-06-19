'use client';

import DocsSearch from './DocsSearch';

type Section = {
  id: string;
  title: string;
  pages: { slug: string; title: string }[];
};

export default function DocsNav({ sections, currentSection }: {
  sections: Section[];
  currentSection?: string;
}) {
  return (
    <nav className="docs-nav">
      <DocsSearch />
      <a href="/" className="docs-nav__back">&larr; Home</a>
      {sections.map((section) => (
        <div key={section.id} className="docs-nav__section">
          <a
            href={`/docs#${section.id}`}
            className={`docs-nav__heading ${currentSection === section.id ? 'docs-nav__heading--active' : ''}`}
          >
            {section.title}
          </a>
          {currentSection === section.id && (
            <ul className="docs-nav__list">
              {section.pages.map((page) => (
                <li key={page.slug}>
                  <a href={`/docs/${section.id}/${page.slug}`} className="docs-nav__link">
                    {page.title}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </nav>
  );
}
