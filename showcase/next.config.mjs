import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  // The homepage's section ids are anchors, not routes, so /engine and
  // /hyperliquid 404 when someone types or shares them as paths. Redirect
  // them to the anchor instead of returning not-found.
  // NOTE: only ids that are NOT real routes belong here. /agents and /api are
  // real pages (and /api/* serves the live quote proxy), so they must never be
  // redirected to an anchor.
  redirects: async () => [
    'engine', 'terminal', 'hyperliquid', 'tempo',
  ].map((id) => ({
    source: `/${id}`,
    destination: `/#${id}`,
    permanent: false,
  })),
  headers: async () => [
    {
      // Apply security headers to all routes (belt-and-suspenders with middleware)
      source: '/(.*)',
      headers: [
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        {
          key: 'Strict-Transport-Security',
          value: 'max-age=31536000; includeSubDomains',
        },
        {
          key: 'Permissions-Policy',
          value: 'camera=(), microphone=(), geolocation=()',
        },
        { key: 'X-XSS-Protection', value: '0' },
      ],
    },
  ],
};

export default withNextIntl(nextConfig);
