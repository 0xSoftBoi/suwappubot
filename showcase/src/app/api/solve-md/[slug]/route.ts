import { SOLVE_PAGES, getSolvePage } from '@/data/solve';
import { solveMarkdown } from '@/lib/solveMarkdown';

export const runtime = 'nodejs';
export const dynamic = 'force-static';

type Params = { slug: string };

// Reached through middleware: /solve/<slug>.md or Accept: text/markdown.
export function generateStaticParams(): Params[] {
  return SOLVE_PAGES.map((p) => ({ slug: p.slug }));
}

export async function GET(_req: Request, { params }: { params: Promise<Params> }) {
  const page = getSolvePage((await params).slug);
  if (!page) {
    return new Response('Not found\n', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
  return new Response(solveMarkdown(page), {
    status: 200,
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      Vary: 'Accept',
      Link: '</llms.txt>; rel="llms-txt", </llms-full.txt>; rel="llms-full-txt"',
      'X-Llms-Txt': '/llms.txt',
    },
  });
}
