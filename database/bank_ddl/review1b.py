"""Bank review1b additive DDL (mirrors api-ts drizzle 0037_bank_review1b.sql)."""


def statements(is_sqlite: bool) -> list[str]:
    ts = "TIMESTAMP"
    return [
        f"""CREATE TABLE IF NOT EXISTS bank_credit_ops (
            id TEXT PRIMARY KEY NOT NULL,
            line_id TEXT NOT NULL,
            op_key VARCHAR(200) NOT NULL,
            kind VARCHAR(8) NOT NULL,
            transfer_id TEXT,
            status VARCHAR(10) NOT NULL DEFAULT 'pending',
            principal_minor NUMERIC(78,0) NOT NULL DEFAULT 0,
            interest_minor NUMERIC(78,0) NOT NULL DEFAULT 0,
            created_at {ts} NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at {ts} NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""",
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_bank_credit_ops_line_key ON bank_credit_ops (line_id, op_key)",
        "CREATE INDEX IF NOT EXISTS ix_bank_credit_ops_status ON bank_credit_ops (status, kind)",
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_bank_credit_lines_unsecured_active ON bank_credit_lines (owner_type, owner_id, loan_asset, chain) WHERE kind = 'undercollateralized' AND status = 'active'",
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_bank_credit_lines_recv_active ON bank_credit_lines (receivable_id) WHERE kind = 'receivable' AND status = 'active'",
        f"""CREATE TABLE IF NOT EXISTS bank_invoice_acceptances (
            invoice_id TEXT PRIMARY KEY NOT NULL,
            payer_owner_type VARCHAR(24) NOT NULL,
            payer_owner_id VARCHAR(64) NOT NULL,
            accepted_at {ts} NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""",
    ]
