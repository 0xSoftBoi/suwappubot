'use client';

import DocsNav from '../../../../components/docs/DocsNav';
import DocsBreadcrumb from '../../../../components/docs/DocsBreadcrumb';
import DocsReader from '../../../../components/docs/DocsReader';
import DocsToc from '../../../../components/docs/DocsToc';
import docsData from '../../../../data/docs.json';

type TocItem = { level: number; text: string; id: string };

type Props = {
  section: { id: string; title: string };
  page: { slug: string; title: string; description: string; body: string };
  html: string;
  toc: TocItem[];
};

export default function DocPageClient({ section, page, html, toc }: Props) {
  const sections = docsData.sections.filter((s) => s.pages.length > 0);
  return (
    <div className="summer-page docs-shell">
      <div className="docs-page docs-page--reader">
        <aside className="docs-page__sidebar">
          <DocsNav sections={sections} currentSection={section.id} />
        </aside>

        <main className="docs-page__main">
          <DocsBreadcrumb section={section} page={page} />
          <DocsReader html={html} title={page.title} />
        </main>

        <DocsToc items={toc} />
      </div>
    </div>
  );
}
