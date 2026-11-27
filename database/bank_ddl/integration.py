"""Bank integration pass B tables (mirrors api-ts db/schema/bankBusiness.ts bankOrgWallets + drizzle 0034_bank_integration.sql)."""


def statements(is_sqlite: bool) -> list[str]:
    ts = "DATETIME DEFAULT CURRENT_TIMESTAMP" if is_sqlite else "TIMESTAMP DEFAULT NOW()"
    return [
        f"""CREATE TABLE IF NOT EXISTS bank_org_wallets (
            org_id TEXT NOT NULL, family VARCHAR(8) NOT NULL, wallet_id INTEGER NOT NULL,
            wallet_user_id INTEGER NOT NULL, address TEXT NOT NULL, turnkey_sub_org_id TEXT NOT NULL,
            turnkey_wallet_id TEXT NOT NULL, created_at {ts} NOT NULL)""",
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_bank_org_wallets_org_family ON bank_org_wallets (org_id, family)",
    ]
