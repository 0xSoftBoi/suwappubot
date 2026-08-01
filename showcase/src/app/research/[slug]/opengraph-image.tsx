import { renderOgImage, OG_SIZE } from '@/lib/ogImage';
import { publishedPosts, getPost } from '@/content/research';

export const alt = 'Suwappu Research';
export const size = OG_SIZE;
export const contentType = 'image/png';

// One card per published post, generated at build time alongside the page.
export function generateStaticParams() {
  return publishedPosts.map((p) => ({ slug: p.slug }));
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getPost(slug);
  return renderOgImage(post?.title ?? 'Suwappu Research');
}
