"""
Test script for x402 payment on-chain verification.

Tests both native token and ERC20 transfers.
"""

import asyncio
from decimal import Decimal
from bot.services.x402_service import X402Service
from bot.config.settings import settings


async def test_native_payment_verification():
    """Test native ETH payment verification on testnet."""
    print("\n=== Testing Native Token Verification ===")

    x402_service = X402Service()

    # Example testnet transaction (replace with actual testnet tx)
    # This would be a real transaction hash from Base Sepolia or other testnet
    test_tx_hash = "0x..."  # Replace with actual testnet tx hash

    # Test verification
    success, message = x402_service._verify_transaction_on_chain(
        tx_hash=test_tx_hash,
        chain="base",
        expected_recipient=settings.fee_collector_address or "0x...",
        expected_amount=0.001,  # 0.001 ETH
        token_address=None,  # Native token
    )

    print(f"Result: {'✓ PASS' if success else '✗ FAIL'}")
    print(f"Message: {message}")
    return success


async def test_erc20_payment_verification():
    """Test ERC20 (USDC) payment verification on testnet."""
    print("\n=== Testing ERC20 Token Verification ===")

    x402_service = X402Service()

    # Example USDC transfer on Base (replace with actual testnet tx)
    test_tx_hash = "0x..."  # Replace with actual testnet tx hash
    usdc_address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"  # Base USDC

    success, message = x402_service._verify_transaction_on_chain(
        tx_hash=test_tx_hash,
        chain="base",
        expected_recipient=settings.fee_collector_address or "0x...",
        expected_amount=1.0,  # 1 USDC
        token_address=usdc_address,
    )

    print(f"Result: {'✓ PASS' if success else '✗ FAIL'}")
    print(f"Message: {message}")
    return success


async def test_invalid_payment():
    """Test that invalid payments are rejected."""
    print("\n=== Testing Invalid Payment Rejection ===")

    x402_service = X402Service()

    # Test with non-existent transaction
    success, message = x402_service._verify_transaction_on_chain(
        tx_hash="0x0000000000000000000000000000000000000000000000000000000000000000",
        chain="base",
        expected_recipient="0x0000000000000000000000000000000000000000",
        expected_amount=1.0,
        token_address=None,
    )

    print(f"Result: {'✓ PASS (correctly rejected)' if not success else '✗ FAIL (should reject)'}")
    print(f"Message: {message}")
    return not success  # Should fail


async def main():
    """Run all tests."""
    print("=" * 60)
    print("x402 On-Chain Payment Verification Tests")
    print("=" * 60)

    print("\nNOTE: Replace test transaction hashes with actual testnet transactions")
    print("      before running these tests.\n")

    # Uncomment when you have real testnet transactions
    # await test_native_payment_verification()
    # await test_erc20_payment_verification()
    # await test_invalid_payment()

    print("\n" + "=" * 60)
    print("Test Instructions:")
    print("=" * 60)
    print("""
1. Create a test payment on Base Sepolia testnet:
   - Get testnet ETH from faucet: https://www.alchemy.com/faucets/base-sepolia
   - Send a small amount to the fee collector address
   - Copy the transaction hash

2. Update the test_tx_hash variables in this script

3. Run: python test_x402_verification.py

4. Expected results:
   - Valid transactions should return success=True
   - Invalid transactions should return success=False
   - Amount verification should allow 1% tolerance

5. Check the logs for detailed verification steps
""")


if __name__ == "__main__":
    asyncio.run(main())
