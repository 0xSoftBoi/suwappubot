"""Bank cards tables (mirrors api-ts db/schema/bankCards.ts + drizzle 0029_bank_cards.sql)."""


def statements(is_sqlite: bool) -> list[str]:
    ts = "DATETIME DEFAULT CURRENT_TIMESTAMP" if is_sqlite else "TIMESTAMP DEFAULT NOW()"
    dt = "DATETIME" if is_sqlite else "TIMESTAMP"
    js = "TEXT" if is_sqlite else "JSONB"
    jo = "'{}'" if is_sqlite else "'{}'::jsonb"
    ja = "'[]'" if is_sqlite else "'[]'::jsonb"
    num = "NUMERIC" if is_sqlite else "NUMERIC(78,0)"
    bf = "0" if is_sqlite else "false"
    return [
        f"""CREATE TABLE IF NOT EXISTS bank_cardholders (
            id TEXT PRIMARY KEY, owner_type VARCHAR(24) NOT NULL, owner_id VARCHAR(64) NOT NULL,
            member_id VARCHAR(64), provider VARCHAR(16) NOT NULL,
            provider_cardholder_id VARCHAR(128) NOT NULL,
            created_at {ts} NOT NULL, updated_at {ts} NOT NULL)""",
        f"""CREATE TABLE IF NOT EXISTS bank_cards (
            id TEXT PRIMARY KEY, owner_type VARCHAR(24) NOT NULL, owner_id VARCHAR(64) NOT NULL,
            account_id TEXT NOT NULL, provider VARCHAR(16) NOT NULL, provider_card_id VARCHAR(128) NOT NULL,
            cardholder_id TEXT NOT NULL, type VARCHAR(12) NOT NULL, status VARCHAR(12) NOT NULL DEFAULT 'active',
            currency VARCHAR(8) NOT NULL, brand VARCHAR(24), last4 VARCHAR(4), exp_month INTEGER, exp_year INTEGER,
            label VARCHAR(80), rules {js} NOT NULL DEFAULT {jo}, single_use BOOLEAN NOT NULL DEFAULT {bf},
            decline_streak INTEGER NOT NULL DEFAULT 0, org_id VARCHAR(64), member_id VARCHAR(64),
            team_id VARCHAR(64), expense_category VARCHAR(64), memo VARCHAR(280),
            metadata {js} NOT NULL DEFAULT {jo}, created_at {ts} NOT NULL, updated_at {ts} NOT NULL)""",
        f"""CREATE TABLE IF NOT EXISTS bank_card_holds (
            id TEXT PRIMARY KEY, card_id TEXT NOT NULL, account_id TEXT NOT NULL,
            authorization_id TEXT NOT NULL, amount_minor {num} NOT NULL,
            status VARCHAR(12) NOT NULL DEFAULT 'active', release_reason VARCHAR(40),
            expires_at {dt} NOT NULL, created_at {ts} NOT NULL, updated_at {ts} NOT NULL)""",
        f"""CREATE TABLE IF NOT EXISTS bank_card_authorizations (
            id TEXT PRIMARY KEY, card_id TEXT NOT NULL, provider_authorization_id VARCHAR(128) NOT NULL,
            amount_minor {num} NOT NULL, provider_amount_minor {num} NOT NULL, currency VARCHAR(8) NOT NULL,
            merchant_amount_minor {num}, merchant_currency VARCHAR(8), merchant_name VARCHAR(200),
            mcc VARCHAR(8), merchant_country VARCHAR(8), decision VARCHAR(12) NOT NULL,
            decided_by VARCHAR(40) NOT NULL, reason TEXT, hold_id TEXT,
            status VARCHAR(12) NOT NULL DEFAULT 'pending', member_id VARCHAR(64), org_id VARCHAR(64),
            team_id VARCHAR(64), expense_category VARCHAR(64), memo VARCHAR(280),
            receipts {js} NOT NULL DEFAULT {ja}, created_at {ts} NOT NULL, updated_at {ts} NOT NULL)""",
        f"""CREATE TABLE IF NOT EXISTS bank_card_transactions (
            id TEXT PRIMARY KEY, card_id TEXT NOT NULL, authorization_id TEXT,
            provider_transaction_id VARCHAR(128) NOT NULL, type VARCHAR(12) NOT NULL,
            amount_minor {num} NOT NULL, provider_amount_minor {num} NOT NULL, currency VARCHAR(8) NOT NULL,
            merchant_name VARCHAR(200), mcc VARCHAR(8), merchant_country VARCHAR(8), transfer_id TEXT,
            settlement_status VARCHAR(16) NOT NULL DEFAULT 'pending', settlement_error TEXT,
            member_id VARCHAR(64), org_id VARCHAR(64), team_id VARCHAR(64), expense_category VARCHAR(64),
            memo VARCHAR(280), created_at {ts} NOT NULL)""",
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_bank_cardholders_provider ON bank_cardholders(provider, provider_cardholder_id)",
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_bank_cardholders_owner ON bank_cardholders"
        "(owner_type, owner_id, provider, coalesce(member_id, ''))",
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_bank_cards_provider ON bank_cards(provider, provider_card_id)",
        "CREATE INDEX IF NOT EXISTS ix_bank_cards_owner ON bank_cards(owner_type, owner_id, created_at)",
        "CREATE INDEX IF NOT EXISTS ix_bank_cards_account ON bank_cards(account_id)",
        "CREATE INDEX IF NOT EXISTS ix_bank_cards_member ON bank_cards(owner_type, owner_id, member_id)",
        "CREATE INDEX IF NOT EXISTS ix_bank_card_holds_account ON bank_card_holds(account_id, status)",
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_bank_card_holds_auth ON bank_card_holds(authorization_id)",
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_bank_card_auth_provider ON bank_card_authorizations(provider_authorization_id)",
        "CREATE INDEX IF NOT EXISTS ix_bank_card_auth_card ON bank_card_authorizations(card_id, created_at)",
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_bank_card_txn_provider ON bank_card_transactions(provider_transaction_id)",
        "CREATE INDEX IF NOT EXISTS ix_bank_card_txn_card ON bank_card_transactions(card_id, created_at)",
        "CREATE INDEX IF NOT EXISTS ix_bank_card_txn_settle ON bank_card_transactions(settlement_status)",
    ]
