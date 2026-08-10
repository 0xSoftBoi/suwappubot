# bot/ + api/ — Python monolith rules

Scope: Telegram/WhatsApp handlers (`bot/handlers/`), business logic
(`bot/services/`), SQLAlchemy models (`bot/models/`), FastAPI app (`api/`),
runtime migrations (`database/db.py`).

- **Import-time crashes are the #1 deploy killer.** A `def` that uses `await`,
  or a bad import, crashes at boot, not at call time — and CI does not catch
  it. Before claiming done: `python3 -c "import ast; ast.parse(open('<file>').read())"`
  and check the import chain from `bot/main.py`.
- **Format with `black --line-length=100`** before pushing; CI fails on style.
- **New commands** register in `bot/main.py:add_handlers()` — a handler file
  alone is a dead button. Use the `/new-handler` skill.
- **Background services** start in `api/main.py`'s lifespan; a service module
  that isn't started there never runs. See `docs/architecture/OVERVIEW.md`.
- **Schema changes** go in `database/db.py:_ensure_schema()` — additive +
  idempotent only — AND the Drizzle schema in `api-ts/src/db/schema/`
  (ADR 0003). Use `/migrations`.
- **MONEY-PATH**: `swap_engine`, `wallet`, `hot_wallet`, encryption/KMS, fee
  math, withdrawals, seasons/points. Tag diffs `MONEY-PATH`; link an ADR.
- Settings live in `bot/config/settings.py` (pydantic-settings); only
  `TELEGRAM_BOT_TOKEN` and `ENCRYPTION_KEY` lack defaults.
- Tests: `pytest tests/` — give it a generous timeout; slow ≠ hung.
