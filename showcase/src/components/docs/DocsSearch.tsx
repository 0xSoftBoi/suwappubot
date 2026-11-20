'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
} from '@ui-sdk/react/command';
import {
  Dialog,
  DialogBackdrop,
  DialogContent,
  DialogShortcut,
  DialogTitle,
  DialogTrigger,
} from '@ui-sdk/react/dialog';
import styles from './DocsSearch.module.css';
import docsData from '../../data/docs.json';

type Hit = {
  sectionId: string;
  sectionTitle: string;
  slug: string;
  title: string;
  description: string;
  url: string;
  keywords: string[];
};

// Flat search index built once from docs.json.
const INDEX: Hit[] = docsData.sections
  .filter((s) => s.pages.length > 0)
  .flatMap((s) =>
    s.pages.map((p) => ({
      sectionId: s.id,
      sectionTitle: s.title,
      slug: p.slug,
      title: p.title,
      description: p.description || '',
      url: `/docs/${s.id}/${p.slug}`,
      keywords: [s.title, ...(p.description || '').split(/\s+/).filter((w) => w.length > 3)],
    })),
  );

// Sections in docs.json order, each with its pages.
const GROUPS = INDEX.reduce<Array<{ title: string; hits: Hit[] }>>((acc, hit) => {
  const last = acc[acc.length - 1];
  if (last && last.title === hit.sectionTitle) last.hits.push(hit);
  else acc.push({ title: hit.sectionTitle, hits: [hit] });
  return acc;
}, []);

/**
 * DocsSearch: the ⌘K palette.
 *
 * @ui-sdk/react `command` inside `dialog` owns filtering, arrow keys, Enter,
 * the mod+K shortcut, focus trap, Escape and focus return; this file is markup.
 */
export default function DocsSearch() {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="docs-search__trigger" shortcut="mod+k">
        <span className="docs-search__trigger-icon" aria-hidden="true">⌕</span>
        <span>Search docs…</span>
        <DialogShortcut className="docs-search__kbd" />
      </DialogTrigger>
      <DialogBackdrop className={styles.backdrop} />
      <DialogContent className={styles.modal}>
        <DialogTitle className="sr-only">Search documentation</DialogTitle>
        <Command
          className={styles.command}
          filter="contains"
          onAction={(url) => {
            setOpen(false);
            router.push(url);
          }}
        >
          <div className={styles.inputRow}>
            <span className={styles.icon} aria-hidden="true">⌕</span>
            <CommandInput
              className={styles.input}
              aria-label="Search documentation"
              placeholder="Search the docs…"
              autoComplete="off"
              spellCheck={false}
            />
            <kbd className="docs-search__kbd">esc</kbd>
          </div>
          <CommandEmpty className={styles.empty}>No results. Try a broader term.</CommandEmpty>
          <CommandList className={styles.list}>
            {GROUPS.map((group) => (
              <CommandGroup key={group.title} className={styles.group}>
                <CommandGroupLabel className={styles.groupLabel}>{group.title}</CommandGroupLabel>
                {group.hits.map((h) => (
                  <CommandItem
                    key={h.url}
                    value={h.url}
                    label={h.title}
                    keywords={h.keywords}
                    className={styles.item}
                  >
                    <span className={styles.itemTitle}>{h.title}</span>
                    {h.description && <span className={styles.itemDesc}>{h.description}</span>}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
