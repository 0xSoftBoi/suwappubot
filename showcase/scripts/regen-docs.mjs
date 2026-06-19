// Node port of build-content.ts (bun unavailable in this env). Same parse logic.
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, basename, dirname } from 'path';
import { fileURLToPath } from 'url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const GITBOOK_DIR = join(scriptDir, '../../gitbook');
const OUTPUT_FILE = join(scriptDir, '../src/data/docs.json');

function extractDescription(content) {
  const lines = content.split('\n');
  let foundHeading = false;
  for (const line of lines) {
    if (line.startsWith('#')) { foundHeading = true; continue; }
    if (!foundHeading) continue;
    const t = line.trim();
    if (t && !t.startsWith('```') && !t.startsWith('|') && !t.startsWith('-') && !t.startsWith('*')) {
      return t.slice(0, 200);
    }
  }
  return '';
}
function extractCodeBlocks(content) {
  const blocks = [];
  const regex = /```[\s\S]*?```/g;
  let m;
  while ((m = regex.exec(content)) !== null) blocks.push(m[0]);
  return blocks;
}
function readMarkdown(p) { return existsSync(p) ? readFileSync(p, 'utf-8') : ''; }

function parseSummary() {
  const summaryContent = readFileSync(join(GITBOOK_DIR, 'SUMMARY.md'), 'utf-8');
  const introContent = readMarkdown(join(GITBOOK_DIR, 'README.md'));
  const sections = [];
  let cur = null;
  const missing = [];
  for (const line of summaryContent.split('\n')) {
    const sec = line.match(/^##\s+(.+)$/);
    if (sec) {
      if (cur) sections.push(cur);
      const title = sec[1].trim();
      cur = { id: title.toLowerCase().replace(/\s+/g, '-'), title, pages: [] };
      continue;
    }
    const pm = line.match(/^\*\s+\[(.+?)]\((.+?)\)/);
    if (pm && cur) {
      const [, linkTitle, linkPath] = pm;
      const content = readMarkdown(join(GITBOOK_DIR, linkPath));
      if (!content) { missing.push(`${cur.title} → ${linkPath}`); continue; }
      const slug = basename(linkPath, '.md');
      const page = { slug: slug === 'README' ? 'overview' : slug, title: linkTitle, description: extractDescription(content), body: content, codeBlocks: extractCodeBlocks(content) };
      if (slug === 'README') cur.pages.unshift(page); else cur.pages.push(page);
    }
  }
  if (cur) sections.push(cur);
  return { data: { intro: introContent, sections }, missing };
}

const { data, missing } = parseSummary();
writeFileSync(OUTPUT_FILE, JSON.stringify(data, null, 2));
const total = data.sections.reduce((n, s) => n + s.pages.length, 0);
console.log(`Built docs.json: ${data.sections.length} sections, ${total} pages`);
console.log('Per section:', data.sections.map(s => `${s.title}=${s.pages.length}`).join(', '));
if (missing.length) console.log('\nSTILL MISSING (skipped, no file):\n - ' + missing.join('\n - '));
else console.log('\nAll SUMMARY entries resolved to files.');
