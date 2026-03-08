import asyncio
import sys
import os

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from bot.services.hot_wallet import hot_wallet_service
from bot.config.settings import settings
from bot.config.chains import CHAINS
from bot.models.custodial import GasSponsorshipConfig
from database.db import get_session, init_db

async def init_hot_wallets():
    print("Initializing Hot Wallets via Turnkey...")
    init_db(settings.database_url) # Ensure DB is initialized with URL
    
    # 1. Initialize Gas Sponsorship Config for all chains
    with get_session() as session:
        for chain_name in CHAINS:
            # Check if config already exists
            existing = session.query(GasSponsorshipConfig).filter(GasSponsorshipConfig.chain == chain_name).first()
            if not existing:
                print(f"Creating Gas Sponsorship Config for {chain_name}...")
                config = GasSponsorshipConfig(
                    chain=chain_name,
                    is_enabled=True,
                    max_gas_per_tx_usd=5.0,
                    max_gas_per_user_daily_usd=20.0
                )
                session.add(config)
        session.commit()
    
    import time
    ts = int(time.time())
    
    # 1. EVM Deposit Wallet
    try:
        print("Creating EVM Deposit Wallet...")
        evm_wallet = await hot_wallet_service.create_hot_wallet(
            name=f"Primary EVM Deposit {ts}",
            chain_type="evm",
            is_deposit_wallet=True,
            is_gas_payer=True
        )
        print(f"✅ Created EVM Wallet: {evm_wallet.address}")
    except Exception as e:
        print(f"❌ Failed to create EVM Wallet: {e}")

    # 2. Solana Deposit Wallet
    try:
        print("Creating Solana Deposit Wallet...")
        sol_wallet = await hot_wallet_service.create_hot_wallet(
            name=f"Primary SOL Deposit {ts}",
            chain_type="solana",
            is_deposit_wallet=True,
            is_gas_payer=False
        )
        print(f"✅ Created Solana Wallet: {sol_wallet.address}")
    except Exception as e:
        print(f"❌ Failed to create Solana Wallet: {e}")

if __name__ == "__main__":
    asyncio.run(init_hot_wallets())

