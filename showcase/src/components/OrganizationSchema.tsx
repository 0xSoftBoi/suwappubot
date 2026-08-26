// Site-wide JSON-LD: Organization + WebSite, rendered once from the root
// layout so every route (not just "/") carries the brand entity graph Google
// uses for knowledge-panel / sitelinks-searchbox eligibility. Page-specific
// schema (SoftwareApplication, FAQPage, TechArticle) stays local to the pages
// whose visible content it actually describes — see StructuredData.tsx.
export default function OrganizationSchema() {
  const schemas = [
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'Suwappu',
      url: 'https://suwappu.bot',
      logo: 'https://suwappu.bot/logo.svg',
      sameAs: [
        'https://x.com/suwappubot',
        'https://t.me/suwappu_bot',
        'https://github.com/0xSoftBoi/suwappubot',
      ],
    },
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: 'Suwappu',
      url: 'https://suwappu.bot',
    },
  ];

  return (
    <>
      {schemas.map((schema, i) => (
        <script
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
        />
      ))}
    </>
  );
}
