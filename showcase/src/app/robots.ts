import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // Auth-gated app surfaces (no indexable content behind the login
        // wall) and dead hero experiments / the archived homepage (see
        // showcase/CLAUDE.md: "hero-a … hero-e are hero experiments ...
        // treat the others as dead" — hero-d is excluded here since its CSS
        // is still live on the homepage). Each of these also carries its own
        // noindex meta as the primary signal; this is belt-and-suspenders so
        // crawl budget isn't spent on them either.
        disallow: ['/admin', '/dashboard', '/classic', '/hero-a', '/hero-b', '/hero-c', '/hero-e', '/next'],
      },
      // Explicitly allow AI crawlers
      {
        userAgent: 'GPTBot',
        allow: '/',
      },
      {
        userAgent: 'ChatGPT-User',
        allow: '/',
      },
      {
        userAgent: 'Claude-Web',
        allow: '/',
      },
      {
        userAgent: 'Anthropic-AI',
        allow: '/',
      },
      {
        userAgent: 'Google-Extended',
        allow: '/',
      },
      {
        userAgent: 'PerplexityBot',
        allow: '/',
      },
    ],
    sitemap: 'https://suwappu.bot/sitemap.xml',
  };
}
