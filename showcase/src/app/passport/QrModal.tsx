'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import QRCode from 'qrcode';
import { simulatorUrl } from './api';
import styles from './passport.module.css';

/**
 * Elegant sheet for the World ID scan step. Polling itself lives in
 * usePassportFlow — this component only renders while `open` is true and
 * calls `onClose` (which cancels polling) on dismiss. The parent closes it
 * automatically once verification succeeds.
 */
export default function QrModal({
  open,
  connectorURI,
  onClose,
  simulatorUrl: simulatorUrlOverride,
}: {
  open: boolean;
  connectorURI: string | null;
  onClose: () => void;
  simulatorUrl?: string;
}) {
  const reduceMotion = useReducedMotion();
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!connectorURI) {
      setDataUrl(null);
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(connectorURI, {
      width: 240,
      margin: 1,
      color: { dark: '#0D0F12', light: '#F4F4F6' },
    })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [connectorURI]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const copyLink = async () => {
    if (!connectorURI) return;
    try {
      await navigator.clipboard.writeText(connectorURI);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // clipboard API unavailable — link stays visible/selectable via the anchor.
    }
  };

  // The simulator ignores ?uri=, so the only path that works is its "Paste
  // code" sheet: copy the link first, then let the anchor open the simulator.
  const [simHint, setSimHint] = useState(false);
  const openSimulator = () => {
    void copyLink();
    setSimHint(true);
  };

  return (
    <AnimatePresence>
      {open && connectorURI && (
        <motion.div
          className={styles.modalBackdrop}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          onClick={onClose}
        >
          <motion.div
            className={styles.modalSheet}
            role="dialog"
            aria-modal="true"
            aria-label="Scan with World App"
            onClick={(e) => e.stopPropagation()}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          >
            <button type="button" className={styles.modalClose} onClick={onClose} aria-label="Close">
              ×
            </button>
            <p className={styles.modalKicker}>Scan with World App</p>
            <div className={styles.qrImageWrap}>
              {dataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={dataUrl} alt="Verification QR code" width={220} height={220} />
              ) : (
                <div className={styles.qrPlaceholder} aria-hidden="true" />
              )}
            </div>
            <p className={styles.modalHint} aria-live="polite">
              {simHint
                ? 'Link copied — tap “Paste code” in the simulator.'
                : 'Waiting for confirmation on your phone…'}
            </p>
            <div className={styles.modalActions}>
              <a
                className={styles.modalSimLink}
                href={simulatorUrlOverride || simulatorUrl(connectorURI)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={openSimulator}
              >
                Use the simulator instead
              </a>
              <button type="button" className={styles.qrCopyBtn} onClick={copyLink}>
                {copied ? 'Copied' : 'Copy link'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
