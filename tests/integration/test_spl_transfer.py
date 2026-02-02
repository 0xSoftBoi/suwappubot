#!/usr/bin/env python3
"""
Task #4: Test SPL Token Transfer Implementation

This test verifies the SPL token transfer functionality in the hot wallet service,
which builds on Task #3 (native SOL transfers) to support transferring actual
SPL tokens like USDC, USDT, etc. on Solana.
"""

import sys
import os
import json
import asyncio
from pathlib import Path
from decimal import Decimal
from datetime import datetime

# Add project root to path
project_root = str(Path(__file__).parent)
if project_root not in sys.path:
    sys.path.append(project_root)

# Set minimal environment variables
os.environ['DATABASE_URL'] = 'sqlite:///test_spl.db'
os.environ['TELEGRAM_BOT_TOKEN'] = 'test123'
os.environ['ENCRYPTION_KEY'] = 'test123456789012345678901234567890'
os.environ['ENVIRONMENT'] = 'test'
os.environ['SOLANA_RPC_URL'] = 'https://api.devnet.solana.com'

# Import after setting environment
from database.db import init_db, get_session
from bot.models.custodial import HotWallet
from bot.services.hot_wallet import HotWalletService
from bot.utils.encryption import encrypt_private_key
from solders.keypair import Keypair
import base58


# Common Solana devnet SPL tokens for testing
DEVNET_TOKENS = {
    "USDC": {
        "address": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",  # USDC on devnet
        "decimals": 6,
        "name": "USD Coin (devnet)"
    },
    "USDT": {
        "address": "EJwZgeZrdC8TXTQbQBoL6bfuAnFUUy1PVCMB4DYPzVaS",  # USDT on devnet  
        "decimals": 6,
        "name": "Tether USD (devnet)"
    }
}

# Test recipient address (devnet)
TEST_RECIPIENT = "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY"


class Colors:
    """ANSI color codes for terminal output"""
    GREEN = '\033[92m'
    RED = '\033[91m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    BOLD = '\033[1m'
    END = '\033[0m'

def print_header(text):
    print(f"\n{Colors.BOLD}{Colors.BLUE}{text}{Colors.END}")

def print_success(text):
    print(f"{Colors.GREEN}✅ {text}{Colors.END}")

def print_error(text):
    print(f"{Colors.RED}❌ {text}{Colors.END}")

def print_warning(text):
    print(f"{Colors.YELLOW}⚠️ {text}{Colors.END}")

def print_info(text):
    print(f"ℹ️ {text}")


async def create_test_wallet() -> HotWallet:
    """Create a new Solana hot wallet for testing"""
    print_header("Creating Test Solana Hot Wallet")
    
    try:
        init_db(os.environ['DATABASE_URL'])
        service = HotWalletService()
        
        # Use service method for proper wallet creation
        wallet = await service.create_hot_wallet(
            name="Test SPL Wallet",
            chain_type="solana",
            is_deposit_wallet=False,
            is_gas_payer=False,
        )
        
        print_success(f"Created wallet with ID: {wallet.id}")
        print_info(f"Address: {wallet.address}")
        
        return wallet
            
    except Exception as e:
        print_error(f"Failed to create wallet: {e}")
        raise


async def check_wallet_balance(address: str, token_address: str = None):
    """Check balance of wallet (SOL or SPL token)"""
    from solana.rpc.async_api import AsyncClient
    from solders.pubkey import Pubkey
    from spl.token.instructions import get_associated_token_address
    
    rpc_url = os.environ['SOLANA_RPC_URL']
    
    try:
        async with AsyncClient(rpc_url) as client:
            if token_address:
                # Check SPL token balance
                mint_pubkey = Pubkey.from_string(token_address)
                wallet_pubkey = Pubkey.from_string(address)
                ata = get_associated_token_address(wallet_pubkey, mint_pubkey)
                
                try:
                    response = await client.get_token_account_balance(ata)
                    if response.value:
                        balance = Decimal(response.value.amount) / Decimal(10 ** response.value.decimals)
                        return balance
                    else:
                        return Decimal("0")
                except Exception as e:
                    print_warning(f"Token account may not exist: {e}")
                    return Decimal("0")
            else:
                # Check SOL balance
                pubkey = Pubkey.from_string(address)
                response = await client.get_balance(pubkey)
                lamports = response.value
                return Decimal(lamports) / Decimal(10**9)  # Convert to SOL
                
    except Exception as e:
        print_error(f"Failed to check balance: {e}")
        return None


async def run_spl_token_transfer(wallet: HotWallet, token_symbol: str, amount: Decimal):
    """Run SPL token transfer (interactive helper, not a direct pytest target)."""
    print_header(f"Testing SPL Token Transfer: {token_symbol}")
    
    if token_symbol not in DEVNET_TOKENS:
        print_error(f"Unknown token: {token_symbol}")
        return False
    
    token_info = DEVNET_TOKENS[token_symbol]
    token_address = token_info["address"]
    decimals = token_info["decimals"]
    
    print_info(f"Token: {token_info['name']}")
    print_info(f"Address: {token_address}")
    print_info(f"Decimals: {decimals}")
    print_info(f"Amount to transfer: {amount}")
    print_info(f"Recipient: {TEST_RECIPIENT}")
    
    try:
        service = HotWalletService()
        
        # Check initial balance
        print_info("Checking initial token balance...")
        initial_balance = await check_wallet_balance(wallet.address, token_address)
        if initial_balance is None:
            print_error("Failed to check initial balance")
            return False
        
        print_info(f"Initial {token_symbol} balance: {initial_balance}")
        
        if initial_balance < amount:
            print_warning(f"Insufficient balance! Need {amount} {token_symbol}, have {initial_balance}")
            print_warning("Please fund the wallet with test tokens first.")
            print_info(f"Wallet address: {wallet.address}")
            print_info(f"Token mint: {token_address}")
            print_info("You can get devnet tokens from various faucets or Solana Discord")
            return False
        
        # Execute SPL token transfer
        print_info("Executing SPL token transfer...")
        signature = await service.send_token(
            wallet=wallet,
            chain_name="solana",
            token_address=token_address,
            to_address=TEST_RECIPIENT,
            amount=amount,
            decimals=decimals,
        )
        
        print_success(f"Transfer successful!")
        print_info(f"Transaction signature: {signature}")
        print_info(f"Explorer: https://explorer.solana.com/tx/{signature}?cluster=devnet")
        
        # Wait a moment and check final balance
        print_info("Waiting 5 seconds for confirmation...")
        await asyncio.sleep(5)
        
        final_balance = await check_wallet_balance(wallet.address, token_address)
        if final_balance is not None:
            transferred = initial_balance - final_balance
            print_info(f"Final {token_symbol} balance: {final_balance}")
            print_info(f"Amount transferred: {transferred}")
            
            if abs(transferred - amount) < Decimal("0.000001"):
                print_success("Balance change matches expected amount!")
            else:
                print_warning(f"Balance change ({transferred}) doesn't match expected ({amount})")
        
        return True
        
    except Exception as e:
        print_error(f"SPL token transfer failed: {e}")
        import traceback
        traceback.print_exc()
        return False


async def run_error_scenarios(wallet: HotWallet):
    """Run error handling scenarios (interactive helper, not a direct pytest target)."""
    print_header("Testing Error Scenarios")
    
    service = HotWalletService()
    
    # Test 1: Invalid token address
    print_info("Test 1: Invalid token address")
    try:
        await service.send_token(
            wallet=wallet,
            chain_name="solana",
            token_address="InvalidTokenAddress123",
            to_address=TEST_RECIPIENT,
            amount=Decimal("0.01"),
            decimals=6,
        )
        print_error("Should have failed with invalid token address")
        return False
    except Exception as e:
        print_success(f"Correctly rejected invalid token address: {type(e).__name__}")
    
    # Test 2: Invalid recipient address  
    print_info("Test 2: Invalid recipient address")
    try:
        await service.send_token(
            wallet=wallet,
            chain_name="solana", 
            token_address=DEVNET_TOKENS["USDC"]["address"],
            to_address="InvalidRecipientAddress123",
            amount=Decimal("0.01"),
            decimals=6,
        )
        print_error("Should have failed with invalid recipient address")
        return False
    except Exception as e:
        print_success(f"Correctly rejected invalid recipient: {type(e).__name__}")
    
    # Test 3: Zero amount
    print_info("Test 3: Zero amount")
    try:
        await service.send_token(
            wallet=wallet,
            chain_name="solana",
            token_address=DEVNET_TOKENS["USDC"]["address"],
            to_address=TEST_RECIPIENT,
            amount=Decimal("0"),
            decimals=6,
        )
        print_warning("Zero amount was allowed (may be intentional)")
    except Exception as e:
        print_success(f"Correctly rejected zero amount: {type(e).__name__}")
    
    print_success("Error scenario testing completed")
    return True


async def interactive_menu():
    """Interactive menu for testing SPL token transfers"""
    print_header("🌸 Task #4: SPL Token Transfer Testing")
    print("=" * 60)
    
    wallet = None
    
    while True:
        print("\n" + "=" * 60)
        print("📋 OPTIONS:")
        print("1. Create new test wallet")
        print("2. Load existing wallet by ID")  
        print("3. Check wallet balances (SOL + tokens)")
        print("4. Test USDC transfer")
        print("5. Test USDT transfer")
        print("6. Custom token transfer")
        print("7. Test error scenarios")
        print("8. Show funding instructions")
        print("9. Exit")
        print("=" * 60)
        
        choice = input("Enter your choice (1-9): ").strip()
        
        if choice == "1":
            try:
                wallet = await create_test_wallet()
            except Exception as e:
                print_error(f"Failed to create wallet: {e}")
                
        elif choice == "2":
            try:
                wallet_id = input("Enter wallet ID: ").strip()
                with get_session() as session:
                    wallet = session.query(HotWallet).filter(
                        HotWallet.id == int(wallet_id),
                        HotWallet.chain_type == "solana"
                    ).first()
                    if wallet:
                        print_success(f"Loaded wallet: {wallet.name}")
                        print_info(f"Address: {wallet.address}")
                    else:
                        print_error("Wallet not found")
                        wallet = None
            except Exception as e:
                print_error(f"Failed to load wallet: {e}")
                
        elif choice == "3":
            if not wallet:
                print_error("No wallet selected. Create or load a wallet first.")
                continue
                
            print_info(f"Checking balances for: {wallet.address}")
            
            # Check SOL balance
            sol_balance = await check_wallet_balance(wallet.address)
            if sol_balance is not None:
                print_info(f"SOL balance: {sol_balance}")
            
            # Check token balances
            for token_symbol, token_info in DEVNET_TOKENS.items():
                balance = await check_wallet_balance(wallet.address, token_info["address"])
                if balance is not None:
                    print_info(f"{token_symbol} balance: {balance}")
                    
        elif choice == "4":
            if not wallet:
                print_error("No wallet selected. Create or load a wallet first.")
                continue
            
            amount_str = input("Enter USDC amount to transfer (e.g., 0.01): ").strip()
            try:
                amount = Decimal(amount_str)
                await run_spl_token_transfer(wallet, "USDC", amount)
            except ValueError:
                print_error("Invalid amount entered")
                
        elif choice == "5":
            if not wallet:
                print_error("No wallet selected. Create or load a wallet first.")
                continue
            
            amount_str = input("Enter USDT amount to transfer (e.g., 0.01): ").strip()
            try:
                amount = Decimal(amount_str)
                await run_spl_token_transfer(wallet, "USDT", amount)
            except ValueError:
                print_error("Invalid amount entered")
                
        elif choice == "6":
            if not wallet:
                print_error("No wallet selected. Create or load a wallet first.")
                continue
                
            print("Custom token transfer:")
            token_address = input("Token mint address: ").strip()
            decimals_str = input("Token decimals (e.g., 6 for USDC): ").strip()
            amount_str = input("Amount to transfer: ").strip()
            recipient = input(f"Recipient address (default: {TEST_RECIPIENT}): ").strip()
            
            if not recipient:
                recipient = TEST_RECIPIENT
                
            try:
                decimals = int(decimals_str)
                amount = Decimal(amount_str)
                
                service = HotWalletService()
                signature = await service.send_token(
                    wallet=wallet,
                    chain_name="solana",
                    token_address=token_address,
                    to_address=recipient,
                    amount=amount,
                    decimals=decimals,
                )
                print_success(f"Transfer successful! Signature: {signature}")
                print_info(f"Explorer: https://explorer.solana.com/tx/{signature}?cluster=devnet")
                
            except Exception as e:
                print_error(f"Custom transfer failed: {e}")
                
        elif choice == "7":
            if not wallet:
                print_error("No wallet selected. Create or load a wallet first.")
                continue
            
            await run_error_scenarios(wallet)
            
        elif choice == "8":
            print_header("💰 Funding Instructions")
            if wallet:
                print_info(f"Wallet Address: {wallet.address}")
            print_info("To fund your devnet wallet:")
            print("1. SOL: Visit https://faucet.solana.com")
            print("2. USDC: Search 'solana devnet token faucet' or join Solana Discord")
            print("3. USDT: Same as USDC, available on various devnet faucets")
            print("4. Or use Solana CLI: solana airdrop 2 <address> --url devnet")
            print_warning("Make sure you're using devnet tokens, not mainnet!")
            
        elif choice == "9":
            print_info("Exiting...")
            break
            
        else:
            print_error("Invalid choice. Please enter 1-9.")


if __name__ == "__main__":
    try:
        # Initialize database
        init_db(os.environ['DATABASE_URL'])
        
        # Run interactive menu
        asyncio.run(interactive_menu())
        
    except KeyboardInterrupt:
        print_info("\nOperation cancelled by user")
    except Exception as e:
        print_error(f"Unexpected error: {e}")
        sys.exit(1)