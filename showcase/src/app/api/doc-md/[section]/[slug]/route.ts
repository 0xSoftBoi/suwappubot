import docsData from '@/data/docs.json';

// Node runtime so we can read the (large) bundled docs.json.
export const runtime = 'nodejs';
export const dynamic = 'force-static';

type Params = { section: string; slug: string };

// Pre-generate every doc page as a static .md response.
export function generateStaticParams(): Params[] {
  return docsData.sections.flatMap((s) =>
    s.pages.map((p) => ({ section: s.id, slug: p.slug })),
  );
}

const INDEX_POINTER =
  '> Suwappu API documentation. The complete machine-readable index is at ' +
  'https://suwappu.bot/llms.txt — and the full corpus at https://suwappu.bot/llms-full.txt\n\n';

export function GET(_req: Request, { params }: { params: Params }) {
  const section = docsData.sections.find((s) => s.id === params.section);
  const page = section?.pages.find((p) => p.slug === params.slug);

  if (!section || !page) {
    return new Response('Not found\n', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  const body = INDEX_POINTER + page.body.trim() + '\n';

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      Link: '</llms.txt>; rel="llms-txt", </llms-full.txt>; rel="llms-full-txt"',
      'X-Llms-Txt': '/llms.txt',
    },
  });
}
