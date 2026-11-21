import { PRODUCTS, getProduct } from '@/data/products';
import { productMarkdown } from '@/lib/productMarkdown';

export const runtime = 'nodejs';
export const dynamic = 'force-static';

type Params = { slug: string };

// Reached through middleware: /products/<slug>.md or Accept: text/markdown.
export function generateStaticParams(): Params[] {
  return PRODUCTS.map((p) => ({ slug: p.slug }));
}

export async function GET(_req: Request, { params }: { params: Promise<Params> }) {
  const page = getProduct((await params).slug);
  if (!page) {
    return new Response('Not found\n', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
  return new Response(productMarkdown(page), {
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
