import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import docsData from '../../../../data/docs.json';
import DocPageClient from './DocPageClient';

type Params = { section: string; slug: string };

export function generateStaticParams(): Params[] {
  return docsData.sections.flatMap((section) =>
    section.pages.map((page) => ({
      section: section.id,
      slug: page.slug,
    })),
  );
}

export function generateMetadata({ params }: { params: Params }): Metadata {
  const section = docsData.sections.find((s) => s.id === params.section);
  const page = section?.pages.find((p) => p.slug === params.slug);

  if (!section || !page) {
    return { title: 'Not Found — Suwappu Docs' };
  }

  return {
    title: `${page.title} — Suwappu Docs`,
    description: page.description || `${page.title} documentation for the Suwappu cross-chain DEX API.`,
  };
}

function markdownToHtml(md: string): string {
  // Lightweight markdown-to-HTML for static rendering
  // Handles: headings, code blocks, inline code, bold, links, tables, lists, blockquotes, paragraphs
  let html = md;

  // Code blocks (must be before inline code)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang, code) => {
    const escaped = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<pre><code class="language-${lang || 'text'}">${escaped}</code></pre>`;
  });

  // Tables
  html = html.replace(/^\|(.+)\|\n\|[-| :]+\|\n((?:\|.+\|\n?)*)/gm, (_match, header, body) => {
    const headers = header.split('|').map((h: string) => h.trim()).filter(Boolean);
    const rows = body.trim().split('\n').map((row: string) =>
      row.split('|').map((c: string) => c.trim()).filter(Boolean)
    );
    const th = headers.map((h: string) => `<th>${h}</th>`).join('');
    const tr = rows.map((cells: string[]) =>
      `<tr>${cells.map((c: string) => `<td>${c}</td>`).join('')}</tr>`
    ).join('');
    return `<table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`;
  });

  // Headings
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Blockquotes
  html = html.replace(/^>\s+(.+)$/gm, '<blockquote><p>$1</p></blockquote>');

  // Unordered lists
  html = html.replace(/^[-*]\s+(.+)$/gm, '<li>$1</li>');
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Inline code (after code blocks)
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Links
  html = html.replace(/\[([^\]]+)]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Paragraphs: lines that aren't already HTML tags
  html = html.replace(/^(?!<[a-z/]|$)(.+)$/gm, '<p>$1</p>');

  // Clean up empty paragraphs
  html = html.replace(/<p>\s*<\/p>/g, '');

  return html;
}

export default function DocPage({ params }: { params: Params }) {
  const section = docsData.sections.find((s) => s.id === params.section);
  const page = section?.pages.find((p) => p.slug === params.slug);

  if (!section || !page) {
    notFound();
  }

  const html = markdownToHtml(page.body);

  return <DocPageClient section={section} page={page} html={html} />;
}
