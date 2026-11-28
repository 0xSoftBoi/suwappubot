"""Bank review3 additive DDL (mirrors api-ts drizzle 0036_bank_review3.sql)."""


def statements(is_sqlite: bool) -> list[str]:
    bigint = "INTEGER" if is_sqlite else "BIGINT"
    stmts = []
    if is_sqlite:
        # SQLite has no ADD COLUMN IF NOT EXISTS; the python runtime ignores per-statement failure via boot guard.
        pass
    else:
        stmts += [
            "ALTER TABLE bank_agent_spend ADD COLUMN IF NOT EXISTS auth_nonce VARCHAR(80)",
            f"ALTER TABLE bank_agent_spend ADD COLUMN IF NOT EXISTS auth_valid_before {bigint}",
            "ALTER TABLE bank_agent_resource_sales ADD COLUMN IF NOT EXISTS auth_nonce VARCHAR(80)",
            "CREATE UNIQUE INDEX IF NOT EXISTS ux_bank_agent_sales_nonce ON bank_agent_resource_sales (chain, auth_nonce)",
        ]
    return stmts
