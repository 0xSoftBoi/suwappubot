"""Bank M9 business tables (mirrors api-ts db/schema/bankBusiness.ts + drizzle 0031_bank_business.sql)."""


def statements(is_sqlite: bool) -> list[str]:
    ts = "DATETIME DEFAULT CURRENT_TIMESTAMP" if is_sqlite else "TIMESTAMP DEFAULT NOW()"
    dt = "DATETIME" if is_sqlite else "TIMESTAMP"
    js = "TEXT" if is_sqlite else "JSONB"
    jd = "'{}'" if is_sqlite else "'{}'::jsonb"
    num = "NUMERIC" if is_sqlite else "NUMERIC(78,0)"
    t = [
        f"""CREATE TABLE IF NOT EXISTS bank_orgs (
            id TEXT PRIMARY KEY, name VARCHAR(200) NOT NULL, reporting_currency VARCHAR(8) NOT NULL DEFAULT 'USD',
            owner_user_id INTEGER NOT NULL, custody_user_id INTEGER NOT NULL, enterprise_org_id VARCHAR(64),
            closed_through {dt}, created_at {ts} NOT NULL, updated_at {ts} NOT NULL)""",
        f"""CREATE TABLE IF NOT EXISTS bank_org_members (
            id TEXT PRIMARY KEY, org_id TEXT NOT NULL, user_id INTEGER NOT NULL, role VARCHAR(16) NOT NULL,
            team VARCHAR(64), invited_by INTEGER, created_at {ts} NOT NULL)""",
        f"""CREATE TABLE IF NOT EXISTS bank_org_invites (
            id TEXT PRIMARY KEY, org_id TEXT NOT NULL, role VARCHAR(16) NOT NULL, team VARCHAR(64),
            email VARCHAR(200), token_hash VARCHAR(64) NOT NULL, expires_at {dt} NOT NULL,
            created_by INTEGER NOT NULL, accepted_by INTEGER, accepted_at {dt}, revoked_at {dt},
            created_at {ts} NOT NULL)""",
        f"""CREATE TABLE IF NOT EXISTS bank_org_audit (
            id TEXT PRIMARY KEY, org_id TEXT NOT NULL, actor_user_id INTEGER, actor_kind VARCHAR(8) NOT NULL,
            actor_agent_id VARCHAR(64), action VARCHAR(64) NOT NULL, target_type VARCHAR(32),
            target_id VARCHAR(96), detail {js} NOT NULL DEFAULT {jd}, created_at {ts} NOT NULL)""",
        f"""CREATE TABLE IF NOT EXISTS bank_approval_policies (
            id TEXT PRIMARY KEY, org_id TEXT NOT NULL, rule_type VARCHAR(24) NOT NULL, threshold_minor {num},
            required_approvals INTEGER NOT NULL DEFAULT 1, approver_roles {js} NOT NULL,
            expiry_hours INTEGER NOT NULL DEFAULT 72, enabled INTEGER NOT NULL DEFAULT 1,
            created_by INTEGER NOT NULL, created_at {ts} NOT NULL)""",
        f"""CREATE TABLE IF NOT EXISTS bank_approval_requests (
            id TEXT PRIMARY KEY, org_id TEXT NOT NULL, action VARCHAR(32) NOT NULL, payload {js} NOT NULL,
            payload_hash VARCHAR(64) NOT NULL, requested_by INTEGER NOT NULL,
            status VARCHAR(12) NOT NULL DEFAULT 'pending', policy_id TEXT, required_approvals INTEGER NOT NULL,
            approver_roles {js} NOT NULL, expires_at {dt} NOT NULL, decided_at {dt}, consumed_at {dt},
            created_at {ts} NOT NULL)""",
        f"""CREATE TABLE IF NOT EXISTS bank_approval_decisions (
            id TEXT PRIMARY KEY, request_id TEXT NOT NULL, user_id INTEGER NOT NULL, role VARCHAR(16) NOT NULL,
            decision VARCHAR(8) NOT NULL, comment VARCHAR(280), created_at {ts} NOT NULL)""",
        f"""CREATE TABLE IF NOT EXISTS bank_org_payees (
            id TEXT PRIMARY KEY, org_id TEXT NOT NULL, address VARCHAR(128) NOT NULL, chain VARCHAR(32) NOT NULL,
            label VARCHAR(120), added_by INTEGER, created_at {ts} NOT NULL)""",
        f"""CREATE TABLE IF NOT EXISTS bank_treasury_policies (
            id TEXT PRIMARY KEY, org_id TEXT NOT NULL, account_id TEXT NOT NULL,
            floor_minor {num} NOT NULL DEFAULT 0, sweep_enabled INTEGER NOT NULL DEFAULT 0,
            sweep_vault_id VARCHAR(96), min_sweep_minor {num} NOT NULL DEFAULT 0, updated_by INTEGER,
            updated_at {ts} NOT NULL)""",
        f"""CREATE TABLE IF NOT EXISTS bank_org_vendors (
            id TEXT PRIMARY KEY, org_id TEXT NOT NULL, name VARCHAR(200) NOT NULL, email VARCHAR(200),
            pay_address VARCHAR(128), pay_chain VARCHAR(32), category_id TEXT,
            metadata {js} NOT NULL DEFAULT {jd}, created_by INTEGER, created_at {ts} NOT NULL)""",
        f"""CREATE TABLE IF NOT EXISTS bank_org_bills (
            id TEXT PRIMARY KEY, org_id TEXT NOT NULL, vendor_id TEXT NOT NULL, reference VARCHAR(120),
            amount_minor {num} NOT NULL, asset VARCHAR(16) NOT NULL, chain VARCHAR(32) NOT NULL,
            due_date {dt} NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'unpaid', pay_from_account_id TEXT,
            scheduled_for {dt}, category_id TEXT, approval_request_id TEXT, transfer_id TEXT,
            attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, created_by INTEGER NOT NULL,
            scheduled_by INTEGER, paid_at {dt}, created_at {ts} NOT NULL)""",
        f"""CREATE TABLE IF NOT EXISTS bank_org_dunning (
            id TEXT PRIMARY KEY, org_id TEXT NOT NULL, invoice_id VARCHAR(96) NOT NULL,
            stage INTEGER NOT NULL DEFAULT 0, status VARCHAR(12) NOT NULL DEFAULT 'active',
            last_stage_at {dt}, next_stage_at {dt}, updated_at {ts} NOT NULL)""",
        f"""CREATE TABLE IF NOT EXISTS bank_org_categories (
            id TEXT PRIMARY KEY, org_id TEXT NOT NULL, code VARCHAR(16) NOT NULL, name VARCHAR(120) NOT NULL,
            kind VARCHAR(12) NOT NULL, created_at {ts} NOT NULL)""",
        f"""CREATE TABLE IF NOT EXISTS bank_org_books (
            id TEXT PRIMARY KEY, org_id TEXT NOT NULL, ledger_entry_id TEXT NOT NULL, transfer_id TEXT NOT NULL,
            account_id TEXT NOT NULL, direction VARCHAR(6) NOT NULL, scope VARCHAR(10) NOT NULL,
            amount_minor {num} NOT NULL, asset VARCHAR(16) NOT NULL, reporting_currency VARCHAR(8) NOT NULL,
            rate VARCHAR(40) NOT NULL, rate_source VARCHAR(48) NOT NULL, rate_at {dt} NOT NULL,
            reporting_minor {num} NOT NULL, category_id TEXT, memo VARCHAR(280), occurred_at {dt} NOT NULL,
            rate_lag_seconds INTEGER NOT NULL DEFAULT 0, created_at {ts} NOT NULL)""",
        f"""CREATE TABLE IF NOT EXISTS bank_org_card_budgets (
            id TEXT PRIMARY KEY, org_id TEXT NOT NULL, scope VARCHAR(8) NOT NULL, scope_id VARCHAR(64) NOT NULL,
            monthly_cap_minor {num}, per_tx_cap_minor {num}, category_budgets {js} NOT NULL DEFAULT {jd},
            updated_by INTEGER, updated_at {ts} NOT NULL)""",
    ]
    idx = [
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_bank_org_members_org_user ON bank_org_members(org_id, user_id)",
        "CREATE INDEX IF NOT EXISTS ix_bank_org_members_user ON bank_org_members(user_id)",
        "CREATE INDEX IF NOT EXISTS ix_bank_org_invites_org ON bank_org_invites(org_id)",
        "CREATE INDEX IF NOT EXISTS ix_bank_org_audit_org ON bank_org_audit(org_id, created_at)",
        "CREATE INDEX IF NOT EXISTS ix_bank_approval_policies_org ON bank_approval_policies(org_id)",
        "CREATE INDEX IF NOT EXISTS ix_bank_approval_requests_org ON bank_approval_requests(org_id, status, created_at)",
        "CREATE INDEX IF NOT EXISTS ix_bank_approval_requests_hash ON bank_approval_requests(org_id, action, payload_hash)",
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_bank_approval_decisions_req_user ON bank_approval_decisions(request_id, user_id)",
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_bank_org_payees ON bank_org_payees(org_id, chain, address)",
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_bank_treasury_policies_acct ON bank_treasury_policies(org_id, account_id)",
        "CREATE INDEX IF NOT EXISTS ix_bank_org_vendors_org ON bank_org_vendors(org_id)",
        "CREATE INDEX IF NOT EXISTS ix_bank_org_bills_org ON bank_org_bills(org_id, status, due_date)",
        "CREATE INDEX IF NOT EXISTS ix_bank_org_bills_sched ON bank_org_bills(status, scheduled_for)",
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_bank_org_dunning ON bank_org_dunning(org_id, invoice_id)",
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_bank_org_categories ON bank_org_categories(org_id, code)",
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_bank_org_books_entry ON bank_org_books(ledger_entry_id)",
        "CREATE INDEX IF NOT EXISTS ix_bank_org_books_org ON bank_org_books(org_id, occurred_at)",
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_bank_org_card_budgets ON bank_org_card_budgets(org_id, scope, scope_id)",
    ]
    return t + idx
