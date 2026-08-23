import { renderOgImage, OG_SIZE } from '@/lib/ogImage';

export const runtime = 'edge';
export const alt = 'Suwappu Autopilot: an autonomous agent that commits before it trades';
export const size = OG_SIZE;
export const contentType = 'image/png';

export default function Image() {
  return renderOgImage('It publishes the hash before it trades.');
}
