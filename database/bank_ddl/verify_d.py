"""Bank verify-d additive DDL (mirrors api-ts drizzle 0042_bank_verify_d.sql)."""


def statements(is_sqlite: bool) -> list[str]:
    if is_sqlite:
        return []
    return [
        "ALTER TABLE bank_stealth_view_keys ALTER COLUMN secret TYPE TEXT",
    ]
