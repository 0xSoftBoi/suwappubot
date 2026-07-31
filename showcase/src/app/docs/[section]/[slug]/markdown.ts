// Markdown → HTML rendering for docs and research pages.
//
// Kept in a non-route module: Next.js only permits a fixed set of exports from
// `page.tsx` (default, metadata, generateStaticParams, …), so these shared
// helpers must live outside the route file.

// Single-pass tokenizer: one global regex per language, applied with a replace
// callback. The replacement text is never re-scanned, so highlight spans can
// never nest or corrupt each other (the old multi-pass version matched flag/
// keyword patterns *inside* already-inserted class names).
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function highlightCode(code: string, lang: string): string {
  const escaped = escapeHtml(code);
  const span = (cls: string, text: string) => `<span class="${cls}">${text}</span>`;

  if (lang === 'json') {
    return escaped.replace(
      /("(?:[^"\\]|\\.)*")(\s*:)|("(?:[^"\\]|\\.)*")|\b(true|false|null)\b|\b(\d+\.?\d*)\b/g,
      (m, keyStr, colon, str, bool, num) => {
        if (keyStr) return span('hl-key', keyStr) + colon;
        if (str) return span('hl-str', str);
        if (bool) return span('hl-bool', bool);
        if (num) return span('hl-num', num);
        return m;
      },
    );
  }

  if (lang === 'bash' || lang === 'sh') {
    return escaped.replace(
      /(#[^\n]*)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(https?:\/\/[^\s"'&]+)|(--?[A-Za-z][\w-]*)|\b(curl|npm|bun|npx|pip|export|echo|cd)\b/g,
      (m, comment, str, url, flag, kw) => {
        if (comment) return span('hl-comment', comment);
        if (str) return span('hl-str', str);
        if (url) return span('hl-url', url);
        if (flag) return span('hl-flag', flag);
        if (kw) return span('hl-kw', kw);
        return m;
      },
    );
  }

  // JS / TS / Python / default
  return escaped.replace(
    /(\/\/[^\n]*|#[^\n]*)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(@suwappu\/sdk|suwappu_sk_\w+|\/v1\/agent\/[\w/:-]*)|\b(import|from|const|let|var|async|await|function|return|if|else|new|export|class|type|interface|def|print|for|in|try|except)\b|\b(true|false|null|None|True|False)\b|\b(\d+\.?\d*)\b/g,
    (m, comment, str, sdk, kw, bool, num) => {
      if (comment) return span('hl-comment', comment);
      if (str) return span('hl-str', str);
      if (sdk) return span('hl-suwappu', sdk);
      if (kw) return span('hl-kw', kw);
      if (bool) return span('hl-bool', bool);
      if (num) return span('hl-num', num);
      return m;
    },
  );
}

const LANG_LABEL: Record<string, string> = {
  bash: 'cURL', sh: 'cURL', shell: 'cURL', curl: 'cURL',
  js: 'JavaScript', javascript: 'JavaScript', ts: 'TypeScript', typescript: 'TypeScript',
  py: 'Python', python: 'Python', go: 'Go', rust: 'Rust', ruby: 'Ruby', json: 'JSON', http: 'HTTP',
};
const langLabel = (l: string) =>
  LANG_LABEL[(l || 'text').toLowerCase()] || (l ? l[0].toUpperCase() + l.slice(1) : 'Text');

function slugify(s: string): string {
  return s.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '');
}

export type TocItem = { level: number; text: string; id: string };

// Headings for the "On this page" rail: fence-aware so `##` inside code blocks is ignored.
export function buildToc(md: string): TocItem[] {
  const items: TocItem[] = [];
  let inFence = false;
  for (const line of md.split('\n')) {
    if (/^```/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = line.match(/^(#{2,3})\s+(.+?)\s*$/);
    if (m) {
      const text = m[2].trim();
      items.push({ level: m[1].length, text: text.replace(/`/g, ''), id: slugify(text) });
    }
  }
  return items;
}

export function markdownToHtml(md: string): string {
  let html = md;

  // Adjacent fenced blocks in *different request languages* (cURL/TS/Python) →
  // one tabbed widget. The regex only matches runs of request-language fences,
  // so a following ```json response always breaks the run (no dependency on
  // prose separation) and renders standalone below.
  const REQ = '(?:bash|sh|shell|curl|js|javascript|ts|typescript|py|python|go|ruby|rust)';
  const tabGroupRe = new RegExp(
    '```' + REQ + '\\n[\\s\\S]*?```(?:\\n```' + REQ + '\\n[\\s\\S]*?```)+',
    'g',
  );
  html = html.replace(tabGroupRe, (group) => {
    const fences = Array.from(group.matchAll(/```([\w-]*)\n([\s\S]*?)```/g));
    const langs = fences.map((f) => (f[1] || 'text').toLowerCase());
    const distinct = new Set(langs).size === langs.length;
    if (!distinct || fences.length < 2) return group;
    const tabs = fences
      .map((f, i) => `<button type="button" class="code-tabs__tab${i === 0 ? ' is-active' : ''}" data-tab="${i}">${langLabel(f[1])}</button>`)
      .join('');
    const panels = fences
      .map((f, i) => `<pre class="code-tabs__panel${i === 0 ? ' is-active' : ''}" data-tab="${i}"><code class="language-${f[1] || 'text'}">${highlightCode(f[2], (f[1] || 'text').toLowerCase())}</code></pre>`)
      .join('');
    return `<div class="code-tabs"><div class="code-tabs__bar">${tabs}</div>${panels}</div>`;
  });

  // Standalone code blocks with syntax highlighting (must be before inline code)
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

  // Headings: stable slug ids (deterministic deep links for humans AND agents)
  // plus HTTP method badges for "VERB /path" API-reference headings.
  const renderHeading = (level: number, text: string) => {
    const id = slugify(text);
    const m = text.match(/^(GET|POST|PATCH|PUT|DELETE)\s+(\/\S+)\s*(.*)$/);
    const inner = m
      ? `<span class="doc-method doc-method--${m[1].toLowerCase()}">${m[1]}</span><code class="doc-method__path">${m[2]}</code>${m[3] ? ' ' + m[3] : ''}`
      : text;
    return `<h${level} id="${id}"><a class="doc-anchor" href="#${id}" aria-hidden="true">#</a>${inner}</h${level}>`;
  };
  html = html.replace(/^### (.+)$/gm, (_m, t) => renderHeading(3, t));
  html = html.replace(/^## (.+)$/gm, (_m, t) => renderHeading(2, t));
  html = html.replace(/^# (.+)$/gm, (_m, t) => renderHeading(1, t));

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
