```markdown
# suwappubot Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill teaches you the core development patterns, coding conventions, and publishing workflows used in the `suwappubot` repository. The codebase is primarily Python, with a focus on research paper publishing, exhibit management, and metadata handling. It uses conventional commit messages, snake_case file naming, and a mix of import/export styles. The repository supports structured workflows for adding/updating research content and for making sitewide corrections or metadata improvements.

## Coding Conventions

- **File Naming:**  
  Use `snake_case` for Python files and directories.  
  _Example:_  
  ```
  research_paper_parser.py
  data_loader.py
  ```

- **Import Style:**  
  Both absolute and relative imports are used.  
  _Example:_  
  ```python
  import os
  from utils.data_loader import load_data
  from .research_paper_parser import parse_paper
  ```

- **Export Style:**  
  Functions and classes are exported as needed; both explicit and implicit exports are present.  
  _Example:_  
  ```python
  def analyze_data(data):
      # analysis logic
      return result
  ```

- **Commit Messages:**  
  Use [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/):  
  - Prefixes: `feat`, `fix`
  - Example:  
    ```
    feat: add support for SVG exhibit uploads to research workflow
    fix: correct metadata parsing for research papers
    ```

## Workflows

### Add or Update Research Paper with Exhibits and Replication Bundle
**Trigger:** When you want to publish or update a research paper with supporting exhibits and/or replication materials.  
**Command:** `/publish-research`

1. **Add or update SVG exhibit(s):**  
   Place SVG files in `showcase/public/research/`.
2. **Add or update research post markdown and metadata:**  
   Place `.md` files in `showcase/public/research/replication/papers/`.
3. **Add or update code/data for replication:**  
   - Code: `showcase/public/research/replication/code/*.py`
   - Data: `showcase/public/research/replication/data/**/*.json` or `.csv`
4. **Update research index/content:**  
   Edit `showcase/src/content/research.ts` to include the new/updated paper.
5. **Update or create route files:**  
   - Main paper: `showcase/src/app/research/[slug]/page.tsx`
   - Replication bundle: `showcase/src/app/research/replication/page.tsx`
6. **Update or create Open Graph images:**  
   If needed, update `showcase/src/app/research/[slug]/opengraph-image.tsx`.
7. **Update CSS:**  
   For global or research-specific styles, edit `showcase/src/app/globals.css` or `showcase/src/app/research/research.module.css`.
8. **Verify production build:**  
   Ensure the paper, exhibits, and replication bundle render and are downloadable.

_Example: Adding a new research paper markdown file_
```markdown
---
title: "A New Approach to Data Analysis"
authors: ["Jane Doe", "John Smith"]
date: "2024-06-01"
---
# Abstract
This paper introduces...
```

### Sitewide Research Section Corrections and Metadata Improvements
**Trigger:** When you need to correct errors in published research, improve metadata, or enhance markdown/image support.  
**Command:** `/correct-research`

1. **Edit research post content and metadata:**  
   Update `.md` files in `showcase/public/research/replication/papers/` and `showcase/src/content/research.ts`.
2. **Update or correct SVG exhibits:**  
   Edit files in `showcase/public/research/`.
3. **Update markdown renderer or sanitization:**  
   - Renderer: `showcase/src/app/docs/[section]/[slug]/markdown.ts`
   - Docs reader: `showcase/src/components/docs/DocsReader.tsx`
4. **Update canonical URL logic and SEO metadata:**  
   Edit `showcase/src/app/layout.tsx` and relevant route files.
5. **Update or add Open Graph images:**  
   Edit `showcase/src/app/research/[slug]/opengraph-image.tsx`.
6. **Update global CSS if needed:**  
   Edit `showcase/src/app/globals.css`.
7. **Verify changes in production build:**  
   Ensure corrections and enhancements are reflected.

_Example: Updating SEO metadata in a route file_
```tsx
export const metadata = {
  title: "Corrected Paper Title",
  description: "Updated description for improved SEO.",
  canonical: "https://example.com/research/corrected-paper"
};
```

## Testing Patterns

- **Framework:**  
  Jest (JavaScript/TypeScript)

- **Test File Pattern:**  
  Test files are named with `.test.ts` suffix.

- **Example Test File:**  
  ```
  data_loader.test.ts
  ```

- **Test Example:**  
  ```typescript
  import { loadData } from './data_loader';

  test('loads data correctly', () => {
    const data = loadData('test.csv');
    expect(data).toBeDefined();
  });
  ```

## Commands

| Command            | Purpose                                                                                     |
|--------------------|---------------------------------------------------------------------------------------------|
| /publish-research  | Publish or update a research paper with exhibits and/or a replication bundle                |
| /correct-research  | Correct published research, update metadata, or enhance markdown/image/SEO support          |
```