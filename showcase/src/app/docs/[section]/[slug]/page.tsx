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

function highlightCode(code: string, lang: string): string {
  let escaped = code
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  if (lang === 'json') {
    // JSON: strings, numbers, booleans, null, keys
    escaped = escaped
      .replace(/(&quot;|")((?:(?!\1)[^\\]|\\.)*)(\1)\s*:/g, '<span class="hl-key">$1$2$3</span>:')
      .replace(/(&quot;|")((?:(?!\1)[^\\]|\\.)*)(\1)/g, '<span class="hl-str">$1$2$3</span>')
      .replace(/\b(true|false|null)\b/g, '<span class="hl-bool">$1</span>')
      .replace(/\b(\d+\.?\d*)\b/g, '<span class="hl-num">$1</span>');
    return escaped;
  }

  if (lang === 'bash' || lang === 'sh') {
    // Bash: comments, strings, variables, commands
    escaped = escaped
      .replace(/(#[^\n]*)/g, '<span class="hl-comment">$1</span>')
      .replace(/"([^"]*?)"/g, '<span class="hl-str">"$1"</span>')
      .replace(/'([^']*?)'/g, '<span class="hl-str">\'$1\'</span>')
      .replace(/\b(curl|npm|bun|pip|export|echo|cd)\b/g, '<span class="hl-kw">$1</span>')
      .replace(/(-[A-Za-z]+|--[a-z-]+)/g, '<span class="hl-flag">$1</span>')
      .replace(/(https?:\/\/[^\s"'&]+)/g, '<span class="hl-url">$1</span>');
    return escaped;
  }

  // JS/TS/Python: keywords, strings, comments, numbers, then Suwappu SDK highlights
  // Comments
  escaped = escaped
    .replace(/(\/\/[^\n]*)/g, '<span class="hl-comment">$1</span>')
    .replace(/(#[^\n]*)/g, '<span class="hl-comment">$1</span>');

  // Strings (double and single quoted)
  escaped = escaped
    .replace(/"([^"]*?)"/g, '<span class="hl-str">"$1"</span>')
    .replace(/'([^']*?)'/g, '<span class="hl-str">\'$1\'</span>');

  // Keywords
  escaped = escaped.replace(
    /\b(import|from|const|let|var|async|await|function|return|if|else|new|export|class|type|interface|def|print|for|in|try|except)\b/g,
    '<span class="hl-kw">$1</span>',
  );

  // Numbers
  escaped = escaped.replace(/\b(\d+\.?\d*)\b/g, '<span class="hl-num">$1</span>');

  // Booleans / null
  escaped = escaped.replace(/\b(true|false|null|None|True|False)\b/g, '<span class="hl-bool">$1</span>');

  // Suwappu SDK — highlight key identifiers in pink
  escaped = escaped.replace(
    /\b(Suwappu|suwappu|client\.(swap|getQuote|getBalance|getPortfolio|getPrice|getTokens|getChains|createWallet|limitOrder|dcaOrder|perps|predict|lend|execute)|@suwappu\/sdk|suwappu_sk_\w+|suwappu\.bot)\b/g,
    '<span class="hl-suwappu">$1</span>',
  );

  // API paths
  escaped = escaped.replace(
    /(\/v1\/agent\/[a-z/:-]*)/g,
    '<span class="hl-url">$1</span>',
  );

  return escaped;
}

function markdownToHtml(md: string): string {
  let html = md;

  // Code blocks with syntax highlighting (must be before inline code)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang, code) => {
    const highlighted = highlightCode(code, lang || 'text');
    return `<pre><code class="language-${lang || 'text'}">${highlighted}</code></pre>`;
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
