#!/usr/bin/env python3
"""
Backfill encrypted backup keys for existing Turnkey wallets.

Iterates all Turnkey wallets that don't have a backup key exported yet,
exports the private key from Turnkey, encrypts with KMS, and stores it.

Usage:
    python scripts/backfill_turnkey_exports.py --dry-run      # Preview
    python scripts/backfill_turnkey_exports.py --limit 10     # Process 10
    python scripts/backfill_turnkey_exports.py                 # Process all
"""

import asyncio
import argparse
import logging
import sys
import os

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


async def main():
    parser = argparse.ArgumentParser(description="Backfill Turnkey wallet backup keys")
    parser.add_argument("--dry-run", action="store_true", help="Preview without making changes")
    parser.add_argument("--limit", type=int, default=0, help="Max wallets to process (0 = all)")
    args = parser.parse_args()

    from bot.config.settings import settings
    from database.db import init_db, get_session
    from bot.models.user import Wallet
    from bot.services.turnkey_client import get_turnkey_client
    from bot.services.turnkey_export import export_and_backup_wallet

    # Initialize database
    if not init_db(settings.database_url):
        logger.error("Failed to initialize database")
        sys.exit(1)

    # Find Turnkey wallets without backup
    with get_session() as session:
        query = session.query(Wallet).filter(
            Wallet.wallet_provider == "turnkey",
            Wallet.turnkey_wallet_id.isnot(None),
            Wallet.backup_key_exported_at.is_(None),
        )
        wallets = query.all()

    total = len(wallets)
    if args.limit > 0:
        wallets = wallets[:args.limit]

    logger.info(f"Found {total} Turnkey wallets without backup. Processing {len(wallets)}.")

    if args.dry_run:
        for w in wallets:
            logger.info(f"  [DRY RUN] Would export wallet {w.id} ({w.address[:10]}...) "
                        f"turnkey_wallet_id={w.turnkey_wallet_id}")
        logger.info(f"Dry run complete. {len(wallets)} wallets would be processed.")
        return

    client = get_turnkey_client()
    success = 0
    failed = 0

    for w in wallets:
        try:
            with get_session() as session:
                wallet = session.query(Wallet).filter(Wallet.id == w.id).first()
                if not wallet:
                    continue
                ok = await export_and_backup_wallet(wallet, client, session)
                if ok:
                    success += 1
                else:
                    failed += 1
        except Exception as e:
            logger.error(f"Failed to export wallet {w.id}: {e}")
            failed += 1

    logger.info(f"Backfill complete. Success: {success}, Failed: {failed}, Total: {total}")


if __name__ == "__main__":
    asyncio.run(main())
