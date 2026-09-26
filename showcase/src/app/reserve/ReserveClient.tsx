'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { track } from '@/lib/analytics';
import { getAttribution } from '@/lib/attribution';
import { TELEGRAM_URL } from '@/lib/links';
import {
  checkAvailability,
  fetchLeaderboard,
  fetchStatus,
  isPlausibleHandle,
  reserveHandle,
  type LeaderboardEntry,
  type ReserveError,
  type ReserveSuccess,
} from '@/lib/waitlist';
import ReserveCard from '@/components/ReserveCard';
import styles from './reserve.module.css';

type Availability = 'idle' | 'checking' | 'available' | 'taken' | 'invalid' | 'error';

interface Reserved {
  handle: string;
  position: number;
  referral_code: string;
  referral_url: string;
  referral_count: number;
  total_signups: number;
  referrals_to_next_rank: number | null;
  seed: number;
}

const STORAGE_KEY = 'suwappu_waitlist_code';
const POLL_MS = 25000;

/** Cheap deterministic string hash, used ONLY for the live idle-preview card
 * before a real API seed exists. The real card (post-reservation) always
 * uses the server's `seed`, which is what has to be stable — this is just
 * so the preview isn't a static blank card while typing. */
function localPreviewSeed(handle: string): number {
  let h = 2166136261;
  for (let i = 0; i < handle.length; i++) {
    h ^= handle.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % 2147483647;
}

/** Eases a displayed number toward `value` over ~600ms; snaps instantly under reduced motion. */
function useAnimatedNumber(value: number | null): number | null {
  const [display, setDisplay] = useState<number | null>(value);
  const prevRef = useRef<number | null>(value);
  const rafRef = useRef(0);

  useEffect(() => {
    if (value === null) {
      setDisplay(null);
      return;
    }
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const from = prevRef.current ?? value;
    if (reduce || from === value) {
      setDisplay(value);
      prevRef.current = value;
      return;
    }
    const start = performance.now();
    const duration = 600;
    cancelAnimationFrame(rafRef.current);
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(from + (value - from) * eased));
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        prevRef.current = value;
      }
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value]);

  return display;
}

function shareXUrl(handle: string, url: string): string {
  const text = `I just reserved @${handle} on Suwappu. Claim your name before it's gone:`;
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
}

function shareTelegramUrl(handle: string, url: string): string {
  const text = `I just reserved @${handle} on Suwappu. Claim your name before it's gone.`;
  return `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
}

export default function ReserveClient() {
  const [view, setView] = useState<'idle' | 'reserved'>('idle');
  const [handleInput, setHandleInput] = useState('');
  const [availability, setAvailability] = useState<Availability>('idle');
  const [refCode, setRefCode] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const [formMessage, setFormMessage] = useState<string | null>(null);
  const [reserved, setReserved] = useState<Reserved | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [copied, setCopied] = useState(false);

  const statusAbortRef = useRef<AbortController | null>(null);

  const animatedPosition = useAnimatedNumber(reserved?.position ?? null);
  const animatedReferrals = useAnimatedNumber(reserved?.referral_count ?? null);

  const refreshStatusAndLeaderboard = useCallback(async (code: string) => {
    statusAbortRef.current?.abort();
    const controller = new AbortController();
    statusAbortRef.current = controller;
    try {
      const [statusRes, board] = await Promise.all([
        fetchStatus(code, controller.signal),
        fetchLeaderboard(10, controller.signal),
      ]);
      if (statusRes.ok) {
        setReserved((prev) =>
          prev
            ? {
                ...prev,
                handle: statusRes.handle,
                position: statusRes.position,
                referral_count: statusRes.referral_count,
                total_signups: statusRes.total_signups,
                referrals_to_next_rank: statusRes.referrals_to_next_rank,
                seed: statusRes.seed,
              }
            : prev,
        );
      }
      if (board.ok) setLeaderboard(board.entries);
    } catch {
      // AbortError from overlapping polls, or a transient network error —
      // either way, keep showing the last known-good numbers.
    }
  }, []);

  const enterReserved = useCallback(
    async (success: ReserveSuccess) => {
      try {
        window.localStorage.setItem(STORAGE_KEY, success.referral_code);
      } catch {
        /* private browsing / disabled storage */
      }
      const url = new URL(window.location.href);
      url.searchParams.set('code', success.referral_code);
      url.searchParams.delete('ref');
      window.history.pushState({}, '', url.toString());

      setReserved({
        handle: success.handle,
        position: success.position,
        referral_code: success.referral_code,
        referral_url: success.referral_url,
        referral_count: success.referral_count,
        total_signups: success.total_signups,
        referrals_to_next_rank: success.position === 1 ? 0 : null,
        seed: success.seed,
      });
      setView('reserved');
      setSubmitting(false);
      // Reserve response doesn't carry referrals_to_next_rank — fill it (and
      // the leaderboard) with one immediate status round-trip.
      refreshStatusAndLeaderboard(success.referral_code);
    },
    [refreshStatusAndLeaderboard],
  );

  // Mount: capture ?ref=, and resume a prior session from ?code= (or the
  // localStorage fallback) so a reload lands back on the status view.
  useEffect(() => {
    track('waitlist_reserve_view');
    const params = new URLSearchParams(window.location.search);
    const ref = params.get('ref');
    if (ref) setRefCode(ref);

    const codeParam = params.get('code');
    let storedCode: string | null = null;
    try {
      storedCode = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    const code = codeParam || storedCode;
    if (!code) return;

    (async () => {
      const res = await fetchStatus(code);
      if (!res.ok) {
        // Stale/unknown code: don't get stuck showing a dead status view.
        try {
          window.localStorage.removeItem(STORAGE_KEY);
        } catch {
          /* ignore */
        }
        return;
      }
      setReserved({
        handle: res.handle,
        position: res.position,
        referral_code: code,
        referral_url: `${window.location.origin}/reserve?ref=${code}`,
        referral_count: res.referral_count,
        total_signups: res.total_signups,
        referrals_to_next_rank: res.referrals_to_next_rank,
        seed: res.seed,
      });
      setView('reserved');
      if (!codeParam) {
        const url = new URL(window.location.href);
        url.searchParams.set('code', code);
        window.history.replaceState({}, '', url.toString());
      }
      refreshStatusAndLeaderboard(code);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced availability check, aborted on every keystroke so a stale
  // response can never land after a newer one.
  useEffect(() => {
    const h = handleInput.trim().toLowerCase();
    if (!h) {
      setAvailability('idle');
      return;
    }
    if (!isPlausibleHandle(h)) {
      setAvailability('invalid');
      return;
    }
    setAvailability('checking');
    const controller = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await checkAvailability(h, controller.signal);
        if (!res || !res.ok) {
          setAvailability('error');
          return;
        }
        if (res.available) setAvailability('available');
        else if (res.reason === 'invalid') setAvailability('invalid');
        else setAvailability('taken');
      } catch (err) {
        if ((err as { name?: string })?.name !== 'AbortError') setAvailability('error');
      }
    }, 350);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [handleInput]);

  // Poll for referral movement: interval + refetch on focus, paused while hidden.
  useEffect(() => {
    if (view !== 'reserved' || !reserved) return;
    const code = reserved.referral_code;
    const tick = () => {
      if (document.hidden) return;
      refreshStatusAndLeaderboard(code);
    };
    const interval = setInterval(tick, POLL_MS);
    const onFocus = () => tick();
    const onVisibility = () => {
      if (!document.hidden) tick();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, reserved?.referral_code]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting || availability !== 'available') return;
    setSubmitting(true);
    setFormMessage(null);

    const form = e.currentTarget;
    const data = new FormData(form);
    const handle = handleInput.trim().toLowerCase();
    const payload = {
      handle,
      email: String(data.get('email') || '').trim(),
      telegram: String(data.get('telegram') || '').trim() || undefined,
      ref: refCode,
      website: String(data.get('website') || ''), // honeypot
      attribution: getAttribution() || undefined,
    };

    try {
      const { body } = await reserveHandle(payload);
      if (!body.ok) {
        const err = body as ReserveError;
        let msg = 'Something went wrong. Please try again.';
        if (err.error === 'handle_taken') {
          msg = 'That name was just taken. Try another.';
          setAvailability('taken');
        } else if (err.error === 'invalid_handle') {
          msg = "That name isn't valid. Use 3-32 letters, numbers or dashes.";
        } else if (err.error === 'invalid_email') {
          msg = "That email address doesn't look right.";
        }
        setFormMessage(msg);
        setSubmitting(false);
        track('waitlist_reserve_error', { error: String(err.error) });
        return;
      }
      const success = body as ReserveSuccess;
      const attribution = payload.attribution;
      track('waitlist_reserved', {
        already: success.already,
        position: success.position,
        ...(attribution?.utm_source ? { utm_source: attribution.utm_source } : {}),
        ...(attribution?.utm_campaign ? { utm_campaign: attribution.utm_campaign } : {}),
      });
      await enterReserved(success);
    } catch {
      setFormMessage('Could not reach the server. Please try again or message us on Telegram.');
      setSubmitting(false);
      track('waitlist_reserve_error', { error: 'network' });
    }
  }

  async function handleCopy() {
    if (!reserved) return;
    try {
      await navigator.clipboard.writeText(reserved.referral_url);
      setCopied(true);
      track('waitlist_referral_copied');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard permission denied — button stays present, just no-ops */
    }
  }

  function handleShareClick(platform: 'x' | 'telegram') {
    track('waitlist_share_clicked', { platform });
  }

  function submitLabel() {
    if (submitting) return 'Opening…';
    if (!handleInput.trim()) return 'Choose your name';
    return `Reserve @${handleInput.trim().toLowerCase()}`;
  }

  function handleStatusText() {
    const h = handleInput.trim();
    if (!h) return '';
    switch (availability) {
      case 'checking':
        return 'Checking availability…';
      case 'available':
        return `@${h.toLowerCase()} is available.`;
      case 'taken':
        return 'That name is already taken.';
      case 'invalid':
        return 'Use 3-32 letters, numbers or dashes. No leading or trailing dash.';
      case 'error':
        return "Couldn't check that name. Try again.";
      default:
        return '';
    }
  }

  if (view === 'reserved' && reserved) {
    const nextRankCopy =
      reserved.position === 1
        ? "You're #1. Defend it."
        : reserved.referrals_to_next_rank === null
          ? 'Loading your standing…'
          : reserved.referrals_to_next_rank <= 0
            ? 'Refer one more friend to take the spot above you.'
            : `Refer ${reserved.referrals_to_next_rank} more friend${
                reserved.referrals_to_next_rank === 1 ? '' : 's'
              } to move up a spot.`;

    return (
      <div className={styles.reservedLayout}>
        <ReserveCard handle={reserved.handle} seed={reserved.seed} variant="success" />

        <div className={styles.reservedBody}>
          <p className={styles.kicker}>Reserved</p>
          <h1 className={styles.reservedHeading}>
            @{reserved.handle} is yours.
          </h1>

          <div className={styles.positionBlock}>
            <span className={styles.positionNumber}>
              #{(animatedPosition ?? reserved.position).toLocaleString()}
            </span>
            <span className={styles.positionOf}>
              of {reserved.total_signups.toLocaleString()}
            </span>
          </div>

          <p className={styles.rankCta}>{nextRankCopy}</p>

          <div className={styles.referralPanel}>
            <span className={styles.referralLabel}>Your referral link</span>
            <div className={styles.referralRow}>
              <input
                className={styles.referralInput}
                type="text"
                readOnly
                value={reserved.referral_url}
                onFocus={(e) => e.currentTarget.select()}
                aria-label="Your referral link"
              />
              <button type="button" className={styles.copyButton} onClick={handleCopy}>
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <div className={styles.shareRow}>
              <a
                className={styles.shareButton}
                href={shareXUrl(reserved.handle, reserved.referral_url)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => handleShareClick('x')}
              >
                Share on X
              </a>
              <a
                className={styles.shareButton}
                href={shareTelegramUrl(reserved.handle, reserved.referral_url)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => handleShareClick('telegram')}
              >
                Share on Telegram
              </a>
            </div>
            <p className={styles.referralCount}>
              <strong>{(animatedReferrals ?? reserved.referral_count).toLocaleString()}</strong>{' '}
              {reserved.referral_count === 1 ? 'friend referred' : 'friends referred'}
            </p>
          </div>

          <section className={styles.leaderboard} aria-label="Referral leaderboard">
            <h2 className={styles.leaderboardHeading}>Top referrers</h2>
            {leaderboard.length === 0 ? (
              <p className={styles.leaderboardEmpty}>Loading leaderboard…</p>
            ) : (
              <ol className={styles.leaderboardList}>
                {leaderboard.map((entry) => (
                  <li
                    key={entry.rank}
                    className={`${styles.leaderboardRow} ${
                      entry.handle === reserved.handle ? styles.leaderboardRowSelf : ''
                    }`}
                  >
                    <span className={styles.leaderboardRank}>{entry.rank}</span>
                    <span className={styles.leaderboardHandle}>@{entry.handle}</span>
                    <span className={styles.leaderboardCount}>
                      {entry.referral_count.toLocaleString()}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </div>
    );
  }

  const disabled = submitting || availability !== 'available';

  return (
    <div className={styles.idleLayout}>
      <ReserveCard handle={handleInput} seed={localPreviewSeed(handleInput || 'yourname')} variant="hero" />

      <h1 className={styles.heading}>Reserve your Suwappu name.</h1>
      <p className={styles.lead}>Choose your unique account name and reserve it for launch.</p>

      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        <label htmlFor="reserve-handle" className="sr-only">
          Suwappu name
        </label>
        <div
          className={`${styles.handleField} ${styles[`status-${availability}`] ?? ''}`}
        >
          <span className={styles.at} aria-hidden="true">
            @
          </span>
          <input
            id="reserve-handle"
            className={styles.handleInput}
            name="handle"
            value={handleInput}
            onChange={(e) => setHandleInput(e.target.value)}
            placeholder="yourname"
            minLength={3}
            maxLength={32}
            pattern="[A-Za-z0-9-]+"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            aria-describedby="reserve-handle-status"
            required
          />
          <span className={styles.statusGlyph} aria-hidden="true">
            {availability === 'checking' && <span className={styles.spinner} />}
            {availability === 'available' && '✓'}
            {(availability === 'taken' || availability === 'error') && '×'}
          </span>
        </div>
        <p id="reserve-handle-status" className={styles.handleStatusText} aria-live="polite">
          {handleStatusText()}
        </p>

        <div className={styles.row}>
          <label className={styles.field}>
            <span className={styles.label}>Email *</span>
            <input
              className={styles.input}
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="you@example.com"
            />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Telegram (optional)</span>
            <input
              className={styles.input}
              name="telegram"
              type="text"
              autoComplete="off"
              placeholder="@yourhandle"
            />
          </label>
        </div>

        {/* Honeypot: hidden from humans, catches bots. */}
        <div className={styles.honeypot} aria-hidden="true">
          <label>
            Website
            <input name="website" type="text" tabIndex={-1} autoComplete="off" />
          </label>
        </div>

        <button className="summer-button summer-button--primary" type="submit" disabled={disabled}>
          {submitLabel()} <span aria-hidden="true">↗</span>
        </button>

        <p role="status" aria-live="polite" className={styles.formMessage}>
          {formMessage}
        </p>

        <p className={styles.fineprint}>
          Reserving is free and doesn&rsquo;t require a wallet connection. We&rsquo;ll only email you
          about launch.{' '}
          <a href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer">
            Questions? Message us.
          </a>
        </p>
      </form>
    </div>
  );
}
