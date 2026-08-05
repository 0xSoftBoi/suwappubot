/**
 * PostHog acquisition + product-arrival instrumentation.
 *
 * The project token is intentionally public in a browser SDK. PostHog's
 * cross-subdomain cookie keeps www.suwappu.bot -> terminal.suwappu.bot as one
 * anonymous journey; explicit content/creative IDs ride along as super props.
 */
const PROJECT_TOKEN = import.meta.env.VITE_POSTHOG_KEY || "phc_mG2CgVbedj3MpkchVPdmWWPEdReKwcPDTmwXE6efXGYU"

const POSTHOG_SNIPPET = "!function(t,e){var o,n,p,r;e.__SV||(window.posthog&&window.posthog.__loaded)||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(\".\");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement(\"script\")).type=\"text/javascript\",p.crossOrigin=\"anonymous\",p.async=!0,p.src=s.api_host.replace(\".i.posthog.com\",\"-assets.i.posthog.com\")+\"/static/array.js\",(r=t.getElementsByTagName(\"script\")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a=\"posthog\",u.people=u.people||[],u.toString=function(t){var e=\"posthog\";return\"posthog\"!==a&&(e+=\".\"+a),t||(e+=\" (stub)\"),e},u.people.toString=function(){return u.toString(1)+\".people (stub)\"},o=\"init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagResult isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey getNextSurveyStep identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug\".split(\" \"),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);\nposthog.init(\"phc_mG2CgVbedj3MpkchVPdmWWPEdReKwcPDTmwXE6efXGYU\",{api_host:\"https://us.i.posthog.com\",defaults:\"2026-05-30\",cross_subdomain_cookie:true,cookie_persisted_properties:[\"content_id\",\"creative_variant_id\"]});\n(function(){var q=new URLSearchParams(window.location.search),p={};[\"content_id\",\"creative_variant_id\"].forEach(function(k){var v=q.get(k);if(v)p[k]=v});if(Object.keys(p).length)posthog.register(p)})();\nposthog.capture(\"terminal_arrived\",{surface:\"terminal\"});"

export function initPostHog() {
  if (typeof document === 'undefined') return
  if (document.querySelector('script[data-suwappu-posthog]')) return

  const script = document.createElement('script')
  script.dataset.suwappuPosthog = 'true'
  // Replace the verified fallback token if the deploy supplies an override.
  script.textContent = POSTHOG_SNIPPET.replace("phc_mG2CgVbedj3MpkchVPdmWWPEdReKwcPDTmwXE6efXGYU", PROJECT_TOKEN)
  document.head.appendChild(script)
}
