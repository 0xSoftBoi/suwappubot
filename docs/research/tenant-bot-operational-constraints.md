# Research round 2 — primary sources, and what they break

**Date:** 2026-08-25 · **Supersedes nothing; complements** `agentic-bot-dashboards-2026.md`

The first round was market research read off search-result summaries. This round
went to primary sources — the Telegram Bot API docs, the Bot API changelog, the
GitHub advisory database — and it found **five defects in code we already
shipped** plus one change that makes a whole feature obsolete.

Findings are ordered by whether they change code.

---

## 1. We shipped CVE-2026-27003's exact pattern — and worse

**GHSA-chf7-jq6g-qrwv / CVE-2026-27003**, CVSS 6.9, CWE-522, filed against
**`openclaw` ≤ 2026.2.14 — a package in this repository**:

> "Telegram bot tokens can appear in error messages and stack traces (for
> example, when request URLs include `https://api.telegram.org/bot<token>/...`).
> OpenClaw previously logged these strings without redaction."

Impact: "Disclosure of a Telegram bot token allows an attacker to impersonate
the bot and take over Bot API access." Remediation: upgrade, **and rotate any
token that may have been exposed**.

We build exactly that URL in three places:

| File | Line | Risk |
|---|---|---|
| `api-ts/src/services/TenantBotService.ts` | ~211 | `fetch()` failure → `e.message` may carry the URL → `ExternalServiceError` |
| `api-ts/src/services/TenantBotExecutorService.ts` | ~140 | announce path, `new Error(String(e))` |
| `bot/services/tenant_bot_runtime.py` | ~205 | `logger.error("send error: %s", e)` — httpx exceptions include the request URL |

**It is worse for us than for OpenClaw.** OpenClaw leaked *its own* token. We
hold *our customers'* tokens, and every one of them controls a bot posting to a
community that trusts it. One unredacted stack trace in a support bundle is a
multi-tenant compromise.

The repo already has `redactSecretsInText()` in `api-ts/src/lib/sentryRedact.ts`
with a Telegram-token pattern — but it runs **only inside Sentry's `beforeSend`**.
Ordinary `logger.error()` never touches it, and Python has no equivalent at all.

Also note its pattern is `\d{8,10}:[A-Za-z0-9_-]{35}` while our own validator
accepts `\d{6,12}:[A-Za-z0-9_-]{30,}` — tokens we accept, that redactor misses.

**→ Fix:** redact at the logging boundary in both stacks, widen the pattern to
match what we accept, and add token rotation as the remediation the advisory
requires.

Source: [GHSA-chf7-jq6g-qrwv](https://github.com/advisories/GHSA-chf7-jq6g-qrwv)

---

## 2. Our 429 handler makes flood-waits worse

Measured limits from the Bot API FAQ:

- **~1 message/second to one chat** (bursts tolerated).
- **20 messages/minute to a group.** ← the one that bites us
- **~30 messages/second** in aggregate, unless `allow_paid_broadcast`
  (Bot API 7.11) which raises it to 1,000/s at 0.1 Stars each.
- Over limit → **429 with `retry_after`**, and since layer 167 (Feb 2025)
  `retry_after` is **per-chat, not per-token** — flooding one group trips
  sooner than spreading the same volume over many private chats.

And the part that matters: **"Telegram does not accept decimal back-off and will
extend the ban if you hammer early."**

`bot/services/tenant_bot_runtime.py::_send` treats *any* `status >= 400` as a
Markdown problem, strips `parse_mode`, and **retries immediately**. On a 429
that is not a failed retry — it is an extra request during a flood-wait, which
per the docs extends the ban. Our error handler actively deepens the outage.

The 20/min group ceiling is a live constraint too: burn receipts post to a
group, and a team setting `*/2 * * * *` on a chatty automation reaches it.

**→ Fix:** parse `retry_after`, honour it, never retry a 429 as if it were a
formatting error, and separate "reformat and retry" from "back off".

Sources: [Bot API FAQ](https://core.telegram.org/bots/faq),
[gramio rate limits](https://gramio.dev/rate-limits),
[rate-limit calculator & practices](https://botnamefinder.com/blog/telegram-bot-rate-limits-explained)

---

## 3. `max_connections` defaults to 40 — per bot

`setWebhook` takes `max_connections`, "1-100, **defaults to 40**". We never set
it. Every tenant bot therefore authorises Telegram to open up to 40 simultaneous
connections into the single Python process that serves *all* tenants.

At 25 tenant bots that is a 1,000-connection ceiling pointed at one FastAPI
worker. Nothing in our design caps it, and the failure mode is one busy tenant
starving every other tenant's bot.

**→ Fix:** set `max_connections` explicitly and low. Our handlers are short and
the work is a dispatch table, so a small number per bot is right — this is a
multi-tenant process, not a dedicated one.

Source: [setWebhook](https://core.telegram.org/bots/api#setwebhook)

---

## 4. We have no idea whether a tenant's webhook is actually working

`getWebhookInfo` returns `last_error_date`, `last_error_message`,
`pending_update_count`, `ip_address`, `max_connections`. We never call it.

So a tenant bot whose webhook is failing — expired DNS, a deploy that 500s,
Telegram unable to reach us — shows **"Live" in our dashboard indefinitely**,
while its community gets silence. The team's first signal is a member
complaining. `pending_update_count` climbing is the exact early warning, and it
is one API call away.

**→ Fix:** surface webhook health on the bot detail panel, and treat a
non-empty `last_error_message` as a reason to show something other than "Live".

Source: [getWebhookInfo](https://core.telegram.org/bots/api#getwebhookinfo)

---

## 5. Bot API 9.6 removes our worst onboarding step

**Bot API 9.6, 3 April 2026** added:

- `getManagedBotToken` — "Retrieve token for a managed bot created on behalf of
  a user"
- `replaceManagedBotToken` — "Generate new token for an existing managed bot"
- `can_manage_bots` on the `User` object
- `savePreparedKeyboardButton` — lets bots request managed-bot creation from
  Mini Apps

Our onboarding is currently: *open BotFather → `/newbot` → copy a credential →
paste it into a web form*. Four manual steps, one of which is pasting a
long-lived secret into a browser — the single highest-friction and
highest-risk moment in the product.

9.6 makes that unnecessary for users who grant `can_manage_bots`. And
`replaceManagedBotToken` is precisely the rotation primitive CVE-2026-27003's
remediation asks for: we can rotate a possibly-exposed token programmatically
instead of telling a team to go do it by hand.

**→ Fix (staged):** rotation first — it is small, it is the security
remediation, and it works with tokens we already hold. Managed-bot creation is a
larger onboarding change and wants its own design pass.

Source: [Bot API changelog](https://core.telegram.org/bots/api-changelog)

---

## 6. Disconfirming evidence: what kills products in this exact category

Deliberately searched for reasons this fails, since round 1 only looked for
reasons it wins.

- **"Bots are abandoned quickly, so the first session decides whether growth
  compounds."** Our composer optimises the *build*; nothing in our product
  optimises the community's first interaction with the finished bot.
- **"Abandoned bots are more likely to break or get hijacked."** We have no
  lifecycle management. A dead tenant bot with a live token and a funded
  treasury is a standing liability — ours, since we host it.
- **Solareum** shut down entirely after an exploit drained $523K from users.
- **Bankr was suspended from Telegram within hours of launch** and remained
  suspended there. Platform risk is real and it is not ours to control; a bot
  factory whose output can be banned needs to survive that.
- Post-2026-exploit-wave, **"audited open-source bots and non-custodial designs
  dominate."** Our custodial treasury path runs against that current and needs
  the public proof surface to compensate.
- Telegram enabling bots-that-build-bots is expected to bring "**more scam bots
  and spam as the barrier to deployment drops to zero**" — which raises the
  value of our impersonation guardrails and lowers the value of "easy to
  create" as a differentiator.

**→ What it means.** Easy creation is about to be commoditised by the platform
itself. What does not commoditise: provable treasury operations, refusing to
host impersonators, and keeping a bot alive and honest after month one.

Sources: [Decrypt on Solareum](https://decrypt.co/224371/solana-telegram-trading-bot-shut-down-users-drained-523k),
[Decrypt on bot ghost towns](https://decrypt.co/105775/inside-crypto-bot-ghost-towns-telegram),
[Telegram bot-building update](https://blockchain.news/news/telegram-ai-editor-bot-management-march-2026-update),
[flexe.io crypto bot guide](https://flexe.io/blog/crypto-bot-telegram-guide/)

---

## 7. Pricing anchor, from the vendor's own page

Lindy (fetched directly, not from a summary): **$29.99 / $99.99 / $199.99 per
user per month** for 3,000 / 15,000 / 35,000 credits, pooled across seats, with
work priced 2–250 credits for "everyday asks" up to 1,000–2,500 for "big
builds". Credits exhaust into a pause, not an overage.

**→ What it means.** Per-seat pricing is wrong for us — a meme-coin team is
three people and the value is not seats. The metered unit that matches our cost
*and* the customer's value is **executed automations and messages served**, and
Lindy's "pause, never surprise-bill" default is worth copying exactly, because
a surprise bill on a treasury tool destroys the trust the whole product is
selling.

Source: [Lindy pricing](https://www.lindy.ai/pricing)

---

# Defect list

| # | Defect | Severity | Where |
|---|--------|----------|-------|
| 1 | Bot tokens can reach logs via error URLs (CVE-2026-27003 pattern) | **High** — multi-tenant credential leak | 3 sites, both stacks |
| 2 | 429 retried immediately as a formatting error; extends the ban | **High** — deepens outages | `tenant_bot_runtime._send` |
| 3 | `max_connections` unset → 40/bot into one shared process | Medium | `TenantBotService.provision` |
| 4 | No webhook health; broken bots read as "Live" | Medium | service + dashboard |
| 5 | No token rotation despite holding others' credentials | Medium | service + routes |
| 6 | No lifecycle handling for abandoned bots | Low (design) | not yet built |

1–5 are fixed in the commits that follow this document.
