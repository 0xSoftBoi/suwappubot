import { renderOgImage, OG_SIZE } from '@/lib/ogImage';

export const runtime = 'edge';
export const alt = 'Suwappu Pricing: Free, Pro, Premium, Enterprise';
export const size = OG_SIZE;
export const contentType = 'image/png';

export default function Image() {
  return renderOgImage('Simple plans that lower your swap fee as you trade.');
}
