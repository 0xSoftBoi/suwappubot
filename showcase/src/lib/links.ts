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
// Linear) via the support_notifier — speed-to-lead is the #1 conversion lever.
export const ENTERPRISE_CONTACT_PATH = '/contact';

// Enterprise "Schedule a demo" call — Saphira-style gate: deep/institutional
// features are marketing copy + a call CTA, not self-serve. 30-min Calendly.
export const DEMO_CALL_URL = 'https://calendly.com/tsoma4770/suwappu-demo';

// Base URL for the public API the contact form submits to.
export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || 'https://api.suwappu.bot';

// Base URL for the api-ts service (billing checkout, agent/A2A routes).
// Distinct from API_BASE_URL, which is the legacy Python monolith.
export const API_TS_BASE_URL =
  process.env.NEXT_PUBLIC_API_TS_URL || 'https://api-ts-production.up.railway.app';

// Web checkout CTA — public, unauthenticated Stripe checkout session for a
// showcase visitor with no Suwappu account yet (see api-ts billing.ts
// GET /billing/stripe/checkout-web, mounted at app.route('/billing', ...)).
// Stripe collects the email.
export function upgradeCheckoutUrl(tier: 'pro' | 'premium'): string {
  return `${API_TS_BASE_URL}/billing/stripe/checkout-web?tier=${tier}`;
}

// WhatsApp CTA stays hidden until a real, bot-connected business number exists.
// To go live: set WHATSAPP_URL to the real wa.me/<number> and flip WHATSAPP_ENABLED to true.
export const WHATSAPP_ENABLED = false;
export const WHATSAPP_URL = 'https://wa.me/15405892803'; // placeholder — not a connected bot number yet
