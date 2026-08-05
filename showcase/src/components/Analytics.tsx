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

  // The PostHog project token is a public browser identifier, not a private API key.
  // Keeping the verified project token here makes analytics live on deploy; an env
  // override can rotate it without a source change.
  const posthogProjectToken = process.env.NEXT_PUBLIC_POSTHOG_KEY || "phc_mG2CgVbedj3MpkchVPdmWWPEdReKwcPDTmwXE6efXGYU";

  useEffect(() => {
    if (!posthogProjectToken) return;

    const inlineScript = document.createElement('script');
    inlineScript.dataset.suwappuPosthog = 'true';
    inlineScript.textContent = "!function(t,e){var o,n,p,r;e.__SV||(window.posthog&&window.posthog.__loaded)||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(\".\");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement(\"script\")).type=\"text/javascript\",p.crossOrigin=\"anonymous\",p.async=!0,p.src=s.api_host.replace(\".i.posthog.com\",\"-assets.i.posthog.com\")+\"/static/array.js\",(r=t.getElementsByTagName(\"script\")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a=\"posthog\",u.people=u.people||[],u.toString=function(t){var e=\"posthog\";return\"posthog\"!==a&&(e+=\".\"+a),t||(e+=\" (stub)\"),e},u.people.toString=function(){return u.toString(1)+\".people (stub)\"},o=\"init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagResult isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey getNextSurveyStep identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug\".split(\" \"),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);\nposthog.init(\"phc_mG2CgVbedj3MpkchVPdmWWPEdReKwcPDTmwXE6efXGYU\",{api_host:\"https://us.i.posthog.com\",defaults:\"2026-05-30\",cross_subdomain_cookie:true,cookie_persisted_properties:[\"content_id\",\"creative_variant_id\"]});\n(function(){var q=new URLSearchParams(window.location.search),p={};[\"content_id\",\"creative_variant_id\"].forEach(function(k){var v=q.get(k);if(v)p[k]=v});if(Object.keys(p).length)posthog.register(p)})();".replace("phc_mG2CgVbedj3MpkchVPdmWWPEdReKwcPDTmwXE6efXGYU", posthogProjectToken);
    document.head.appendChild(inlineScript);

    return () => inlineScript.remove();
  }, [posthogProjectToken]);

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
