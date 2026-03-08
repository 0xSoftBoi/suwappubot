#!/usr/bin/env python3
"""
Test script for Turnkey wallet integration.

Run with: python test_turnkey_integration.py
"""

import asyncio
import sys
import os

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dotenv import load_dotenv
load_dotenv()


async def test_turnkey_integration():
    """Run Turnkey integration tests."""
    print("=" * 60)
    print("TURNKEY INTEGRATION TEST")
    print("=" * 60)
    
    # Check settings
    from bot.config.settings import settings
    
    print("\n1. Checking configuration...")
    print(f"   Wallet Provider: {settings.wallet_provider}")
    print(f"   Organization ID: {settings.turnkey_organization_id or '(not set)'}")
    print(f"   API Public Key: {settings.turnkey_api_public_key[:20] + '...' if settings.turnkey_api_public_key else '(not set)'}")
    print(f"   API Private Key: {'*' * 20 if settings.turnkey_api_private_key else '(not set)'}")
    print(f"   Base URL: {settings.turnkey_base_url}")
    
    # Check if configured
    from bot.services.turnkey_client import is_turnkey_configured
    
    if not is_turnkey_configured():
        print("\n❌ Turnkey is NOT configured.")
        print("   Set WALLET_PROVIDER=turnkey and provide Turnkey credentials in .env")
        return False
    
    print("\n✅ Turnkey configuration found!")
    
    # Test client initialization
    print("\n2. Testing client initialization...")
    try:
        from bot.services.turnkey_client import get_turnkey_client, reset_turnkey_client
        reset_turnkey_client()
        client = get_turnkey_client()
        print(f"   ✅ Client initialized for org: {client._org_id}")
    except Exception as e:
        print(f"   ❌ Client initialization failed: {e}")
        return False
    
    # Test stamp creation (no network required)
    print("\n3. Testing API signature (stamp) creation...")
    try:
        import base64
        import json
        stamp_b64 = client._create_stamp('{"test":"body"}')
        # Decode the base64 stamp to verify it
        stamp_json = base64.urlsafe_b64decode(stamp_b64 + "==")
        stamp = json.loads(stamp_json)
        print(f"   ✅ Stamp created successfully")
        print(f"   - Scheme: {stamp['scheme']}")
        print(f"   - Public Key: {stamp['publicKey'][:30]}...")
        print(f"   - Signature: {stamp['signature'][:30]}...")
    except Exception as e:
        print(f"   ❌ Stamp creation failed: {e}")
        return False
    
    # Test API connectivity
    print("\n4. Testing API connectivity...")
    try:
        # Try to list wallets (read-only operation)
        wallets = await client.list_wallets()
        print(f"   ✅ API connection successful!")
        print(f"   - Found {len(wallets)} existing wallet(s) in organization")
        
        for i, w in enumerate(wallets[:3]):  # Show max 3
            print(f"   - Wallet {i+1}: {w.get('walletName', 'unnamed')} (ID: {w.get('walletId', 'unknown')[:20]}...)")
        
        if len(wallets) > 3:
            print(f"   - ... and {len(wallets) - 3} more")
            
    except Exception as e:
        print(f"   ❌ API connection failed: {e}")
        print(f"   - Check your Organization ID and API keys")
        return False
    
    # Ask about creating test wallet
    print("\n5. Wallet creation test...")
    response = input("   Create a test EVM wallet? (y/N): ").strip().lower()
    
    if response == 'y':
        try:
            import time
            print("   Creating test wallet via Turnkey...")
            wallet = await client.create_wallet(
                wallet_name=f"test_wallet_{int(time.time())}",
                chain_type="evm",
            )
            print(f"   ✅ Wallet created successfully!")
            print(f"   - Wallet ID: {wallet.wallet_id}")
            print(f"   - Address: {wallet.address}")
            print(f"   - Account ID: {wallet.account_id}")
        except Exception as e:
            print(f"   ❌ Wallet creation failed: {e}")
            return False
    else:
        print("   Skipped wallet creation.")
    
    print("\n" + "=" * 60)
    print("✅ ALL TESTS PASSED!")
    print("=" * 60)
    print("\nTurnkey integration is working correctly.")
    print("You can now create wallets with: WALLET_PROVIDER=turnkey")
    
    return True


if __name__ == "__main__":
    success = asyncio.run(test_turnkey_integration())
    sys.exit(0 if success else 1)

