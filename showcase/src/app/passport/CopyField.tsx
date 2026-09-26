'use client';

import { useState } from 'react';
import styles from './passport.module.css';

/** Truncated hash/id with a copy-to-clipboard button — used for the nullifier and tx hashes. */
export default function CopyField({
  value,
  display,
  href,
}: {
  value: string;
  display?: string;
  href?: string;
}) {
  const [copied, setCopied] = useState(false);
  const shown = display || (value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // ignore — value is still visible/selectable
    }
  };

  return (
    <span className={styles.copyField}>
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" className={styles.copyFieldLink}>
          {shown}
        </a>
      ) : (
        <code className={styles.copyFieldCode}>{shown}</code>
      )}
      <button type="button" className={styles.copyFieldBtn} onClick={copy} aria-label="Copy">
        {copied ? '✓' : '⧉'}
      </button>
    </span>
  );
}
