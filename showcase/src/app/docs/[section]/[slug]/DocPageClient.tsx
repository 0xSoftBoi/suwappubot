'use client';

import DocsNav from '../../../../components/docs/DocsNav';
import DocsBreadcrumb from '../../../../components/docs/DocsBreadcrumb';
import DocsReader from '../../../../components/docs/DocsReader';
import docsData from '../../../../data/docs.json';

type Props = {
  section: { id: string; title: string };
  page: { slug: string; title: string; description: string; body: string };
  html: string;
};

export default function DocPageClient({ section, page, html }: Props) {
  return (
    <div className="docs-page">
      <aside className="docs-page__sidebar">
        <DocsNav sections={docsData.sections} currentSection={section.id} />
      </aside>

      <main className="docs-page__main">
        <DocsBreadcrumb section={section} page={page} />
        <DocsReader html={html} title={page.title} />
      </main>
    </div>
  );
}
