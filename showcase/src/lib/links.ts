/**
 * Centralized external links / CTAs for the Suwappu showcase.
 * Keep these in ONE place so a number/handle change is a one-line edit.
 */

export const TELEGRAM_URL = 'https://t.me/suwappu_bot';

// Enterprise / "Talk to the team" lead-capture page (native form on the site).
// Submissions POST to the API and fan out to the team instantly (Telegram +
// Linear) via the support_notifier — speed-to-lead is the #1 conversion lever.
export const ENTERPRISE_CONTACT_PATH = '/contact';

// Base URL for the public API the contact form submits to.
export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || 'https://api.suwappu.bot';

// WhatsApp CTA stays hidden until a real, bot-connected business number exists.
// To go live: set WHATSAPP_URL to the real wa.me/<number> and flip WHATSAPP_ENABLED to true.
export const WHATSAPP_ENABLED = false;
export const WHATSAPP_URL = 'https://wa.me/15405892803'; // placeholder — not a connected bot number yet
