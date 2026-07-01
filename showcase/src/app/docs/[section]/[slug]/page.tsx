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

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { section: sectionId, slug } = await params;
  const section = docsData.sections.find((s) => s.id === sectionId);
  const page = section?.pages.find((p) => p.slug === slug);

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
      url: `https://suwappu.bot/docs/${sectionId}/${slug}`,
    },
    alternates: {
      canonical: `https://suwappu.bot/docs/${sectionId}/${slug}`,
    },
  };
}

export default async function DocPage({ params }: { params: Promise<Params> }) {
  const { section: sectionId, slug } = await params;
  const section = docsData.sections.find((s) => s.id === sectionId);
  const page = section?.pages.find((p) => p.slug === slug);

  if (!section || !page) {
    notFound();
  }

  const html = markdownToHtml(page.body);
  const toc = buildToc(page.body);

  return <DocPageClient section={section} page={page} html={html} toc={toc} />;
}
