import { renderOgImage, OG_SIZE } from '@/lib/ogImage';

export const runtime = 'edge';
export const alt = 'Suwappu Agent API: REST, MCP & A2A for AI agents';
export const size = OG_SIZE;
export const contentType = 'image/png';

export default function Image() {
  return renderOgImage('One API for agent swaps, perps, and wallets.');
}
