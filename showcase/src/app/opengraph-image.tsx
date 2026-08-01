import { renderOgImage, OG_SIZE } from '@/lib/ogImage';

export const runtime = 'edge';
export const alt = 'Suwappu — Cross-chain DeFi SDK for AI Agents';
export const size = OG_SIZE;
export const contentType = 'image/png';

export default function Image() {
  return renderOgImage('Cross-chain trading for AI agents and humans.');
}
