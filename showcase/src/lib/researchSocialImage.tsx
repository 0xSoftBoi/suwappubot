import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import { OG_SIZE, renderOgImage } from '@/lib/ogImage';

type ResearchSocialPost = {
  title: string;
  heroArt?: { src: string };
};

export async function renderResearchSocialImage(post?: ResearchSocialPost) {
  if (!post?.heroArt) return renderOgImage(post?.title ?? 'Suwappu Research');

  // Keep bespoke research art self-contained in the metadata response. Using
  // a data URL avoids a build-time/runtime fetch against the production site.
  const artPath = join(process.cwd(), 'public', post.heroArt.src.replace(/^\//, ''));
  const artData = await readFile(artPath, 'base64');
  const artSrc = `data:image/jpeg;base64,${artData}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#f2eadc',
        }}
      >
        <img
          src={artSrc}
          alt=""
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        />
      </div>
    ),
    { ...OG_SIZE }
  );
}
