"""Bank paywall sales recovery additive DDL (mirrors api-ts drizzle 0045_bank_sales_recovery.sql)."""


def statements(is_sqlite: bool) -> list[str]:
    if is_sqlite:
        return []
    return [
        "ALTER TABLE bank_agent_resource_sales ADD COLUMN IF NOT EXISTS valid_before VARCHAR(80)",
        "ALTER TABLE bank_agent_resource_sales ADD COLUMN IF NOT EXISTS head_block VARCHAR(40)",
        "ALTER TABLE bank_agent_resource_sales ADD COLUMN IF NOT EXISTS retrieval_hash VARCHAR(64)",
        "ALTER TABLE bank_agent_resource_sales ADD COLUMN IF NOT EXISTS recover_challenge VARCHAR(400)",
        "ALTER TABLE bank_agent_resource_sales ADD COLUMN IF NOT EXISTS recover_expires TIMESTAMP",
    ]
