"""Bank payroll schedule idempotency additive DDL (mirrors api-ts drizzle 0046_bank_schedule_idempotency.sql)."""


def statements(is_sqlite: bool) -> list[str]:
    if is_sqlite:
        return []
    return [
        "ALTER TABLE bank_payroll_schedules ADD COLUMN IF NOT EXISTS idem_key VARCHAR(128)",
        "ALTER TABLE bank_payroll_schedules ADD COLUMN IF NOT EXISTS idem_hash VARCHAR(64)",
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_bank_payroll_schedules_idem ON bank_payroll_schedules (owner_type, owner_id, idem_key) WHERE idem_key IS NOT NULL",
    ]
