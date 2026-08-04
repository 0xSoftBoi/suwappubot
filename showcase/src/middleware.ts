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

function markdownRewrite(request: NextRequest): NextResponse | null {
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

  if (request.nextUrl.pathname.startsWith('/docs')) {
    response.headers.set(
      'Link',
      '</llms.txt>; rel="llms-txt", </llms-full.txt>; rel="llms-full-txt"',
    );
    response.headers.set('X-Llms-Txt', '/llms.txt');
  }

  return response;
}

export const config = {
  matcher: ['/docs/:path*'],
};
