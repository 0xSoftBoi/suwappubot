# Support & Bug-Report System — Optimization Plan

Status: **design complete, wiring partially wiped by a branch switch.** This doc is
the single source of truth to (a) recover the base feature and (b) build the
approved "Everything" optimization tier.

## ⚠️ Working-tree collision note
A parallel process switched this working directory across branches
(`claude/suwappu-tempo-native-szaw6u` → `bot-money-paths-clean`) and amended/reset
history (see `git reflog`). Branch switch/reset **discards uncommitted tracked-file
changes but keeps untracked files**. Result:

- **Survived (untracked, on disk now):** `bot/models/support.py`,
  `bot/handlers/support.py`, `bot/services/support_notifier.py`,
  `webapp/src/pages/Support.tsx`.
- **Wiped (tracked-file edits — must be re-applied):** migration in
  `database/db.py`, registration in `bot/main.py`, lifespan wiring in
  `api/main.py`, fields in `bot/config/settings.py`, export in
  `bot/models/__init__.py`, help text in `bot/utils/templates.py`,
  api-ts `routes/webapp.ts` + `routes/validators.ts`, webapp `lib/api.ts`,
  `App.tsx`, `Settings.tsx`, `types/api.ts`.

**Before applying any of this:** quiesce the other session, OR commit the support
work to a dedicated branch so it can't be wiped. Apply Part 0 first.

---

## Architecture (unchanged)
One Python-owned `support_tickets` table. Any surface (bot, webapp/api-ts, future
WhatsApp) just INSERTs a row with `notified_at` NULL. A single background service
`support_notifier` polls `notified_at IS NULL` and fans out: admin DMs + Telegram
support group + Linear issue. Two-way: Linear webhook + group-topic replies notify
the user. No per-surface duplication of notify/Linear logic.

Real Linear target (from live workspace):
- Team **Suwappu** `31d83b5c-175d-488a-8b46-7166d4f363ce`.
- States (map to `type`, not name): `Backlog`(backlog) `Todo`(unstarted)
  `In Progress`(started) `In Review`(started) `Done`(completed)
  `Canceled`(canceled) `Duplicate`(duplicate).
- Labels to use: `Bug` `176b4fd0-e5ad-496d-aa72-f5b82cdf559e`,
  `Feature` `03c827a6-76a6-4d28-b239-bb34dc1b1ae2`,
  `Improvement` `1a4662de-8314-46e9-93c8-506843e63c72`, plus component labels
  `swap-engine`, `webapp`, `api`, `perps`, `bridges`, `security`,
  `priority:critical/high/normal`. **Resolve label IDs by name at runtime** (don't
  hardcode UUIDs — they differ per workspace and can change).

---

## Part 0 — Recover the base wiring (do first)

1. **`database/db.py`** — in `_ensure_schema()`, after the
   `prediction_positions` block, add create-or-migrate for `support_tickets`
   + helper `_add_support_ticket_columns()` covering ALL columns in the model
   (idempotent, `IF NOT EXISTS` on Postgres / guarded `ALTER` on SQLite).
   Column set is the full list in Part 1.
2. **`bot/models/__init__.py`** — `from .support import SupportTicket, TicketStatus,
   TicketKind` + add the three to `__all__`.
3. **`bot/main.py`** — import + register: `support_conversation_handler`
   (with conversation handlers), and admin `tickets_handler`, `ticket_handler`,
   `treply_handler`, `tclose_handler` (with admin commands). Plus the new
   callback handlers from Parts 3/6/7.
4. **`api/main.py`** — import `support_notifier`; `await support_notifier.start(
   bot=bot_app.bot if bot_initialized else None)` next to `digest_service.start`;
   `await support_notifier.stop()` in shutdown. Also start `stale_ticket_service`
   (Part 10) and register the Linear webhook route (Part 5).
5. **`bot/config/settings.py`** — add the consolidated settings block (bottom of
   this doc).
6. **`bot/utils/templates.py`** — add `/support` + `/bug` lines to `HELP_MESSAGE`
   (MarkdownV2: escape `-` as `\-`).
7. **api-ts** — re-add `POST /webapp/me/support` + `GET /webapp/me/support-tickets`
   in `routes/webapp.ts` (raw `sql` against the Python-owned table; leave
   `notified_at` NULL; `source='webapp'`), `SupportTicketSchema` in
   `routes/validators.ts`. NOTE: protected router mounts at `/webapp/me` — webapp
   client must call `/webapp/me/support`.
8. **webapp** — re-add `types/api.ts` (SupportTicket types), `lib/api.ts`
   (`createSupportTicket` → `/webapp/me/support`, `getMySupportTickets`),
   `App.tsx` lazy `/support` route, `Settings.tsx` "Contact Support" + "Report a
   Bug" → `navigate('/support')`. `Support.tsx` already exists — verify imports.

Verify: parse all Python; boot-import `api.main` + `bot.main`; `bun run check`
(api-ts); `npm run build` (webapp); migration + fan-out round-trip on sqlite.

---

## Part 1 — Data model (columns already in `bot/models/support.py`)
Base: `id, user_id, telegram_id, username, source, kind, category, message,
status, admin_reply, handled_by, notified_at, linear_issue_id, linear_issue_url,
created_at, updated_at, resolved_at`.
Added for optimization: `priority, idempotency_key(idx), error_category,
reference_id, tx_hash, bot_version, context_json, photo_file_id, group_chat_id,
group_topic_id(idx), group_message_id, csat, first_response_at`.
Migration `_add_support_ticket_columns()` must add every non-base column
idempotently (string/timestamp/integer; defaults NULL except `kind='support'`,
`source='telegram'`).

---

## Part 2 — Auto-context capture
New `bot/services/support_context.py`:
- `build_context(session, user, telegram_id) -> dict` returns:
  `bot_version` (`bot.__version__`), `region`, `subscription_tier`
  (`user.subscription`), `wallet_count` + default `chain_type`/`address`,
  and `last_swap` = most recent `SwapTransaction` for the user
  (`status, error_category, error_message[:300], tx_hash, from_chain, to_chain,
  from_token, to_token, created_at`). All cheap indexed lookups.
- `_create_ticket()` (handler) and the api-ts insert both populate
  `context_json = json.dumps(ctx)`; the notifier renders it into the Linear
  description and (collapsed) into the admin/group message.

---

## Part 3 — One-tap "🐞 Report this" on swap errors
- In `bot/handlers/swap.py` `_guidance_keyboard()` (≈L64-118), append an inline
  button `🐞 Report this` with `callback_data = f"rep:{reference_id}"`
  (≤64 bytes — `reference_id` is 8 hex chars). Stash the full guidance/context
  under `context.user_data[f"rep:{reference_id}"]` = {category, reference_id,
  message, tx context, swap_id} at render time.
- New callback `report_error_callback` (pattern `^rep:[0-9a-f]+$`): pop the stash,
  build a `kind=bug` ticket with `error_category`, `reference_id`, `tx_hash`,
  `context_json`, `idempotency_key = f"rep:{uid}:{reference_id}"` (dedup — taps
  twice = one ticket), confirm "🐞 Logged — ticket #N. We'll follow up here."
- Register the callback in `bot/main.py`.
- Same hook can later be added to other error renderers (bridge, approval).

---

## Part 4 — Linear enrichment (`support_notifier`)
- `_resolve_label_ids(names) -> [id]`: GraphQL `team(id){labels(first:250){
  nodes{id name}}}`, cache name→id in the service (one call, lazy). Robust to
  workspace changes.
- `_create_linear_issue()`: set
  - `labelIds`: `Bug` for kind=bug / `Improvement` for kind=support, plus a
    component label inferred from `category`/context (`swap`→swap-engine,
    `perp`→perps, `bridge`→bridges, `webapp`→webapp, `api`→api, `security`→security).
  - `priority`: from ticket `priority` / `is_fund_loss` (critical=1, high=2,
    normal=3, low=4).
  - `description`: the context block (version, tier, chains, last swap + error,
    tx links) as markdown.
- On `/treply` & `/tclose`: keep `add_linear_comment`; additionally on resolve,
  move the Linear issue to a `completed` state via `issueUpdate(stateId:…)`
  (resolve the Done state id by `type==completed` once, cache).

---

## Part 5 — Two-way Linear webhook (kills "any update?")
- Settings: `linear_webhook_secret`.
- New `bot/services/linear_webhook.py`: `verify(raw_body, sig_header)` =
  constant-time compare of `hex(hmac_sha256(secret, raw_body))` vs
  `Linear-Signature`; reject if `webhookTimestamp` older than ~60s.
  `process_event(payload, bot)`:
  - `type==Issue, action==update`, `updatedFrom.stateId` present, new
    `data.state.type==completed` → find ticket by `linear_issue_id`, mark
    resolved, DM + push user "✅ Resolved", trigger CSAT (Part 7).
  - `type==Comment, action==create` on a tracked issue, where the comment is NOT
    one we mirrored (skip bodies carrying our hidden marker, e.g. prefix
    `↩︎`/zero-width) → DM + push the comment to the user.
- `api/main.py`: `@app.post("/webhooks/linear")` — read raw body, verify, then
  `bot = request.app.state.bot_app.bot` (fallback to `support_notifier._bot`),
  `await process_event(...)`. Mirror the WhatsApp/Telegram webhook handlers
  (≈api/main.py:2147-2253) for shape + signature pattern.
- Subscribe one webhook (Issue + Comment) in Linear settings → the public
  `/webhooks/linear` URL. Gotcha: HMAC over **raw bytes**, state change is an
  Issue `update` (no dedicated event), 400 (not 429) on rate limit.

---

## Part 6 — Forum topics + inline triage + topic-reply threading
- Settings: `support_group_is_forum` (bool).
- In `support_notifier._fan_out()`, when group + forum enabled:
  - `topic = await bot.create_forum_topic(chat_id, name=f"#{id} [{kind}] {handle}")`
    (Bot API `createForumTopic` IS supported since 6.3 — auto-create works).
  - Post the ticket message into `message_thread_id=topic.message_thread_id`
    with inline keyboard: `✅ Close` (`tk_close:{id}`), `👤 Assign me`
    (`tk_assign:{id}`), `🔗 Linear` (url button).
  - Persist `group_chat_id, group_topic_id, group_message_id`.
- New MessageHandler (group-scoped, `filters.Chat(support_group) &
  filters.TEXT & ~COMMAND` with `message_thread_id`): map thread→ticket
  (`group_topic_id`), treat the admin's message as a reply → DM+push user,
  `add_linear_comment`, set `first_response_at`/in_progress. **This is the
  primary reply UX** — admins just type in the topic; no `/treply` needed.
- Callbacks `tk_close`, `tk_assign`: update ticket, edit the topic message,
  best-effort Linear state/comment. Register all in `bot/main.py`.
- Non-forum fallback: keep current single-message + `/treply`/`/tclose`.

---

## Part 7 — CSAT on close
- On resolve (via `/tclose`, `tk_close`, or Linear webhook), DM the user an inline
  👍/👎 (`csat:{id}:1` / `csat:{id}:0`).
- Callback `csat_callback` (`^csat:\d+:[01]$`): record `csat` (±1), thank the
  user, optional Linear comment ("CSAT: 👍/👎"). Dedup: ignore if already rated;
  one prompt per resolve. Register in `bot/main.py`.

---

## Part 8 — Screenshot attachments (bug reports)
- In `support_conversation_handler` `ASK_MESSAGE` state, add
  `MessageHandler(filters.PHOTO, receive_photo)`: take `update.message.photo[-1]
  .file_id` → `photo_file_id`, caption (or "📷 screenshot") → message; create the
  ticket. (No download needed — Telegram `file_id` is reusable.)
- Notifier: when `photo_file_id` set, `bot.send_photo(..., file_id)` into the
  group/topic so admins see it; attach the screenshot to Linear via
  `attachmentLinkURL`/file upload (or just note "has screenshot" + the file_id).
- webapp (optional, later): multipart upload field; out of scope for v1.

---

## Part 9 — `/tm` ticket metrics (admin)
- New `bot/services/ticket_metrics.py`: `get_overview()` → counts by status,
  `avg(first_response_at - created_at)` over last 7/30d, volume by `kind`/
  `category`, CSAT 👍-rate, median time-to-resolve.
- `/tm` admin command (mirror `bot/handlers/admin_metrics.py` aggregation +
  inline drill-down). Register in `bot/main.py`.

---

## Part 10 — Stale escalation + daily digest
- New `bot/services/stale_ticket_service.py` (clone `digest_service` shape):
  hourly loop. Escalate tickets `status=open AND first_response_at IS NULL AND
  created_at < now-Nh` (default 4h) → re-post to group/admins. Once/day → post an
  open-ticket digest (counts + oldest N) to admins/group.
- Settings: `support_stale_hours` (default 4), `support_digest_hour_utc`
  (default 9). Start/stop in `api/main.py` lifespan.

---

## Part 11 — Reply-back push (Expo)
- `bot/services/push_service.py`: add `CATEGORIES["SUPPORT_REPLY"] =
  "support_reply"`.
- Helper `notify_user_reply(ticket, text, bot)`: Telegram DM (if telegram_id) +
  `send_push_notification(user.push_token, title, text[:120],
  category="SUPPORT_REPLY")` when `push_token` set. Call from `/treply`, topic
  reply (Part 6), and Linear webhook (Part 5) — single path.

---

## Consolidated new settings (`bot/config/settings.py`)
```
support_group_chat_id: Optional[str]        # group/supergroup id; empty = admin DMs only
support_group_is_forum: bool = False        # group is a forum → topic-per-ticket
support_sla_text: str = "We usually reply within a few hours."
support_stale_hours: int = 4
support_digest_hour_utc: int = 9
linear_api_key: Optional[str]               # lin_api_... (no Bearer prefix)
linear_team_id: Optional[str]               # Suwappu team UUID
linear_webhook_secret: Optional[str]        # HMAC secret for /webhooks/linear
```

---

## Build order (sequenced, each independently verifiable)
1. **Part 0** recovery → feature live again (table + wiring + surfaces).
2. **Part 1** migration cols + **Part 2** auto-context + **Part 11** push helper.
3. **Part 3** one-tap "Report this".
4. **Part 4** Linear enrichment (labels/priority/state).
5. **Part 5** Linear webhook (two-way).
6. **Part 7** CSAT.
7. **Part 8** photo support.
8. **Part 6** forum topics + topic-reply (largest single piece).
9. **Part 9** `/tm` metrics.
10. **Part 10** stale escalation + digest.

## Verification per cluster
- Python: `ast.parse`; boot-import `api.main` + `bot.main` with dummy
  `TELEGRAM_BOT_TOKEN`/`KMS_PROVIDER=dev`/`ENCRYPTION_KEY` in `.venv`.
- DB: migration + insert/fan-out round-trip on sqlite; idempotent re-run.
- Linear/webhook: unit-test signature verify with a known body+secret; dry-run
  issue create against the real team behind the `linear_api_key` gate.
- Style: `black --line-length=100` on changed Python; `bun run check` (api-ts);
  `npm run build` (webapp).
- Live (needs env): file `/bug test`, confirm group topic + Linear issue + admin
  DM; resolve in Linear → user notified; 👍 CSAT recorded.

## Risks / gotchas captured
- Tracked-file edits get wiped on branch switch — commit support work to its own
  branch before building, or pause the parallel session.
- Linear personal key auth = bare `Authorization: <key>` (no `Bearer`).
- Webhook HMAC must be over **raw bytes**; state change = Issue `update` +
  `updatedFrom`; 400 on rate limit.
- Comment-mirroring loop: tag our mirrored comments and skip them on inbound.
- api-ts protected router mounts at `/webapp/me` (POST path = `/webapp/me/support`).
- Mobile has **no** `mobile/` dir (CLAUDE.md stale) — ignore that surface.
```
