"""Bank review2 additive DDL (mirrors api-ts drizzle 0035_bank_review2.sql)."""


def statements(is_sqlite: bool) -> list[str]:
    if is_sqlite:
        return []
    return [
        "ALTER TABLE bank_invoice_payments ADD COLUMN IF NOT EXISTS receipt_key VARCHAR(260)",
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_bank_invoice_payments_receipt ON bank_invoice_payments (receipt_key)",
        "ALTER TABLE bank_card_holds ADD COLUMN IF NOT EXISTS captured_minor NUMERIC(78, 0) NOT NULL DEFAULT 0",
        """CREATE TABLE IF NOT EXISTS bank_card_shortfalls (
            id TEXT PRIMARY KEY,
            account_id TEXT NOT NULL,
            card_id TEXT NOT NULL,
            card_transaction_id TEXT NOT NULL,
            amount_minor NUMERIC(78, 0) NOT NULL,
            repaid_minor NUMERIC(78, 0) NOT NULL DEFAULT 0,
            status VARCHAR(8) NOT NULL DEFAULT 'open',
            created_at TIMESTAMP NOT NULL DEFAULT now(),
            repaid_at TIMESTAMP
        )""",
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_bank_card_shortfalls_txn ON bank_card_shortfalls (card_transaction_id)",
        "CREATE INDEX IF NOT EXISTS ix_bank_card_shortfalls_account ON bank_card_shortfalls (account_id, status)",
    ]
