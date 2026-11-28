"""Bank idempotency additive DDL, part 2 (mirrors api-ts drizzle 0044_bank_idempotency2.sql)."""


def statements(is_sqlite: bool) -> list[str]:
    if is_sqlite:
        return []
    return [
        "ALTER TABLE bank_payroll_runs ADD COLUMN IF NOT EXISTS idem_key VARCHAR(128)",
        "ALTER TABLE bank_payroll_runs ADD COLUMN IF NOT EXISTS idem_hash VARCHAR(64)",
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_bank_payroll_runs_idem ON bank_payroll_runs (owner_type, owner_id, idem_key) WHERE idem_key IS NOT NULL",
    ]
