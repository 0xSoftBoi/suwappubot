import { evidenceDocument } from '../arbiter/data';

// Static evidence document for agents reviewing the Arbiter page.
export const dynamic = 'force-static';

export function GET() {
  return Response.json(evidenceDocument(), {
    headers: { 'Cache-Control': 'public, max-age=300, s-maxage=3600' },
  });
}
