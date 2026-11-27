"""Bank M4 remittance + M5 ramps (mirrors api-ts db/schema/bankRemitRamps.ts + drizzle 0028)."""


def statements(is_sqlite: bool) -> list[str]:
    ts = "DATETIME DEFAULT CURRENT_TIMESTAMP" if is_sqlite else "TIMESTAMP DEFAULT NOW()"
    dt = "DATETIME" if is_sqlite else "TIMESTAMP"
    js = "TEXT" if is_sqlite else "JSONB"
    jd = "'{}'" if is_sqlite else "'{}'::jsonb"
    num = "NUMERIC" if is_sqlite else "NUMERIC(78,0)"
    return [
        f"""CREATE TABLE IF NOT EXISTS bank_ramp_customers (
            id TEXT PRIMARY KEY, owner_type VARCHAR(24) NOT NULL, owner_id VARCHAR(64) NOT NULL,
            provider VARCHAR(24) NOT NULL, provider_customer_id VARCHAR(128) NOT NULL,
            kyc_status VARCHAR(24) NOT NULL DEFAULT 'not_started', kyc_link TEXT, tos_link TEXT,
            metadata {js} NOT NULL DEFAULT {jd}, created_at {ts} NOT NULL, updated_at {ts} NOT NULL)""",
        f"""CREATE TABLE IF NOT EXISTS bank_external_accounts (
            id TEXT PRIMARY KEY, owner_type VARCHAR(24) NOT NULL, owner_id VARCHAR(64) NOT NULL,
            provider VARCHAR(24) NOT NULL, provider_id VARCHAR(128) NOT NULL, rail VARCHAR(16) NOT NULL,
            currency VARCHAR(8) NOT NULL, label VARCHAR(80), details {js} NOT NULL DEFAULT {jd},
            created_at {ts} NOT NULL)""",
        f"""CREATE TABLE IF NOT EXISTS bank_virtual_accounts (
            id TEXT PRIMARY KEY, owner_type VARCHAR(24) NOT NULL, owner_id VARCHAR(64) NOT NULL,
            provider VARCHAR(24) NOT NULL, provider_id VARCHAR(128) NOT NULL,
            source_currency VARCHAR(8) NOT NULL, dest_account_id TEXT NOT NULL, dest_asset VARCHAR(16) NOT NULL,
            dest_chain VARCHAR(32) NOT NULL, dest_address VARCHAR(128) NOT NULL,
            instructions {js} NOT NULL DEFAULT {jd}, status VARCHAR(16) NOT NULL DEFAULT 'active',
            created_at {ts} NOT NULL)""",
        f"""CREATE TABLE IF NOT EXISTS bank_ramp_transfers (
            id TEXT PRIMARY KEY, owner_type VARCHAR(24) NOT NULL, owner_id VARCHAR(64) NOT NULL,
            provider VARCHAR(24) NOT NULL, provider_id VARCHAR(128) NOT NULL, direction VARCHAR(12) NOT NULL,
            provider_state VARCHAR(48) NOT NULL, status VARCHAR(16) NOT NULL DEFAULT 'pending',
            source_rail VARCHAR(24) NOT NULL, source_currency VARCHAR(8) NOT NULL,
            dest_rail VARCHAR(24) NOT NULL, dest_currency VARCHAR(8) NOT NULL,
            amount_minor {num} NOT NULL, receive_minor {num}, fee_minor {num},
            account_id TEXT, bank_transfer_id TEXT, external_account_id TEXT, virtual_account_id TEXT,
            client_reference_id VARCHAR(128), metadata {js} NOT NULL DEFAULT {jd},
            created_at {ts} NOT NULL, updated_at {ts} NOT NULL)""",
        f"""CREATE TABLE IF NOT EXISTS bank_ramp_events (
            id TEXT PRIMARY KEY, provider VARCHAR(24) NOT NULL, event_id VARCHAR(160) NOT NULL,
            event_type VARCHAR(80) NOT NULL, created_at {ts} NOT NULL)""",
        f"""CREATE TABLE IF NOT EXISTS bank_remittances (
            id TEXT PRIMARY KEY, sender_type VARCHAR(24) NOT NULL, sender_id VARCHAR(64) NOT NULL,
            recipient_type VARCHAR(24), recipient_id VARCHAR(64), recipient_ref VARCHAR(160),
            mode VARCHAR(12) NOT NULL, status VARCHAR(28) NOT NULL DEFAULT 'pending',
            corridor VARCHAR(16) NOT NULL, send_asset VARCHAR(16) NOT NULL, send_chain VARCHAR(32) NOT NULL,
            send_currency VARCHAR(8) NOT NULL, amount_minor {num} NOT NULL, receive_currency VARCHAR(8),
            receive_minor {num}, fee_minor {num}, from_account_id TEXT NOT NULL, escrow_account_id TEXT,
            to_account_id TEXT, bank_transfer_id TEXT, ramp_transfer_id TEXT, claim_token_hash VARCHAR(64),
            claim_expires_at {dt}, auto_earn VARCHAR(5) NOT NULL DEFAULT 'false',
            idempotency_key VARCHAR(128) NOT NULL, memo VARCHAR(280), metadata {js} NOT NULL DEFAULT {jd},
            created_at {ts} NOT NULL, updated_at {ts} NOT NULL, completed_at {dt})""",
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_bank_ramp_customers_owner ON bank_ramp_customers(owner_type, owner_id, provider)",
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_bank_ramp_customers_prov ON bank_ramp_customers(provider, provider_customer_id)",
        "CREATE INDEX IF NOT EXISTS ix_bank_external_accounts_owner ON bank_external_accounts(owner_type, owner_id)",
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_bank_external_accounts_prov ON bank_external_accounts(provider, provider_id)",
        "CREATE INDEX IF NOT EXISTS ix_bank_virtual_accounts_owner ON bank_virtual_accounts(owner_type, owner_id)",
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_bank_virtual_accounts_prov ON bank_virtual_accounts(provider, provider_id)",
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_bank_ramp_transfers_prov ON bank_ramp_transfers(provider, provider_id)",
        "CREATE INDEX IF NOT EXISTS ix_bank_ramp_transfers_owner ON bank_ramp_transfers(owner_type, owner_id, created_at)",
        "CREATE INDEX IF NOT EXISTS ix_bank_ramp_transfers_status ON bank_ramp_transfers(status)",
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_bank_ramp_events ON bank_ramp_events(provider, event_id)",
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_bank_remittances_idem ON bank_remittances(sender_type, sender_id, idempotency_key)",
        "CREATE INDEX IF NOT EXISTS ix_bank_remittances_sender ON bank_remittances(sender_type, sender_id, created_at)",
        "CREATE INDEX IF NOT EXISTS ix_bank_remittances_recipient ON bank_remittances(recipient_type, recipient_id, created_at)",
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_bank_remittances_claim ON bank_remittances(claim_token_hash)",
        "CREATE INDEX IF NOT EXISTS ix_bank_remittances_corridor ON bank_remittances(corridor, status)",
    ]
