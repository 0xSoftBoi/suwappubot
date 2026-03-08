'use client';

import { useEffect } from 'react';

/**
 * Analytics placeholder component.
 * Set NEXT_PUBLIC_ANALYTICS_ID in your environment to enable.
 *
 * Supports:
 * - Google Analytics (IDs starting with "G-")
 * - Plausible Analytics (domain name, e.g. "suwappu.bot")
 */
export default function Analytics() {
  const analyticsId = process.env.NEXT_PUBLIC_ANALYTICS_ID;

  useEffect(() => {
    if (!analyticsId) return;

    if (analyticsId.startsWith('G-')) {
      // Google Analytics
      const script = document.createElement('script');
      script.src = `https://www.googletagmanager.com/gtag/js?id=${analyticsId}`;
      script.async = true;
      document.head.appendChild(script);

      const inlineScript = document.createElement('script');
      inlineScript.textContent = `
        window.dataLayer = window.dataLayer || [];
        function gtag(){dataLayer.push(arguments);}
        gtag('js', new Date());
        gtag('config', '${analyticsId}');
      `;
      document.head.appendChild(inlineScript);
    } else {
      // Plausible Analytics
      const script = document.createElement('script');
      script.src = 'https://plausible.io/js/script.js';
      script.defer = true;
      script.setAttribute('data-domain', analyticsId);
      document.head.appendChild(script);
    }
  }, [analyticsId]);

  return null;
}
