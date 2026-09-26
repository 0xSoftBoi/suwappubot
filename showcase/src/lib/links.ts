/**
 * Centralized external links / CTAs for the Suwappu showcase.
 * Keep these in ONE place so a number/handle change is a one-line edit.
 */

export const TELEGRAM_URL = 'https://t.me/suwappu_bot';

// The two hosted product surfaces. Both are live and served through the
// Cloudflare worker router.
export const TERMINAL_URL = 'https://terminal.suwappu.bot';
export const MINI_APP_URL = 'https://app.suwappu.bot';

// Public docs live on the showcase itself under /docs.
export const GITHUB_URL = 'https://github.com/0xSoftBoi/suwappubot';

// Enterprise / "Talk to the team" lead-capture page (native form on the site).
// Submissions POST to the API and fan out to the team instantly (Telegram +
// Linear) via the support_notifier: speed-to-lead is the #1 conversion lever.
export const ENTERPRISE_CONTACT_PATH = '/contact';

// Enterprise "Schedule a demo" call: Saphira-style gate: deep/institutional
// features are marketing copy + a call CTA, not self-serve. 30-min Calendly.
export const DEMO_CALL_URL = 'https://calendly.com/tsoma4770/suwappu-demo';

// Base URL for the public API the contact form submits to.
export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || 'https://api.suwappu.bot';

// Origin for auth flows.
//
// MUST be terminal.suwappu.bot — the SAME origin Google redirects back to.
// The OAuth state nonce cookie is host-only (Path=/auth/oauth, no Domain):
// it is set by /auth/oauth/google/authorize on whichever host STARTS the
// flow, and the callback rejects the login unless that cookie is presented.
// Google's registered redirect_uri is terminal.suwappu.bot/auth/callback/google,
// and terminal is built with a RELATIVE API base (terminal/.env.production
// forbids VITE_API_URL), so the code+state are forwarded to
// terminal.suwappu.bot/auth/oauth/google/callback via terminal's nginx.
//
// The previous value, api.suwappu.bot, set the nonce on api.* while the
// callback ran on terminal.* — cookie_present=False, reason=nonce_missing in
// python-api logs — so EVERY dashboard Google sign-in failed and the failure
// redirect stranded the user on the terminal home page. Verified live
// 2026-08-31: authorize+callback on terminal.* passes the nonce check;
// authorize on api.* + callback on terminal.* reproduces nonce_missing.
// The session cookie that the callback then mints IS domain-scoped
// (SESSION_COOKIE_DOMAIN), so the dashboard on suwappu.bot sees it.
export const AUTH_BASE_URL =
  process.env.NEXT_PUBLIC_AUTH_URL || 'https://terminal.suwappu.bot';

/** @deprecated Use AUTH_BASE_URL — see the origin note above. */
export const PYTHON_API_BASE_URL = AUTH_BASE_URL;

// Telegram bot username, used by the Login Widget on the dashboard sign-in.
// NOTE: the widget only renders on a domain registered with @BotFather via
// /setdomain. Without that step Telegram silently refuses to draw the button.
export const TELEGRAM_BOT_USERNAME =
  process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || 'suwappu_bot';

// Base URL for the api-ts service (billing checkout, agent/A2A routes).
// Distinct from API_BASE_URL, which is the legacy Python monolith.
export const API_TS_BASE_URL =
  process.env.NEXT_PUBLIC_API_TS_URL || 'https://api-ts-production.up.railway.app';

// Web checkout CTA: public, unauthenticated Stripe checkout session for a
// showcase visitor with no Suwappu account yet (see api-ts billing.ts
// GET /billing/stripe/checkout-web, mounted at app.route('/billing', ...)).
// Stripe collects the email.
export function upgradeCheckoutUrl(tier: 'pro' | 'premium'): string {
  return `${API_TS_BASE_URL}/billing/stripe/checkout-web?tier=${tier}`;
}

// WhatsApp CTA stays hidden until a real, bot-connected business number exists.
// To go live: set WHATSAPP_URL to the real wa.me/<number> and flip WHATSAPP_ENABLED to true.
export const WHATSAPP_ENABLED = false;
export const WHATSAPP_URL = 'https://wa.me/15405892803'; // placeholder: not a connected bot number yet
