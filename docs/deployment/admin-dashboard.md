# Admin dashboard: growth tracking and staff sign-in

`https://suwappu.bot/admin` — one place to see whether the site is working:
visitors, where they came from, form sign-ups, sales leads, new accounts and
paying customers ("Growth"), plus the existing product, finance, agents, swaps
and webhooks sections.

## Turning it on (one-time, in Railway)

| Service | Variable | Value | Why |
|---|---|---|---|
| api-ts | `ADMIN_EMAILS` | `you@company.com, cofounder@company.com` | Who may open `/admin` with Google. Unset = key-only. |
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

A Google session is **read-only**: it can open every `GET /admin/*` report.
Anything that changes data still needs the key.

## What is measured, and where it comes from

| Number | Source |
|---|---|
| Visitors, page views, top pages, traffic sources, button clicks | `web_events` — first-party, written by the site via `POST /v1/web/event` |
| Sales leads, newsletter, mobile waitlist | `support_tickets` (`kind` = `enterprise_lead` / `newsletter` / `mobile_waitlist`) |
| Name reservations | `waitlist_signups` |
| New accounts | `users` |
| Paying customers | `subscriptions` (paid tier, not expired) |

Leads, sign-ups and customers are database facts and are complete from day
one. Visitor numbers only exist from the first deploy of this feature — there
is no history to backfill.

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
