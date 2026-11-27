"""Bank idempotency additive DDL (mirrors api-ts drizzle 0043_bank_idempotency.sql)."""


def statements(is_sqlite: bool) -> list[str]:
    if is_sqlite:
        return []
    return [
        "ALTER TABLE bank_agent_spend ADD COLUMN IF NOT EXISTS idem_key VARCHAR(128)",
        "ALTER TABLE bank_agent_spend ADD COLUMN IF NOT EXISTS idem_hash VARCHAR(64)",
        "ALTER TABLE bank_agent_spend ADD COLUMN IF NOT EXISTS idem_result TEXT",
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_bank_agent_spend_idem ON bank_agent_spend (agent_id, idem_key) WHERE idem_key IS NOT NULL",
    ]
