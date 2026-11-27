"""Bank M10-M13 tables (mirrors api-ts db/schema/bankAgentsPlatform.ts + drizzle 0032)."""


def statements(is_sqlite: bool) -> list[str]:
    ts = "DATETIME DEFAULT CURRENT_TIMESTAMP" if is_sqlite else "TIMESTAMP DEFAULT NOW()"
    dt = "DATETIME" if is_sqlite else "TIMESTAMP"
    js = "TEXT" if is_sqlite else "JSONB"
    ja = "'[]'" if is_sqlite else "'[]'::jsonb"
    jo = "'{}'" if is_sqlite else "'{}'::jsonb"
    num = "NUMERIC" if is_sqlite else "NUMERIC(78,0)"
    return [
        f"""CREATE TABLE IF NOT EXISTS bank_agent_mandates (
            id text PRIMARY KEY, agent_id varchar(64) NOT NULL, account_id text NOT NULL, per_call_max_minor {num} NOT NULL, daily_cap_minor {num} NOT NULL, allowed_hosts {js} NOT NULL DEFAULT {ja}, allowed_payees {js} NOT NULL DEFAULT {ja}, allowed_assets {js} NOT NULL DEFAULT {ja}, expires_at {dt}, status varchar(16) NOT NULL DEFAULT 'active', created_at {ts} NOT NULL, updated_at {ts} NOT NULL)""",
        f"""CREATE TABLE IF NOT EXISTS bank_agent_spend (
            id text PRIMARY KEY, mandate_id text NOT NULL, agent_id varchar(64) NOT NULL, account_id text NOT NULL, host varchar(255) NOT NULL, payee varchar(128) NOT NULL, asset varchar(16) NOT NULL, chain varchar(32) NOT NULL, amount_minor {num} NOT NULL, status varchar(16) NOT NULL DEFAULT 'reserved', transfer_id text, tx_hash varchar(128), resource_url text, created_at {ts} NOT NULL, updated_at {ts} NOT NULL)""",
        f"""CREATE TABLE IF NOT EXISTS bank_agent_resources (
            id text PRIMARY KEY, seller_agent_id varchar(64) NOT NULL, account_id text NOT NULL, slug varchar(64) NOT NULL, title varchar(120) NOT NULL, description text, upstream_url text NOT NULL, price_minor {num} NOT NULL, asset varchar(16) NOT NULL, chain varchar(32) NOT NULL, status varchar(16) NOT NULL DEFAULT 'active', created_at {ts} NOT NULL, updated_at {ts} NOT NULL)""",
        f"""CREATE TABLE IF NOT EXISTS bank_agent_resource_sales (
            id text PRIMARY KEY, resource_id text NOT NULL, payer varchar(128) NOT NULL, tx_hash varchar(128) NOT NULL, amount_minor {num} NOT NULL, asset varchar(16) NOT NULL, chain varchar(32) NOT NULL, credited varchar(5) NOT NULL DEFAULT 'false', created_at {ts} NOT NULL)""",
        f"""CREATE TABLE IF NOT EXISTS bank_partners (
            org_id varchar(64) PRIMARY KEY, fee_bps_transfer integer NOT NULL DEFAULT 0, fee_bps_fx integer NOT NULL DEFAULT 0, revenue_account_id text, webhook_url text, webhook_secret varchar(128), status varchar(16) NOT NULL DEFAULT 'active', created_at {ts} NOT NULL, updated_at {ts} NOT NULL)""",
        f"""CREATE TABLE IF NOT EXISTS bank_partner_customers (
            id text PRIMARY KEY, partner_id varchar(64) NOT NULL, external_ref varchar(128) NOT NULL, display_name varchar(200), email varchar(254), country varchar(2), status varchar(16) NOT NULL DEFAULT 'active', metadata {js} NOT NULL DEFAULT {jo}, created_at {ts} NOT NULL)""",
        f"""CREATE TABLE IF NOT EXISTS bank_partner_events (
            id text PRIMARY KEY, partner_id varchar(64) NOT NULL, event varchar(64) NOT NULL, payload {js} NOT NULL DEFAULT {jo}, status varchar(12) NOT NULL DEFAULT 'pending', attempts integer NOT NULL DEFAULT 0, next_attempt_at {ts} NOT NULL, last_error text, delivered_at {dt}, created_at {ts} NOT NULL)""",
        f"""CREATE TABLE IF NOT EXISTS bank_payment_addresses (
            handle varchar(64) PRIMARY KEY, owner_type varchar(24) NOT NULL, owner_id varchar(64) NOT NULL, document {js} NOT NULL, signature text, signer varchar(64), signature_scheme varchar(16), created_at {ts} NOT NULL, updated_at {ts} NOT NULL)""",
        f"""CREATE TABLE IF NOT EXISTS bank_stealth_view_keys (
            id text PRIMARY KEY, owner_type varchar(24) NOT NULL, owner_id varchar(64) NOT NULL, secret varchar(66) NOT NULL, created_at {ts} NOT NULL)""",
        f"""CREATE TABLE IF NOT EXISTS bank_stealth_payouts (
            id text PRIMARY KEY, owner_type varchar(24) NOT NULL, owner_id varchar(64) NOT NULL, payout_ref varchar(128) NOT NULL, stealth_address varchar(42) NOT NULL, ephemeral_pub varchar(68) NOT NULL, view_tag varchar(4) NOT NULL, payee_meta varchar(140) NOT NULL, chain varchar(32), announce_tx varchar(128), created_at {ts} NOT NULL)""",
        "CREATE INDEX IF NOT EXISTS ix_bank_agent_mandates_agent ON bank_agent_mandates(agent_id)",
        "CREATE INDEX IF NOT EXISTS ix_bank_agent_spend_mandate ON bank_agent_spend(mandate_id, created_at)",
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_bank_agent_resources_slug ON bank_agent_resources(slug)",
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_bank_agent_sales_tx ON bank_agent_resource_sales(tx_hash)",
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_bank_partner_customers_ref ON bank_partner_customers(partner_id, external_ref)",
        "CREATE INDEX IF NOT EXISTS ix_bank_partner_events_due ON bank_partner_events(status, next_attempt_at)",
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_bank_stealth_payouts_ref ON bank_stealth_payouts(owner_type, owner_id, payout_ref)",
    ]
