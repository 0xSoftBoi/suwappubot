import type { MetadataRoute } from 'next';
import docsData from '../data/docs.json';

export default function sitemap(): MetadataRoute.Sitemap {
  const docPages: MetadataRoute.Sitemap = docsData.sections.flatMap((section) =>
    section.pages.map((page) => ({
      url: `https://suwappu.bot/docs/${section.id}/${page.slug}`,
      lastModified: new Date(),
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    })),
  );

  return [
    {
      url: 'https://suwappu.bot',
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1,
    },
    {
      url: 'https://suwappu.bot/docs',
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.9,
    },
    ...docPages,
  ];
}
