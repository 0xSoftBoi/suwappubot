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
    {
      // Hero media (see docs/design/hero-media.md). Next serves everything in
      // public/ as `max-age=0`, so without this every repeat visit revalidates
      // a 1.3 MB video and a 200 KB poster. Verified against production before
      // and after: the response was `cache-control: public, max-age=0`.
      //
      // These filenames are stable rather than content-hashed, so this is
      // deliberately a week and NOT `immutable`: regenerating the loop via
      // scripts/encode-ocean.sh reuses the same names, and a stale background
      // video for up to 7 days is a cosmetic non-event, whereas an immutable
      // year would strand it in caches indefinitely.
      source: '/media/:file*',
      headers: [{ key: 'Cache-Control', value: 'public, max-age=604800' }],
    },
  ],
};

export default withNextIntl(nextConfig);
