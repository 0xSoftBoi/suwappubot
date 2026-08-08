import type { Metadata } from 'next';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import Navigation from '@/components/Navigation';
import SummerFooter from '@/components/SummerFooter';
import DocsReader from '@/components/docs/DocsReader';
import { markdownToHtml } from '../../docs/[section]/[slug]/markdown';
import { publishedPosts, getPost } from '@/content/research';

type Params = { slug: string };

const AUTHOR_NAME = 'Tsolmondorj Natsagdorj';
const SITE = 'https://suwappu.bot';

export function generateStaticParams(): Params[] {
  return publishedPosts.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) return { title: 'Not found — Suwappu Research' };
  const url = `/research/${post.slug}`;
  return {
    // The root layout's title template already appends "| Suwappu".
    title: post.title,
    description: post.excerpt,
    // Each post is its own indexable document, so it carries its own canonical
    // rather than inheriting the site root's.
    alternates: { canonical: url },
    authors: [{ name: AUTHOR_NAME }],
    openGraph: {
      title: post.title,
      description: post.excerpt,
      type: 'article',
      url,
      publishedTime: post.date,
      modifiedTime: post.updated ?? post.date,
      authors: [AUTHOR_NAME],
      section: post.category,
    },
    twitter: {
      card: 'summary_large_image',
      title: post.title,
      description: post.excerpt,
    },
  };
}

function fmtDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${months[m - 1]} ${d}, ${y}`;
}

export default async function ResearchPost({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post || !post.body) notFound();

  // Strip the leading H1 (we render it in the header) before the body.
  const body = post.body.replace(/^#\s+.+\n+/, '');
  const html = markdownToHtml(body);

  // ScholarlyArticle for research (stated method, released data, reproduction
  // path); TechArticle for engineering notes, which document a system rather
  // than report a result.
  const articleLd = {
    '@context': 'https://schema.org',
    '@type': post.kind === 'research' ? 'ScholarlyArticle' : 'TechArticle',
    headline: post.title,
    description: post.excerpt,
    datePublished: post.date,
    dateModified: post.updated ?? post.date,
    inLanguage: 'en',
    isAccessibleForFree: true,
    articleSection: post.category,
    keywords: post.keywords?.join(', '),
    author: { '@type': 'Person', name: AUTHOR_NAME, url: `${SITE}/about` },
    publisher: {
      '@type': 'Organization',
      name: 'Suwappu',
      url: SITE,
      logo: { '@type': 'ImageObject', url: `${SITE}/logo.svg` },
    },
    mainEntityOfPage: { '@type': 'WebPage', '@id': `${SITE}/research/${post.slug}` },
    url: `${SITE}/research/${post.slug}`,
    ...(post.heroArt && {
      image: {
        '@type': 'ImageObject',
        url: `${SITE}${post.heroArt.src}`,
        width: 1536,
        height: 1024,
        caption: post.heroArt.caption,
      },
    }),
    ...(post.report && {
      associatedMedia: {
        '@type': 'MediaObject',
        contentUrl: `${SITE}${post.report.path}`,
        encodingFormat: 'application/pdf',
        name: post.report.title,
      },
    }),
  };

  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE },
      { '@type': 'ListItem', position: 2, name: 'Research', item: `${SITE}/research` },
      { '@type': 'ListItem', position: 3, name: post.title, item: `${SITE}/research/${post.slug}` },
    ],
  };

  return (
    <main id="main-content" className="summer-page docs-shell">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }}
      />
      <Navigation />
      <div className="summer-shell mkt-page research-post">
        <nav className="doc-breadcrumb">
          <a href="/">Home</a>
          <span className="doc-breadcrumb__sep">/</span>
          <a href="/research">Research</a>
          <span className="doc-breadcrumb__sep">/</span>
          <span>{post.category}</span>
        </nav>

        <header className="research-post__head">
          <div className="research-post__meta">
            <span className="research-tag">{post.category}</span>
            <time>{fmtDate(post.date)}</time>
            {post.updated && <span>Revised {fmtDate(post.updated)}</span>}
            {post.readMins && <span>{post.readMins} min read</span>}
          </div>
          <h1>{post.title}</h1>
          {(post.report || post.paperPath) && (
            <div className="research-post__artifacts" aria-label="Research artifacts">
              {post.report && (
                <a className="research-post__report" href={post.report.path}>
                  Read report (PDF) →
                </a>
              )}
              {post.paperPath && <a href={post.paperPath}>Full working paper →</a>}
              {post.kind === 'research' && <a href="/research/replication">Data &amp; code →</a>}
            </div>
          )}
          {post.evidence && (
            <dl className="research-post__evidence" aria-label="Evidence standard">
              <div>
                <dt>Evidence</dt>
                <dd className="research-post__evidence-status">{post.evidence.status}</dd>
              </div>
              <div>
                <dt>As of</dt>
                <dd>{fmtDate(post.evidence.asOf)}</dd>
              </div>
              <div>
                <dt>Basis</dt>
                <dd>{post.evidence.basis}</dd>
              </div>
              <div>
                <dt>Boundary</dt>
                <dd>{post.evidence.boundary}</dd>
              </div>
            </dl>
          )}
          {post.heroArt && (
            <figure className="research-post__hero-art">
              <Image
                src={post.heroArt.src}
                alt={post.heroArt.alt}
                width={1536}
                height={1024}
                priority
              />
              <figcaption>{post.heroArt.caption}</figcaption>
            </figure>
          )}
        </header>

        <DocsReader html={html} title={post.title} />

        <a className="research-post__back" href="/research">← All research</a>
      </div>
      <SummerFooter />
    </main>
  );
}
