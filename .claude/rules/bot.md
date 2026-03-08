---
paths:
  - "bot/**/*.py"
  - "api/**/*.py"
  - "tests/**/*.py"
---

# Python Bot Rules

- Tests: `pytest tests/` or `pytest tests/test_file.py::test_name -v`
- Always use `@enforce_tos` and `@enforce_rate_limit_for_update` decorators on handlers
- Database: `with get_session() as session:` — don't hold sessions across awaits
- Callback data max 64 bytes (Telegram limit)
- Parse mode: `parse_mode="Markdown"` — escape special chars
- Settings: `bot/config/settings.py` (pydantic-settings)
- Runtime migrations in `database/db.py` via `_ensure_schema()` — additive + idempotent
- Background services started in `api/main.py` lifespan — async tasks, not separate processes
