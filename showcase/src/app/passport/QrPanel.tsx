'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { simulatorUrl } from './api';
import styles from './passport.module.css';

export default function QrPanel({ connectorURI }: { connectorURI: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(connectorURI, {
      width: 220,
      margin: 1,
      color: { dark: '#17102b', light: '#f4f1ff' },
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

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(connectorURI);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // clipboard API unavailable — the visible link is still selectable.
    }
  };

  return (
    <div className={styles.qrPanel}>
      <div className={styles.qrImageWrap}>
        {dataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={dataUrl} alt="World ID verification QR code" width={220} height={220} />
        ) : (
          <div className={styles.qrPlaceholder} aria-hidden="true" />
        )}
      </div>
      <p className={styles.qrHint}>Scan with World App, or open the simulator on a laptop.</p>
      <div className={styles.qrActions}>
        <a
          className={styles.qrOpenLink}
          href={simulatorUrl(connectorURI)}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open in simulator ↗
        </a>
        <button type="button" className={styles.qrCopyBtn} onClick={copyLink}>
          {copied ? 'Copied' : 'Copy link'}
        </button>
      </div>
    </div>
  );
}
