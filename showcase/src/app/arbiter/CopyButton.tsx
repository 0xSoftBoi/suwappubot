'use client';

import { useState } from 'react';
import styles from './arbiter.module.css';

/** Copy-to-clipboard pill. `label` is the accessible name ("Copy evidence hash"). */
export default function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // value stays visible/selectable
    }
  };

  return (
    <button type="button" className={styles.copyBtn} onClick={copy} aria-label={label}>
      <span aria-hidden="true">{copied ? 'Copied' : 'Copy'}</span>
      <span className={styles.srOnly} role="status">{copied ? 'Copied to clipboard' : ''}</span>
    </button>
  );
}
