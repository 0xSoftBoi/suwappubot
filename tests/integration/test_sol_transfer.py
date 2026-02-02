"""
Test script for Solana native SOL transfers from hot wallets.

Tests SOL transfer on Solana devnet.
"""

import asyncio
import pytest
from decimal import Decimal
from bot.services.hot_wallet import HotWalletService
from database.db import init_db, get_session
from bot.models.custodial import HotWallet


@pytest.fixture(autouse=True)
def _init_db(tmp_path):
    """Ensure database is initialised for every test in this module."""
    db_url = f"sqlite:///{tmp_path}/test.db"
    init_db(db_url)


async def test_create_solana_hot_wallet():
    """Create a test Solana hot wallet."""
    print("\n=== Creating Solana Hot Wallet ===")

    service = HotWalletService()

    # Create hot wallet
    wallet = await service.create_hot_wallet(
        name="test_sol_wallet",
        chain_type="solana",
        is_deposit_wallet=False,
        is_gas_payer=False,
    )

    print(f"✓ Wallet created:")
    print(f"  Address: {wallet.address}")
    print(f"  Chain: {wallet.chain_type}")
    print(f"  ID: {wallet.id}")

    print(f"\n⚠️  IMPORTANT: Fund this wallet with devnet SOL:")
    print(f"  1. Visit: https://faucet.solana.com/")
    print(f"  2. Enter address: {wallet.address}")
    print(f"  3. Request devnet SOL (2 SOL)")

    return wallet


async def _check_balance(wallet_address: str):
    """Check SOL balance of wallet (helper, not a direct pytest target)."""
    print(f"\n=== Checking SOL Balance ===")

    from solana.rpc.async_api import AsyncClient
    from solders.pubkey import Pubkey
    from bot.config.settings import settings

    rpc_url = getattr(settings, 'solana_rpc_url', 'https://api.devnet.solana.com')

    async with AsyncClient(rpc_url) as client:
        pubkey = Pubkey.from_string(wallet_address)
        balance_resp = await client.get_balance(pubkey)
        lamports = balance_resp.value
        sol = lamports / 10**9

        print(f"Address: {wallet_address}")
        print(f"Balance: {sol} SOL ({lamports} lamports)")

        return sol


async def _send_sol(wallet_id: int, to_address: str, amount: float):
    """Send SOL from hot wallet (helper, not a direct pytest target)."""
    print(f"\n=== Testing SOL Transfer ===")

    service = HotWalletService()

    # Get wallet from database
    with get_session() as session:
        wallet = session.query(HotWallet).filter(HotWallet.id == wallet_id).first()
        if not wallet:
            print("✗ Wallet not found")
            return None

    print(f"From: {wallet.address}")
    print(f"To: {to_address}")
    print(f"Amount: {amount} SOL")

    try:
        # Send SOL
        signature = await service.send_native_token(
            wallet=wallet,
            chain_name="solana",
            to_address=to_address,
            amount=Decimal(str(amount)),
        )

        print(f"\n✓ Transfer successful!")
        print(f"Signature: {signature}")
        print(f"\nView on explorer:")
        print(f"https://explorer.solana.com/tx/{signature}?cluster=devnet")

        return signature

    except Exception as e:
        print(f"\n✗ Transfer failed: {e}")
        import traceback
        traceback.print_exc()
        return None


async def main():
    """Run Solana transfer tests."""
    print("=" * 70)
    print("Solana Native SOL Transfer Tests (Devnet)")
    print("=" * 70)

    # Step 1: Create wallet (or use existing)
    print("\nWould you like to:")
    print("1. Create a new test wallet")
    print("2. Use an existing wallet (enter wallet ID)")
    print("3. Just see instructions")

    choice = input("\nChoice (1/2/3): ").strip()

    if choice == "1":
        wallet = await test_create_solana_hot_wallet()
        print("\nNext steps:")
        print("1. Fund the wallet using the faucet link above")
        print("2. Wait ~30 seconds for confirmation")
        print("3. Run this script again with option 2")
        print(f"   Use wallet ID: {wallet.id}")

    elif choice == "2":
        wallet_id = int(input("Enter wallet ID: ").strip())

        # Check if wallet exists
        with get_session() as session:
            wallet = session.query(HotWallet).filter(HotWallet.id == wallet_id).first()
            if not wallet:
                print(f"✗ Wallet {wallet_id} not found")
                return

        # Check balance
        balance = await _check_balance(wallet.address)

        if balance < 0.1:
            print(f"\n⚠️  Insufficient balance: {balance} SOL")
            print("Please fund wallet before testing transfers")
            return

        # Get recipient
        print("\nEnter recipient address (or press Enter for test address):")
        to_address = input("> ").strip()
        if not to_address:
            # Default test recipient (devnet faucet address)
            to_address = "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY"
            print(f"Using test address: {to_address}")

        # Get amount
        amount_str = input("Amount to send (SOL, e.g., 0.01): ").strip()
        amount = float(amount_str)

        if amount > balance - 0.005:  # Leave some for fees
            print(f"✗ Amount too high (need to leave SOL for fees)")
            return

        # Send transaction
        await _send_sol(wallet_id, to_address, amount)

    else:
        print("\n" + "=" * 70)
        print("Test Instructions:")
        print("=" * 70)
        print("""
Step 1: Create Test Wallet
---------------------------
Run this script and choose option 1 to create a Solana hot wallet.

Step 2: Fund Wallet
---------------------------
Visit: https://faucet.solana.com/
Enter the wallet address from step 1
Request devnet SOL (2 SOL)

Step 3: Test Transfer
---------------------------
Run this script and choose option 2
Enter the wallet ID from step 1
Enter a recipient address (or use the default test address)
Enter amount to send (e.g., 0.01)

Step 4: Verify
---------------------------
Check the Solana explorer link to verify the transaction
Signature should start with base58 characters
Transaction should show as "Success" on devnet explorer

Expected Results:
- Transfer should complete in ~30 seconds
- Signature should be returned
- Balance should decrease by amount + fees (~0.000005 SOL)
- Transaction visible on explorer

Troubleshooting:
- "Wallet not found": Create wallet first (option 1)
- "Insufficient balance": Fund wallet from faucet
- "Invalid address": Check recipient address format
- "RPC URL not configured": Set SOLANA_RPC_URL in .env
        """)


if __name__ == "__main__":
    asyncio.run(main())
