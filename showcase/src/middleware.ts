import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Agent-native middleware.
 *
 * Security headers are owned by `next.config.mjs` (applied to every route): this
 * middleware deliberately does NOT set them, so it can't introduce a CSP the rest
 * of the site never had. Its only job is the agent-native docs layer:
 *
 *  1. Serve clean Markdown for any doc page via a `.md` URL suffix OR
 *     `Accept: text/markdown` content negotiation (rewritten to the doc-md route).
 *  2. Advertise the llms.txt index on every doc response via `Link` + `X-Llms-Txt`
 *     headers (the Mintlify/Anthropic pattern, so agents find it without parsing HTML).
 */
const DOC_MD = /^\/docs\/([^/]+)\/([^/]+?)(\.md)?$/;
const SOLVE_MD = /^\/solve\/([^/]+?)(\.md)?$/;
const PRODUCT_MD = /^\/products\/([^/]+?)(\.md)?$/;

function markdownRewrite(request: NextRequest): NextResponse | null {
  const sm = request.nextUrl.pathname.match(SOLVE_MD);
  if (sm) {
    const accept = request.headers.get('accept') || '';
    if (sm[2] || (accept.includes('text/markdown') && !accept.includes('text/html'))) {
      const url = request.nextUrl.clone();
      url.pathname = `/api/solve-md/${sm[1]}`;
      return NextResponse.rewrite(url);
    }
    return null;
  }

  const pm = request.nextUrl.pathname.match(PRODUCT_MD);
  if (pm) {
    const accept = request.headers.get('accept') || '';
    if (pm[2] || (accept.includes('text/markdown') && !accept.includes('text/html'))) {
      const url = request.nextUrl.clone();
      url.pathname = `/api/product-md/${pm[1]}`;
      return NextResponse.rewrite(url);
    }
    return null;
  }

  const m = request.nextUrl.pathname.match(DOC_MD);
  if (!m) return null;

  const [, section, slug, dotMd] = m;
  const accept = request.headers.get('accept') || '';
  const wantsMarkdown = accept.includes('text/markdown') && !accept.includes('text/html');

  if (dotMd || wantsMarkdown) {
    const url = request.nextUrl.clone();
    url.pathname = `/api/doc-md/${section}/${slug}`;
    return NextResponse.rewrite(url);
  }
  return null;
}

export function middleware(request: NextRequest) {
  const response = markdownRewrite(request) ?? NextResponse.next();

  if (request.nextUrl.pathname.startsWith('/docs') || request.nextUrl.pathname.startsWith('/solve') || request.nextUrl.pathname.startsWith('/products')) {
    response.headers.set(
      'Link',
      '</llms.txt>; rel="llms-txt", </llms-full.txt>; rel="llms-full-txt"',
    );
    response.headers.set('X-Llms-Txt', '/llms.txt');
  }

  // An extensionless doc/problem URL has two representations (HTML, or Markdown
  // when the client asks for it). Tell caches the response depends on Accept, or
  // a cached Markdown copy could be served to a browser asking for the page.
  const path = request.nextUrl.pathname;
  if (!path.endsWith('.md') && (SOLVE_MD.test(path) || PRODUCT_MD.test(path) || DOC_MD.test(path))) {
    response.headers.append('Vary', 'Accept');
  }

  return response;
}

export const config = {
  matcher: ['/docs/:path*', '/solve/:path*', '/products/:path*'],
};
