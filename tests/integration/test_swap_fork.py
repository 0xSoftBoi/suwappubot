
import pytest
import asyncio
from unittest.mock import patch, MagicMock
from web3 import Web3
from eth_account import Account
import os

from bot.services.swap_engine import SwapEngine, SwapQuote
from bot.services.wallet import WalletService
from bot.models.user import Wallet, User
from bot.models.swap import SwapStatus

# USDC Address on Ethereum
USDC_ADDRESS = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
# ERC20 Transfer ABI
ERC20_ABI = [
    {
        "constant": False,
        "inputs": [{"name": "_to", "type": "address"}, {"name": "_value", "type": "uint256"}],
        "name": "transfer",
        "outputs": [{"name": "", "type": "bool"}],
        "type": "function"
    },
    {
        "constant": True,
        "inputs": [{"name": "_owner", "type": "address"}],
        "name": "balanceOf",
        "outputs": [{"name": "balance", "type": "uint256"}],
        "type": "function"
    },
    {
        "constant": False,
        "inputs": [{"name": "_spender", "type": "address"}, {"name": "_value", "type": "uint256"}],
        "name": "approve",
        "outputs": [{"name": "", "type": "bool"}],
        "type": "function"
    }
]

@pytest.mark.asyncio
async def test_swap_on_fork(local_fork, whale_account, sample_wallet_data):
    """
    Test executing a swap on a local mainnet fork.
    1. Fund a test wallet from the whale.
    2. Generate a real quote (or mock one that uses valid contracts).
    3. Execute swap.
    4. Verify balances change.
    """
    
    # 1. Setup Web3 connected to Local Fork
    w3 = Web3(Web3.HTTPProvider(local_fork.local_url))
    assert w3.is_connected()
    
    # 2. Setup Test Wallet
    # We use a random account for the user to have a known private key
    user_account = Account.create()
    user_address = user_account.address
    user_pk = user_account.key.hex()
    
    # 3. Fund Test Wallet from Whale
    # Whale sends 1 ETH
    w3.eth.send_transaction({
        "from": whale_account,
        "to": user_address,
        "value": 10**18
    })
    
    # Whale sends 100 USDC
    usdc_contract = w3.eth.contract(address=USDC_ADDRESS, abi=ERC20_ABI)
    amount_usdc = 100 * 10**6
    w3.eth.send_transaction({
        "from": whale_account,
        "to": USDC_ADDRESS,
        "data": usdc_contract.functions.transfer(user_address, amount_usdc)._encode_transaction_data()
    })
    
    # Verify funding
    eth_bal = w3.eth.get_balance(user_address)
    usdc_bal = usdc_contract.functions.balanceOf(user_address).call()
    assert eth_bal == 10**18
    assert usdc_bal == amount_usdc

    # 4. Initialize Services with Patched Settings
    from bot.config.settings import settings
    
    # We patch the ETHEREUM_RPC_URL to point to our local fork
    with patch.object(settings, 'ethereum_rpc_url', local_fork.local_url):
        
        engine = SwapEngine()
        
        # We also need to mock the User/Wallet DB lookup
        mock_session = MagicMock()
        mock_wallet = Wallet(
            id=1,
            user_id=1,
            address=user_address,
            # We need to encrypt the real PK so WalletService can decrypt it
            encrypted_private_key="VALID_ENCRYPTED_KEY_MOCK", 
            chain_type="evm",
            is_active=True
        )
        
        # Helper to decrypt our mock key back to the real key
        def mock_decrypt(enc_key, secret):
            return user_pk
            
        # Mock session query
        mock_session.query.return_value.filter.return_value.first.return_value = mock_wallet
        
        mock_context = MagicMock()
        mock_context.__enter__ = MagicMock(return_value=mock_session)
        mock_context.__exit__ = MagicMock(return_value=None)
        mock_get_session = MagicMock(return_value=mock_context)

        # Patch everything
        with patch('bot.services.swap_engine.get_session', mock_get_session), \
             patch('database.db.get_session', mock_get_session), \
             patch('bot.services.wallet.decrypt_private_key', side_effect=mock_decrypt):
            
            # 5. Get a Quote (We will use a real Li.Fi quote if possible, or construct a valid one)
            # Fetching a real quote from Li.Fi API is risky in test (rate limits, change).
            # But constructing a fake one that works on-chain is hard (needs valid calldata).
            # Best approach: Use Li.Fi API to get a quote for the FORK block? No, fork is latest.
            # Let's try to fetch a real quote for ETH -> USDT (using a small amount of USDC)
            # We must use the REAL Li.Fi API, but pointing to mainnet.
            
            # Force engine.lifi to use real API (it does by default)
            # But since we are on a fork, the calldata returned by Li.Fi (constructed on their backend)
            # should be valid on our fork if our fork is recent.
            
            # Get real quote
            quote = await engine.get_quote(
                from_chain="ethereum",
                to_chain="ethereum", # Use same chain swap to keep it simple (USDC -> USDT)
                from_token="USDC",
                to_token="USDT",
                amount=10.0, # 10 USDC
                from_address=user_address,
                slippage=1.0
            )
            
            # Verify quote looks sane
            assert quote.from_amount_human == 10.0
            assert quote.provider == "lifi"
            
            # MANUAL APPROVAL (Simulating what should happen or pre-existing allowance)
            # In a real app, the bot should probably check and ask for approval, but here we just do it.
            try:
                router_address = quote.raw_quote["transactionRequest"]["to"]
                amount_int = int(10 * 10**6) 
                approve_data = usdc_contract.functions.approve(
                    Web3.to_checksum_address(router_address), 
                    amount_int
                )._encode_transaction_data()
                
                w3.eth.send_transaction({
                    "from": user_address, # The user account (impersonated via Anvil auto-impersonate works if we use send_transaction, but here we have the key too)
                    "to": USDC_ADDRESS,
                    "data": approve_data
                })
            except Exception as e:
                print(f"Approval failed: {e}")
            
            # 6. Execute Swap
            try:
                swap_tx = await engine.execute_swap(
                    quote=quote,
                    wallet_id=1,
                    user_id=1
                )
            except Exception as e:
                print(f"DEBUG: Swap failed with error: {e}")
                raise e
            
            # 7. Verification
            assert swap_tx.status == SwapStatus.SUBMITTED.value
            assert swap_tx.tx_hash is not None
            
            # Check DB update
            # (Mock session doesn't persist, but we checked the assert above)
            
            # Check On-Chain Balance (The most important part!)
            # Wait a moment for block to be mined (Anvil is instant usually)
            
            new_usdc_bal = usdc_contract.functions.balanceOf(user_address).call()
            # Should be less than 100 USDC (we swapped 10)
            assert new_usdc_bal < amount_usdc
            # Precise check: 100 - 10 = 90 (approx, slight variance possible?)
            # Actually it should be exactly 90 * 10**6 if we swapped 10 * 10**6
            assert new_usdc_bal == 90 * 10**6

