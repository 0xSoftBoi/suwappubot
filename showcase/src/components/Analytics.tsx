'use client';

import { useEffect } from 'react';

/**
 * Analytics + ad-pixel loader.
 * Set NEXT_PUBLIC_ANALYTICS_ID in your environment to enable analytics.
 *
 * Supports:
 * - Google Analytics (IDs starting with "G-")
 * - Plausible Analytics (domain name, e.g. "suwappu.bot")
 *
 * Ad pixels are separately env-gated and OFF by default:
 * - X (Twitter) pixel: NEXT_PUBLIC_X_PIXEL_ID
 * - Reddit pixel: NEXT_PUBLIC_REDDIT_PIXEL_ID
 *
 * When their env vars are unset (current state), nothing renders/loads -
 * this component is a pure no-op. `track()` in @/lib/analytics forwards
 * conversion events to whichever pixels are active via window.uwt / rdt.
 */
export default function Analytics() {
  const analyticsId = process.env.NEXT_PUBLIC_ANALYTICS_ID;
  const xPixelId = process.env.NEXT_PUBLIC_X_PIXEL_ID;
  const redditPixelId = process.env.NEXT_PUBLIC_REDDIT_PIXEL_ID;

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

  useEffect(() => {
    if (!xPixelId) return;
    // X (Twitter) universal website tag: https://business.x.com/en/help/campaign-measurement-and-analytics/conversion-tracking
    const script = document.createElement('script');
    script.textContent = `
      !function(e,t,n,s,u,a){e.twq||(s=e.twq=function(){s.exe?s.exe.apply(s,arguments):s.queue.push(arguments);
      },s.version='1.1',s.queue=[],u=t.createElement(n),u.async=!0,u.src='https://static.ads-twitter.com/uwt.js',
      a=t.getElementsByTagName(n)[0],a.parentNode.insertBefore(u,a))}(window,document,'script');
      twq('config','${xPixelId}');
    `;
    document.head.appendChild(script);
  }, [xPixelId]);

  useEffect(() => {
    if (!redditPixelId) return;
    // Reddit pixel: https://business.reddithelp.com/helpcenter/s/article/about-the-reddit-pixel
    const script = document.createElement('script');
    script.textContent = `
      !function(w,d){if(!w.rdt){var p=w.rdt=function(){p.sendEvent?p.sendEvent.apply(p,arguments):p.callQueue.push(arguments)};
      p.callQueue=[];var t=d.createElement('script');t.src='https://www.redditstatic.com/ads/pixel.js';t.async=!0;
      var s=d.getElementsByTagName('script')[0];s.parentNode.insertBefore(t,s)}}(window,document);
      rdt('init','${redditPixelId}');
      rdt('track','PageVisit');
    `;
    document.head.appendChild(script);
  }, [redditPixelId]);

  return null;
}
