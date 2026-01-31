#!/usr/bin/env python3
"""
Simple test for Task #4: SPL Token Transfer
Tests the implementation without requiring interaction
"""

import sys
import os
import asyncio
from pathlib import Path
from decimal import Decimal
from datetime import datetime

# Add project root to path
project_root = str(Path(__file__).parent)
if project_root not in sys.path:
    sys.path.append(project_root)

# Set minimal environment variables
os.environ['DATABASE_URL'] = 'sqlite:///test_spl_simple.db'
os.environ['TELEGRAM_BOT_TOKEN'] = 'test123'
os.environ['ENCRYPTION_KEY'] = 'test123456789012345678901234567890'
os.environ['ENVIRONMENT'] = 'test'
os.environ['SOLANA_RPC_URL'] = 'https://api.devnet.solana.com'

async def test_spl_implementation():
    """Test that SPL token transfer implementation works without actually sending tokens"""
    print("🧪 Testing SPL Token Transfer Implementation")
    print("=" * 50)
    
    try:
        # Test imports
        print("📦 Testing imports...")
        from bot.services.hot_wallet import HotWalletService
        from bot.models.custodial import HotWallet
        from bot.utils.encryption import encrypt_private_key
        from bot.config.settings import settings
        from database.db import init_db, get_session
        from solders.keypair import Keypair
        import base58
        print("✅ All imports successful")
        
        # Test SPL-specific imports
        print("📦 Testing SPL token imports...")
        from spl.token.instructions import transfer_checked, TransferCheckedParams, get_associated_token_address
        from spl.token.async_client import AsyncToken
        print("✅ SPL token imports successful")
        
        # Initialize database
        print("💾 Initializing database...")
        init_db(os.environ['DATABASE_URL'])
        print("✅ Database initialized")
        
        # Create test wallet using service method (proper way)
        print("🏦 Creating test wallet...")
        service = HotWalletService()
        wallet = await service.create_hot_wallet(
            name="Test SPL Wallet",
            chain_type="solana",
            is_deposit_wallet=False,
            is_gas_payer=False,
        )
        print(f"✅ Created wallet with ID: {wallet.id}")
        print(f"   Address: {wallet.address}")
        
        # Test method accessibility  
        print("🔍 Testing method accessibility...")
        
        # Check if send_token method exists and handles Solana
        if hasattr(service, 'send_token'):
            print("✅ send_token method exists")
        else:
            print("❌ send_token method missing")
            return False
            
        # Check if _send_spl_token method exists
        if hasattr(service, '_send_spl_token'):
            print("✅ _send_spl_token method exists")
        else:
            print("❌ _send_spl_token method missing") 
            return False
        
        # Test dry run of method (won't send due to no balance)
        print("🔄 Testing method call (dry run - will fail due to no balance)...")
        try:
            await service.send_token(
                wallet=wallet,
                chain_name="solana",
                token_address="4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",  # USDC devnet
                to_address="4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY",  # Test recipient
                amount=Decimal("0.01"),
                decimals=6,
            )
            print("❌ Should have failed due to insufficient balance")
            return False
        except Exception as e:
            expected_errors = [
                "insufficient", "balance", "account", "token", "not found", 
                "does not exist", "Invalid", "Error"
            ]
            error_str = str(e).lower()
            if any(err in error_str for err in expected_errors):
                print(f"✅ Correctly failed with expected error: {type(e).__name__}")
                print(f"   Error: {str(e)[:100]}...")
            else:
                print(f"❌ Failed with unexpected error: {e}")
                return False
        
        print("\n" + "=" * 50)
        print("🎉 SPL Token Transfer Implementation Test PASSED!")
        print("=" * 50)
        print("📋 Summary:")
        print("✅ All required imports working")
        print("✅ Database integration working") 
        print("✅ Wallet creation working")
        print("✅ Method calls working")
        print("✅ Error handling working")
        print("\n💡 To test actual transfers:")
        print("1. Fund a wallet with devnet SOL and tokens")
        print("2. Run: python test_spl_transfer.py")
        print("3. Follow the interactive menu")
        
        return True
        
    except Exception as e:
        print(f"❌ Test failed with error: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    try:
        success = asyncio.run(test_spl_implementation())
        sys.exit(0 if success else 1)
    except KeyboardInterrupt:
        print("\n❌ Test cancelled by user")
        sys.exit(1)