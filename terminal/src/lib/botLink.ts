/**
 * Single source for the Telegram bot link in terminal. Default mirrors bot/config/settings.py
 * `telegram_bot_username` ("suwappubot"); set VITE_TELEGRAM_BOT_USERNAME at build time to override.
 */
export const TELEGRAM_BOT_USERNAME = import.meta.env.VITE_TELEGRAM_BOT_USERNAME || 'suwappubot'
export const TELEGRAM_BOT_URL = `https://t.me/${TELEGRAM_BOT_USERNAME}`
