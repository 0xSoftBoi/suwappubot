"""Hot wallet management service for custodial operations."""

import asyncio
import logging
from typing import Optional, Tuple
from decimal import Decimal
from datetime import datetime
from web3 import Web3
from eth_account import Account
import aiohttp
import base58

from bot.config.settings import settings
from bot.config.chains import CHAINS, ChainType, get_chain_by_name
from bot.config.tokens import get_token_address, get_token_decimals, NATIVE_TOKEN_ADDRESS
from bot.utils.encryption import encrypt_private_key, decrypt_private_key
from bot.models.custodial import HotWallet, CustodialBalance, CustodialTransaction, TransactionType, TransactionStatus
from database.db import get_session

logger = logging.getLogger(__name__)


class HotWalletService:
    """Service for managing hot wallets and custodial balances."""
    
    def __init__(self):
        self._web3_instances: dict[str, Web3] = {}
    
    def _get_web3(self, chain_name: str) -> Web3:
        """Get or create Web3 instance for a chain."""
        if chain_name not in self._web3_instances:
            chain = get_chain_by_name(chain_name)
            if not chain or chain.chain_type != ChainType.EVM:
                raise ValueError(f"Invalid EVM chain: {chain_name}")
            
            rpc_url = getattr(settings, chain.rpc_url_env.lower(), None)
            if not rpc_url:
                raise ValueError(f"RPC URL not configured for {chain_name}")
            
            self._web3_instances[chain_name] = Web3(Web3.HTTPProvider(rpc_url))
        
        return self._web3_instances[chain_name]
    
    # === Hot Wallet Management ===
    
    def create_hot_wallet(
        self,
        name: str,
        chain_type: str,
        is_deposit_wallet: bool = True,
        is_gas_payer: bool = False,
    ) -> HotWallet:
        """Create a new hot wallet."""
        if chain_type == "evm":
            account = Account.create()
            address = account.address
            private_key = account.key.hex()
        elif chain_type == "solana":
            from solders.keypair import Keypair
            keypair = Keypair()
            address = str(keypair.pubkey())
            private_key = base58.b58encode(bytes(keypair)).decode()
        else:
            raise ValueError(f"Unsupported chain type: {chain_type}")
        
        encrypted_key = encrypt_private_key(private_key, settings.encryption_key)
        
        with get_session() as session:
            wallet = HotWallet(
                name=name,
                chain_type=chain_type,
                address=address,
                encrypted_private_key=encrypted_key,
                is_deposit_wallet=is_deposit_wallet,
                is_gas_payer=is_gas_payer,
            )
            session.add(wallet)
            session.flush()
            wallet_id = wallet.id
        
        return self.get_hot_wallet_by_id(wallet_id)
    
    def import_hot_wallet(
        self,
        name: str,
        chain_type: str,
        private_key: str,
        is_deposit_wallet: bool = True,
        is_gas_payer: bool = False,
    ) -> HotWallet:
        """Import an existing wallet as hot wallet."""
        if chain_type == "evm":
            if not private_key.startswith("0x"):
                private_key = "0x" + private_key
            account = Account.from_key(private_key)
            address = account.address
        elif chain_type == "solana":
            from solders.keypair import Keypair
            key_bytes = base58.b58decode(private_key)
            keypair = Keypair.from_bytes(key_bytes)
            address = str(keypair.pubkey())
        else:
            raise ValueError(f"Unsupported chain type: {chain_type}")
        
        encrypted_key = encrypt_private_key(private_key, settings.encryption_key)
        
        with get_session() as session:
            wallet = HotWallet(
                name=name,
                chain_type=chain_type,
                address=address,
                encrypted_private_key=encrypted_key,
                is_deposit_wallet=is_deposit_wallet,
                is_gas_payer=is_gas_payer,
            )
            session.add(wallet)
            session.flush()
            wallet_id = wallet.id
        
        return self.get_hot_wallet_by_id(wallet_id)
    
    def get_hot_wallet_by_id(self, wallet_id: int) -> Optional[HotWallet]:
        """Get hot wallet by ID."""
        with get_session() as session:
            return session.query(HotWallet).filter(HotWallet.id == wallet_id).first()
    
    def get_deposit_wallet(self, chain_type: str) -> Optional[HotWallet]:
        """Get the primary deposit wallet for a chain type."""
        with get_session() as session:
            return session.query(HotWallet).filter(
                HotWallet.chain_type == chain_type,
                HotWallet.is_deposit_wallet == True,
                HotWallet.is_active == True,
            ).first()
    
    def get_gas_payer_wallet(self, chain_type: str) -> Optional[HotWallet]:
        """Get the gas payer wallet for a chain type."""
        with get_session() as session:
            return session.query(HotWallet).filter(
                HotWallet.chain_type == chain_type,
                HotWallet.is_gas_payer == True,
                HotWallet.is_active == True,
            ).first()
    
    def get_private_key(self, wallet: HotWallet) -> str:
        """Decrypt and return private key."""
        return decrypt_private_key(wallet.encrypted_private_key, settings.encryption_key)
    
    # === Balance Management ===
    
    def get_custodial_balance(
        self,
        user_id: int,
        chain: str,
        token_symbol: str,
    ) -> Decimal:
        """Get user's custodial balance for a token."""
        with get_session() as session:
            balance = session.query(CustodialBalance).filter(
                CustodialBalance.user_id == user_id,
                CustodialBalance.chain == chain,
                CustodialBalance.token_symbol == token_symbol,
            ).first()
            
            if balance:
                return Decimal(balance.balance)
            return Decimal("0")
    
    def get_all_custodial_balances(self, user_id: int) -> dict[str, dict[str, Decimal]]:
        """Get all custodial balances for a user."""
        with get_session() as session:
            balances = session.query(CustodialBalance).filter(
                CustodialBalance.user_id == user_id,
            ).all()
            
            result: dict[str, dict[str, Decimal]] = {}
            for bal in balances:
                if bal.chain not in result:
                    result[bal.chain] = {}
                result[bal.chain][bal.token_symbol] = Decimal(bal.balance)
            
            return result
    
    def update_custodial_balance(
        self,
        user_id: int,
        chain: str,
        token_symbol: str,
        amount: Decimal,
        operation: str = "add",  # "add" or "subtract"
    ) -> Decimal:
        """Update custodial balance. Returns new balance."""
        token_address = get_token_address(token_symbol, chain) or NATIVE_TOKEN_ADDRESS
        
        with get_session() as session:
            balance = session.query(CustodialBalance).filter(
                CustodialBalance.user_id == user_id,
                CustodialBalance.chain == chain,
                CustodialBalance.token_symbol == token_symbol,
            ).first()
            
            if not balance:
                balance = CustodialBalance(
                    user_id=user_id,
                    chain=chain,
                    token_symbol=token_symbol,
                    token_address=token_address,
                    balance="0",
                )
                session.add(balance)
            
            current = Decimal(balance.balance)
            
            if operation == "add":
                new_balance = current + amount
            elif operation == "subtract":
                new_balance = current - amount
                if new_balance < 0:
                    raise ValueError("Insufficient balance")
            else:
                raise ValueError(f"Invalid operation: {operation}")
            
            balance.balance = str(new_balance)
            session.flush()
            
            return new_balance
    
    # === Transaction Recording ===
    
    def record_transaction(
        self,
        user_id: int,
        tx_type: TransactionType,
        chain: str,
        token_symbol: str,
        amount: Decimal,
        tx_hash: Optional[str] = None,
        from_address: Optional[str] = None,
        to_address: Optional[str] = None,
        gas_sponsored: bool = False,
        gas_cost: Optional[Decimal] = None,
        notes: Optional[str] = None,
    ) -> CustodialTransaction:
        """Record a custodial transaction."""
        token_address = get_token_address(token_symbol, chain) or NATIVE_TOKEN_ADDRESS
        
        with get_session() as session:
            tx = CustodialTransaction(
                user_id=user_id,
                tx_type=tx_type.value,
                chain=chain,
                token_symbol=token_symbol,
                token_address=token_address,
                amount=str(amount),
                tx_hash=tx_hash,
                from_address=from_address,
                to_address=to_address,
                gas_sponsored=gas_sponsored,
                gas_cost=str(gas_cost) if gas_cost else None,
                notes=notes,
            )
            session.add(tx)
            session.flush()
            tx_id = tx.id
        
        with get_session() as session:
            return session.query(CustodialTransaction).filter(
                CustodialTransaction.id == tx_id
            ).first()
    
    def update_transaction_status(
        self,
        tx_id: int,
        status: TransactionStatus,
        tx_hash: Optional[str] = None,
    ) -> None:
        """Update transaction status."""
        with get_session() as session:
            tx = session.query(CustodialTransaction).filter(
                CustodialTransaction.id == tx_id
            ).first()
            
            if tx:
                tx.status = status.value
                if tx_hash:
                    tx.tx_hash = tx_hash
                if status == TransactionStatus.COMPLETED:
                    tx.completed_at = datetime.utcnow()
    
    # === Hot Wallet Operations ===
    
    async def get_hot_wallet_balance(
        self,
        wallet: HotWallet,
        chain_name: str,
    ) -> Tuple[Decimal, dict[str, Decimal]]:
        """
        Get hot wallet balances.
        
        Returns:
            Tuple of (native_balance, {token_symbol: balance})
        """
        if wallet.chain_type == "evm":
            return await self._get_evm_wallet_balance(wallet, chain_name)
        elif wallet.chain_type == "solana":
            return await self._get_solana_wallet_balance(wallet)
        else:
            return Decimal("0"), {}
    
    async def _get_evm_wallet_balance(
        self,
        wallet: HotWallet,
        chain_name: str,
    ) -> Tuple[Decimal, dict[str, Decimal]]:
        """Get EVM wallet balances."""
        web3 = self._get_web3(chain_name)
        
        # Native balance
        native_wei = web3.eth.get_balance(Web3.to_checksum_address(wallet.address))
        native_balance = Decimal(str(native_wei)) / Decimal(10 ** 18)
        
        # Token balances
        from bot.config.tokens import TOKENS
        token_balances = {}
        
        for token_symbol, token in TOKENS.items():
            if chain_name in token.addresses:
                token_address = token.addresses[chain_name]
                if token_address.startswith("0x") and token_address != NATIVE_TOKEN_ADDRESS:
                    try:
                        balance = await self._get_erc20_balance(
                            web3, token_address, wallet.address, token.decimals
                        )
                        if balance > 0:
                            token_balances[token_symbol] = balance
                    except Exception:
                        pass
        
        return native_balance, token_balances
    
    async def _get_erc20_balance(
        self,
        web3: Web3,
        token_address: str,
        wallet_address: str,
        decimals: int,
    ) -> Decimal:
        """Get ERC20 token balance."""
        abi = [{"constant": True, "inputs": [{"name": "_owner", "type": "address"}], 
                "name": "balanceOf", "outputs": [{"name": "balance", "type": "uint256"}], "type": "function"}]
        
        contract = web3.eth.contract(
            address=Web3.to_checksum_address(token_address),
            abi=abi
        )
        
        balance = contract.functions.balanceOf(Web3.to_checksum_address(wallet_address)).call()
        return Decimal(str(balance)) / Decimal(10 ** decimals)
    
    async def _get_solana_wallet_balance(
        self,
        wallet: HotWallet,
    ) -> Tuple[Decimal, dict[str, Decimal]]:
        """Get Solana wallet balances."""
        native_balance = Decimal("0")
        token_balances = {}
        
        try:
            async with aiohttp.ClientSession() as session:
                # SOL balance
                payload = {
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "getBalance",
                    "params": [wallet.address]
                }
                async with session.post(settings.solana_rpc_url, json=payload) as resp:
                    result = await resp.json()
                    if "result" in result:
                        lamports = result["result"]["value"]
                        native_balance = Decimal(str(lamports)) / Decimal(10 ** 9)
        except Exception as e:
            logger.error(f"Error fetching Solana balance: {e}")
        
        return native_balance, token_balances
    
    async def send_native_token(
        self,
        wallet: HotWallet,
        chain_name: str,
        to_address: str,
        amount: Decimal,
    ) -> str:
        """Send native token from hot wallet. Returns tx hash."""
        if wallet.chain_type != "evm":
            raise NotImplementedError("Only EVM supported currently")
        
        web3 = self._get_web3(chain_name)
        chain = get_chain_by_name(chain_name)
        
        private_key = self.get_private_key(wallet)
        if not private_key.startswith("0x"):
            private_key = "0x" + private_key
        
        amount_wei = int(amount * Decimal(10 ** 18))
        
        # Build transaction
        nonce = web3.eth.get_transaction_count(Web3.to_checksum_address(wallet.address))
        gas_price = web3.eth.gas_price
        
        tx = {
            'nonce': nonce,
            'to': Web3.to_checksum_address(to_address),
            'value': amount_wei,
            'gas': 21000,
            'gasPrice': gas_price,
            'chainId': chain.chain_id,
        }
        
        # Sign and send
        signed = Account.sign_transaction(tx, private_key)
        tx_hash = web3.eth.send_raw_transaction(signed.rawTransaction)
        
        return tx_hash.hex()
    
    async def send_token(
        self,
        wallet: HotWallet,
        chain_name: str,
        token_address: str,
        to_address: str,
        amount: Decimal,
        decimals: int,
    ) -> str:
        """Send ERC20 token from hot wallet. Returns tx hash."""
        if wallet.chain_type != "evm":
            raise NotImplementedError("Only EVM supported currently")
        
        web3 = self._get_web3(chain_name)
        chain = get_chain_by_name(chain_name)
        
        private_key = self.get_private_key(wallet)
        if not private_key.startswith("0x"):
            private_key = "0x" + private_key
        
        amount_raw = int(amount * Decimal(10 ** decimals))
        
        # ERC20 transfer ABI
        abi = [{"constant": False, "inputs": [{"name": "_to", "type": "address"}, 
                {"name": "_value", "type": "uint256"}], "name": "transfer", 
                "outputs": [{"name": "", "type": "bool"}], "type": "function"}]
        
        contract = web3.eth.contract(
            address=Web3.to_checksum_address(token_address),
            abi=abi
        )
        
        # Build transaction
        nonce = web3.eth.get_transaction_count(Web3.to_checksum_address(wallet.address))
        gas_price = web3.eth.gas_price
        
        tx = contract.functions.transfer(
            Web3.to_checksum_address(to_address),
            amount_raw
        ).build_transaction({
            'nonce': nonce,
            'gasPrice': gas_price,
            'chainId': chain.chain_id,
        })
        
        # Estimate gas
        tx['gas'] = web3.eth.estimate_gas(tx)
        
        # Sign and send
        signed = Account.sign_transaction(tx, private_key)
        tx_hash = web3.eth.send_raw_transaction(signed.rawTransaction)
        
        return tx_hash.hex()


# Global instance
hot_wallet_service = HotWalletService()

