import { renderOgImage, OG_SIZE } from '@/lib/ogImage';

export const runtime = 'edge';
export const alt = 'Suwappu Arbiter: agents that cannot prove delivery do not get paid';
export const size = OG_SIZE;
export const contentType = 'image/png';

export default function Image() {
  return renderOgImage('Proof of Done. Escrow released by a hash-pinned arbiter.');
}
