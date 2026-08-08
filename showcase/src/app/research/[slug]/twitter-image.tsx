import { publishedPosts, getPost } from '@/content/research';
import { OG_SIZE } from '@/lib/ogImage';
import { renderResearchSocialImage } from '@/lib/researchSocialImage';

export const alt = 'Suwappu Research';
export const size = OG_SIZE;
export const contentType = 'image/png';

// Mirror the per-post Open Graph renderer so research with bespoke editorial
// art does not fall back to the root-level generic Twitter card.
export function generateStaticParams() {
  return publishedPosts.map((p) => ({ slug: p.slug }));
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return renderResearchSocialImage(getPost(slug));
}
