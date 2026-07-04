import type { MetadataRoute } from 'next';
import docsData from '../data/docs.json';
import { publishedPosts } from '../content/research';

const SITE = 'https://suwappu.bot';

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  // Static marketing + product pages.
  const staticRoutes: { path: string; priority: number; freq: MetadataRoute.Sitemap[number]['changeFrequency'] }[] = [
    { path: '', priority: 1, freq: 'weekly' },
    { path: '/docs', priority: 0.9, freq: 'weekly' },
    { path: '/pricing', priority: 0.8, freq: 'monthly' },
    { path: '/agents', priority: 0.85, freq: 'monthly' },
    { path: '/security', priority: 0.8, freq: 'monthly' },
    { path: '/solutions', priority: 0.8, freq: 'monthly' },
    { path: '/compare', priority: 0.8, freq: 'monthly' },
    { path: '/changelog', priority: 0.7, freq: 'weekly' },
    { path: '/research', priority: 0.7, freq: 'weekly' },
    { path: '/about', priority: 0.6, freq: 'monthly' },
    { path: '/careers', priority: 0.5, freq: 'weekly' },
    { path: '/status', priority: 0.4, freq: 'daily' },
    { path: '/legal/terms', priority: 0.3, freq: 'yearly' },
    { path: '/legal/privacy', priority: 0.3, freq: 'yearly' },
  ];

  const staticPages: MetadataRoute.Sitemap = staticRoutes.map((r) => ({
    url: `${SITE}${r.path}`,
    lastModified: now,
    changeFrequency: r.freq,
    priority: r.priority,
  }));

  const researchPages: MetadataRoute.Sitemap = publishedPosts.map((p) => ({
    url: `${SITE}/research/${p.slug}`,
    lastModified: p.date ? new Date(p.date) : now,
    changeFrequency: 'monthly' as const,
    priority: 0.6,
  }));

  const docPages: MetadataRoute.Sitemap = docsData.sections.flatMap((section) =>
    section.pages.map((page) => ({
      url: `${SITE}/docs/${section.id}/${page.slug}`,
      lastModified: now,
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    })),
  );

  return [...staticPages, ...researchPages, ...docPages];
}
