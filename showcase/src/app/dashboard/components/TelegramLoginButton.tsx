'use client';

/**
 * Telegram Login Widget — browser sign-in for the dashboard.
 *
 * Replaces "open the bot, copy a token, paste it into a password field",
 * which is not something an enterprise buyer gets past and which trains
 * people to handle bearer tokens by hand.
 *
 * Telegram injects its own <script> that renders an iframe button and calls a
 * GLOBAL callback with the signed payload, so this component has to bridge
 * that global back into React. The payload is verified server-side by
 * POST /auth/telegram/widget — note the widget uses SHA256(bot_token) as its
 * secret, NOT the Mini App's HMAC("WebAppData", bot_token); the two are not
 * interchangeable.
 *
 * REQUIRES: the serving domain must be registered with @BotFather via
 * /setdomain, or Telegram silently refuses to render the button. `onUnavailable`
 * fires if the widget has not drawn itself, so the UI can fall back rather
 * than showing an empty space.
 */

import { useEffect, useRef, useState } from 'react';
import { AUTH_BASE_URL, TELEGRAM_BOT_USERNAME } from '@/lib/links';

export interface TelegramWidgetUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

interface Props {
  onToken: (token: string) => void;
  onError: (message: string) => void;
}

declare global {
  interface Window {
    __suwappuTelegramAuth?: (user: TelegramWidgetUser) => void;
  }
}

export default function TelegramLoginButton({ onToken, onError }: Props) {
  const holder = useRef<HTMLDivElement | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const node = holder.current;
    if (!node) return;

    window.__suwappuTelegramAuth = async (user: TelegramWidgetUser) => {
      try {
        const res = await fetch(`${AUTH_BASE_URL}/auth/telegram/widget`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(user),
        });
        if (!res.ok) {
          onError(
            res.status === 401
              ? 'Telegram could not verify that login. Please try again.'
              : 'Sign-in is unavailable right now. Please try again shortly.',
          );
          return;
        }
        const body = await res.json();
        if (!body?.token) {
          onError('Sign-in did not return a session. Please try again.');
          return;
        }
        onToken(body.token);
      } catch {
        onError('Could not reach the sign-in service. Check your connection.');
      }
    };

    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.async = true;
    script.setAttribute('data-telegram-login', TELEGRAM_BOT_USERNAME);
    script.setAttribute('data-size', 'large');
    script.setAttribute('data-radius', '8');
    script.setAttribute('data-userpic', 'false');
    script.setAttribute('data-request-access', 'write');
    script.setAttribute('data-onauth', 'window.__suwappuTelegramAuth(user)');
    node.appendChild(script);

    // The widget draws an <iframe>. If none appears the domain is almost
    // certainly not registered with @BotFather — surface that instead of
    // leaving a blank gap where a button should be.
    const check = setTimeout(() => {
      if (!node.querySelector('iframe')) setUnavailable(true);
    }, 4000);

    return () => {
      clearTimeout(check);
      delete window.__suwappuTelegramAuth;
      node.replaceChildren();
    };
  }, [onToken, onError]);

  return (
    <div>
      <div ref={holder} />
      {unavailable && (
        <p role="status" style={{ fontSize: '0.8rem', opacity: 0.75, marginTop: 8 }}>
          Telegram sign-in isn’t available on this domain yet — use an access
          token below.
        </p>
      )}
    </div>
  );
}
