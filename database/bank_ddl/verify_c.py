"""Bank verify-c additive DDL (mirrors api-ts drizzle 0041_bank_verify_c.sql)."""


def statements(is_sqlite: bool) -> list[str]:
    if is_sqlite:
        return []
    return [
        "ALTER TABLE bank_pool_receivables ADD COLUMN IF NOT EXISTS dest_fp VARCHAR(128)",
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_bank_wage_advances_transfer ON bank_wage_advances (transfer_id) WHERE transfer_id IS NOT NULL",
    ]
