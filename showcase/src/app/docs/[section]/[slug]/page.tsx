import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import docsData from '../../../../data/docs.json';
import DocPageClient from './DocPageClient';
import { buildToc, markdownToHtml } from './markdown';

type Params = { section: string; slug: string };

export function generateStaticParams(): Params[] {
  return docsData.sections.flatMap((section) =>
    section.pages.map((page) => ({
      section: section.id,
      slug: page.slug,
    })),
  );
}

export function generateMetadata({ params }: { params: Params }): Metadata {
  const section = docsData.sections.find((s) => s.id === params.section);
  const page = section?.pages.find((p) => p.slug === params.slug);

  if (!section || !page) {
    return { title: 'Not Found — Suwappu Docs' };
  }

  const desc = page.description || `${page.title} documentation for the Suwappu cross-chain DeFi API.`;
  return {
    title: `${page.title} — Suwappu Docs`,
    description: desc,
    openGraph: {
      title: `${page.title} — Suwappu Docs`,
      description: desc,
      type: 'article',
      url: `https://suwappu.bot/docs/${params.section}/${params.slug}`,
    },
    alternates: {
      canonical: `https://suwappu.bot/docs/${params.section}/${params.slug}`,
    },
  };
}

export default function DocPage({ params }: { params: Params }) {
  const section = docsData.sections.find((s) => s.id === params.section);
  const page = section?.pages.find((p) => p.slug === params.slug);

  if (!section || !page) {
    notFound();
  }

  const html = markdownToHtml(page.body);
  const toc = buildToc(page.body);

  return <DocPageClient section={section} page={page} html={html} toc={toc} />;
}
