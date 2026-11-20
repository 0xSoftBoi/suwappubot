# Admin dashboard: growth tracking and staff sign-in

`https://suwappu.bot/admin` — one place to see whether the site is working:
visitors, where they came from, form sign-ups, sales leads, new accounts and
paying customers ("Growth"), plus the existing product, finance, agents, swaps
and webhooks sections.

## Turning it on (one-time, in Railway)

| Service | Variable | Value | Why |
|---|---|---|---|
| api-ts | `ADMIN_EMAILS` | `you@company.com, cofounder@company.com` | Who may open `/admin` with Google. Unset = key-only. |
| api-ts | `ADMIN_SESSION_ORIGINS` | optional; defaults to `https://suwappu.bot,https://www.suwappu.bot` | Which site's pages may use the Google session against `/admin/*`. Only change it if `/admin` is served from another origin. |
| python-api | `OAUTH_REDIRECT_BASE` | must include `https://suwappu.bot` (not only `https://suwappu.bot/dashboard`) | Google sign-in must be allowed to return to `/admin`. If it is too narrow, "Continue with Google" on `/admin` is rejected before reaching Google. |

Deploy order matters once: **python-api first** (it creates the `web_events`
table at boot), then **api-ts**, then **showcase**. Until python-api has booted
on this code the dashboard still loads; it shows "Visitor tracking is not
switched on yet" and visitor counts stay at zero.

## Signing in

1. Open `/admin`, press **Continue with Google**, pick the account whose
   address is in `ADMIN_EMAILS`.
2. If the account is not on the list you are told so in plain words; nothing
   else is shown.
3. "Use an admin key instead" still works with `ADMIN_API_KEY`.

A Google session is **read-only**: it can open every `GET /admin/*` report,
and only from pages on the admin site's own origin. Anything that changes data
still needs the key.

## What is measured, and where it comes from

| Number | Source |
|---|---|
| Visitors, page views, top pages, traffic sources, button clicks | `web_events` — first-party, written by the site via `POST /v1/web/event` |
| Sales leads, newsletter, mobile waitlist | `support_tickets` (`kind` = `enterprise_lead` / `newsletter` / `mobile_waitlist`) |
| Name reservations | `waitlist_signups` |
| New accounts | `users` |
| Paying customers | `subscriptions` (paid tier, not expired) |
| Money in | `fee_transactions` (collected), `x402_payments` (completed), `agent_credit_topups`, `agent_subscriptions` — the same four sources and definitions as `GET /admin/finance` |
| Plan income estimate | active paid plans × list price (`TIER_PRICES_USD`) |

Leads, sign-ups and customers are database facts and are complete from day
one. Visitor numbers only exist from the first deploy of this feature — there
is no history to backfill.

## Reading the money numbers

"Money in" is cash received in the period. It is not accounting revenue.

- **Card payments** are read live from Stripe's balance transactions
  (`STRIPE_SECRET_KEY` on api-ts, already used for checkout): payments
  received, minus refunds and disputes. The "Card payments (from Stripe)"
  panel also shows Stripe's fees and what is left. Cached for 5 minutes.
  Payouts to the bank are ignored (they move money, they are not income).
  Non-USD transactions are skipped and counted.
- **On-chain money** comes from this database: collected swap fees, completed
  pay-per-call payments, API credit top-ups and agent plans. These never touch
  Stripe, so nothing is counted twice.
- Prepaid credits count when bought, not when used. Pending pay-per-call
  payments and uncollected swap fees are excluded.
- If Stripe cannot be read, the dashboard says card payments are missing and
  shows an estimate (active plans × list price) instead of a wrong total.

## Privacy

`web_events` stores the event name, page path (query string removed), the
referring site's host, UTM tags and a random per-tab id. It stores **no** IP
address, user agent, cookie or account id, and nothing is sent for browsers
with Do Not Track or Global Privacy Control. `/admin` and `/dashboard` are not
counted. PostHog (already live) is unchanged and independent.

## Adding a new funnel event

Call `track('some_event_name', { optional: 'props' })` from
`showcase/src/lib/analytics.ts`. It appears under "What visitors did"
automatically. To count it as buying intent or a conversion, add the name to
`INTENT_EVENTS` / `CONVERSION_EVENTS` in `api-ts/src/routes/adminGrowth.ts`,
and give it a friendly label in `EVENT_LABELS` in
`showcase/src/app/admin/GrowthSection.tsx`.

## Verified / not verified

Verified locally against a real Postgres and a running api-ts + production
build of the site: event ingest and validation, the report numbers against
seeded data, 15 admin-auth cases (allowed, wrong email, non-Google provider,
unverified email, legacy no-`src` token, wrong secret, `alg: none`, expired,
scoped token, non-integer user id, write attempt), browser tracking end to
end, Do Not Track, and the dashboard at 1440 and 390.

Not verified: the real Google round trip, production CORS/cookie domains, and
the Python `create_all` of `web_events` (the test tables were hand-created to
match the models). Check those on the first deploy.

## Security review (2026-11-20)

An independent pass found no bypass of the sign-in rules. Fixed from it: lead
`context_json` is parsed per row in TypeScript instead of cast to `jsonb` in
SQL (a crafted public form submission could otherwise fail the whole report);
the session path is bound to the admin site's origin; the tracking endpoint
requires a small, declared `Content-Length`; the lead `mailto:` link is
encoded; Google `verified_email` now fails closed. Accepted, not fixed: a
distributed sender can inflate visitor counts (no identity is collected, by
design), and the public lead form still accepts odd-looking email addresses.

## Customer dashboard (`/dashboard`)

The page customers sign in to. 2026-11-20 pass: a plain-language status line
first ("Everything is running normally. Your apps made N requests…"), one top
bar that wraps on phones (the old bar hid Sign out off-screen), tables that
scroll inside their card instead of being clipped (Remove / Revoke were
unreachable on phones), a usage chart that fills its card, plain labels in
place of API jargon, and plan buttons that say whether a change is an upgrade
or a step down. Checked with the API mocked, in three states (organisation,
no organisation, signed out) at 1440 and 390 — not against live customer data.
