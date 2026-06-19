import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Navigation from '@/components/Navigation';
import SummerFooter from '@/components/SummerFooter';
import DocsReader from '@/components/docs/DocsReader';
import { markdownToHtml } from '../../docs/[section]/[slug]/markdown';
import { publishedPosts, getPost } from '@/content/research';

type Params = { slug: string };

export function generateStaticParams(): Params[] {
  return publishedPosts.map((p) => ({ slug: p.slug }));
}

export function generateMetadata({ params }: { params: Params }): Metadata {
  const post = getPost(params.slug);
  if (!post) return { title: 'Not found — Suwappu Research' };
  return {
    title: `${post.title} — Suwappu`,
    description: post.excerpt,
    openGraph: { title: post.title, description: post.excerpt, type: 'article' },
  };
}

function fmtDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${months[m - 1]} ${d}, ${y}`;
}

export default function ResearchPost({ params }: { params: Params }) {
  const post = getPost(params.slug);
  if (!post || !post.body) notFound();

  // Strip the leading H1 (we render it in the header) before the body.
  const body = post.body.replace(/^#\s+.+\n+/, '');
  const html = markdownToHtml(body);

  return (
    <main className="summer-page docs-shell">
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
            {post.readMins && <span>{post.readMins} min read</span>}
          </div>
          <h1>{post.title}</h1>
        </header>

        <DocsReader html={html} title={post.title} />

        <a className="research-post__back" href="/research">← All research</a>
      </div>
      <SummerFooter />
    </main>
  );
}
