/**
 * Build-time script: parse gitbook markdown into structured JSON for the showcase.
 * Run: bun scripts/build-content.ts
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, basename } from 'path';
import matter from 'gray-matter';

const scriptDir = typeof import.meta.dir === 'string' ? import.meta.dir : new URL('.', import.meta.url).pathname;
const GITBOOK_DIR = join(scriptDir, '../../gitbook');
const OUTPUT_FILE = join(scriptDir, '../src/data/docs.json');

type DocPage = {
  slug: string;
  title: string;
  description: string;
  body: string;
  codeBlocks: string[];
};

type DocSection = {
  id: string;
  title: string;
  pages: DocPage[];
};

type DocsData = {
  intro: string;
  sections: DocSection[];
};

function extractTitle(content: string): string {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : 'Untitled';
}

function extractDescription(content: string): string {
  // First non-heading, non-empty paragraph
  const lines = content.split('\n');
  let foundHeading = false;
  for (const line of lines) {
    if (line.startsWith('#')) { foundHeading = true; continue; }
    if (!foundHeading) continue;
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('```') && !trimmed.startsWith('|') && !trimmed.startsWith('-') && !trimmed.startsWith('*')) {
      return trimmed.slice(0, 200);
    }
  }
  return '';
}

function extractCodeBlocks(content: string): string[] {
  const blocks: string[] = [];
  const regex = /```[\s\S]*?```/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    blocks.push(match[0]);
  }
  return blocks;
}

function readMarkdown(filePath: string): { content: string; data: Record<string, unknown> } {
  if (!existsSync(filePath)) return { content: '', data: {} };
  const raw = readFileSync(filePath, 'utf-8');
  const { content, data } = matter(raw);
  return { content, data };
}

function parseSummary(): DocsData {
  const summaryPath = join(GITBOOK_DIR, 'SUMMARY.md');
  const summaryContent = readFileSync(summaryPath, 'utf-8');

  const introContent = readMarkdown(join(GITBOOK_DIR, 'README.md')).content;

  const sections: DocSection[] = [];
  let currentSection: DocSection | null = null;

  for (const line of summaryContent.split('\n')) {
    // Section heading: ## Quick Start
    const sectionMatch = line.match(/^##\s+(.+)$/);
    if (sectionMatch) {
      if (currentSection) sections.push(currentSection);
      const title = sectionMatch[1].trim();
      currentSection = {
        id: title.toLowerCase().replace(/\s+/g, '-'),
        title,
        pages: [],
      };
      continue;
    }

    // Page link: * [Title](path.md)
    const pageMatch = line.match(/^\*\s+\[(.+?)]\((.+?)\)/);
    if (pageMatch && currentSection) {
      const [, linkTitle, linkPath] = pageMatch;
      const filePath = join(GITBOOK_DIR, linkPath);
      const { content } = readMarkdown(filePath);

      if (!content) continue;

      const slug = basename(linkPath, '.md');
      // Skip section README overview pages — they'll be inlined
      if (slug === 'README') {
        // Use the README content as the section description
        currentSection.pages.unshift({
          slug: 'overview',
          title: linkTitle,
          description: extractDescription(content),
          body: content,
          codeBlocks: extractCodeBlocks(content),
        });
        continue;
      }

      currentSection.pages.push({
        slug,
        title: linkTitle,
        description: extractDescription(content),
        body: content,
        codeBlocks: extractCodeBlocks(content),
      });
    }
  }

  if (currentSection) sections.push(currentSection);

  return { intro: introContent, sections };
}

// Skip if gitbook dir doesn't exist (e.g., Docker build with committed docs.json)
if (!existsSync(GITBOOK_DIR)) {
  if (existsSync(OUTPUT_FILE)) {
    console.log('Gitbook not found, using committed docs.json');
    process.exit(0);
  }
  console.error('Error: gitbook/ not found and no docs.json exists');
  process.exit(1);
}

const data = parseSummary();
writeFileSync(OUTPUT_FILE, JSON.stringify(data, null, 2));

console.log(`Built docs.json: ${data.sections.length} sections, ${data.sections.reduce((n, s) => n + s.pages.length, 0)} pages`);
