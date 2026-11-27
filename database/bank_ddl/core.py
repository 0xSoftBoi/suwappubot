"""Bank core tables (mirrors api-ts db/schema/bank.ts + drizzle 0026_bank_core.sql)."""


def statements(is_sqlite: bool) -> list[str]:
    ts = "DATETIME DEFAULT CURRENT_TIMESTAMP" if is_sqlite else "TIMESTAMP DEFAULT NOW()"
    dt = "DATETIME" if is_sqlite else "TIMESTAMP"
    js = "TEXT" if is_sqlite else "JSONB"
    jd = "'{}'" if is_sqlite else "'{}'::jsonb"
    num = "NUMERIC" if is_sqlite else "NUMERIC(78,0)"
    return [
        f"""CREATE TABLE IF NOT EXISTS bank_accounts (
            id TEXT PRIMARY KEY, owner_type VARCHAR(24) NOT NULL, owner_id VARCHAR(64) NOT NULL,
            kind VARCHAR(16) NOT NULL, currency VARCHAR(8) NOT NULL, asset VARCHAR(16) NOT NULL,
            chain VARCHAR(32) NOT NULL, wallet_id INTEGER, wallet_user_id INTEGER, address VARCHAR(128),
            status VARCHAR(16) NOT NULL DEFAULT 'active', segment_profile VARCHAR(32),
            balance_minor {num} NOT NULL DEFAULT 0, label VARCHAR(80),
            metadata {js} NOT NULL DEFAULT {jd},
            created_at {ts} NOT NULL, updated_at {ts} NOT NULL)""",
        f"""CREATE TABLE IF NOT EXISTS bank_transfers (
            id TEXT PRIMARY KEY, owner_type VARCHAR(24) NOT NULL, owner_id VARCHAR(64) NOT NULL,
            idempotency_key VARCHAR(128) NOT NULL, request_hash VARCHAR(64) NOT NULL,
            type VARCHAR(16) NOT NULL, from_account TEXT, to_account TEXT, to_external {js},
            amount_minor {num} NOT NULL, asset VARCHAR(16) NOT NULL, chain VARCHAR(32) NOT NULL,
            status VARCHAR(16) NOT NULL DEFAULT 'pending', tx_hash VARCHAR(128), failure_reason TEXT,
            memo VARCHAR(280), metadata {js} NOT NULL DEFAULT {jd},
            created_at {ts} NOT NULL, updated_at {ts} NOT NULL, confirmed_at {dt})""",
        f"""CREATE TABLE IF NOT EXISTS bank_ledger_entries (
            id TEXT PRIMARY KEY, transfer_id TEXT NOT NULL, account_id TEXT NOT NULL,
            direction VARCHAR(6) NOT NULL, amount_minor {num} NOT NULL, asset VARCHAR(16) NOT NULL,
            balance_after {num}, phase VARCHAR(24) NOT NULL DEFAULT 'submit', created_at {ts} NOT NULL)""",
        "CREATE INDEX IF NOT EXISTS ix_bank_accounts_owner ON bank_accounts(owner_type, owner_id)",
        "CREATE INDEX IF NOT EXISTS ix_bank_accounts_wallet ON bank_accounts(chain, address, asset)",
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_bank_accounts_owner_kind_asset ON bank_accounts"
        "(owner_type, owner_id, kind, asset, chain, coalesce(label, ''))",
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_bank_transfers_idem ON bank_transfers"
        "(owner_type, owner_id, idempotency_key)",
        "CREATE INDEX IF NOT EXISTS ix_bank_transfers_owner ON bank_transfers(owner_type, owner_id, created_at)",
        "CREATE INDEX IF NOT EXISTS ix_bank_transfers_status ON bank_transfers(status, updated_at)",
        "CREATE INDEX IF NOT EXISTS ix_bank_transfers_from ON bank_transfers(from_account)",
        "CREATE INDEX IF NOT EXISTS ix_bank_transfers_to ON bank_transfers(to_account)",
        "CREATE INDEX IF NOT EXISTS ix_bank_transfers_tx ON bank_transfers(tx_hash)",
        "CREATE INDEX IF NOT EXISTS ix_bank_ledger_account ON bank_ledger_entries(account_id, created_at)",
        "CREATE INDEX IF NOT EXISTS ix_bank_ledger_transfer ON bank_ledger_entries(transfer_id)",
    ]
