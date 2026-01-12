"""Wallet management service for EVM and Solana chains."""

import json
from typing import Optional
from web3 import Web3
from eth_account import Account
from solders.keypair import Keypair
from solders.pubkey import Pubkey
from solana.rpc.async_api import AsyncClient as SolanaClient
import base58
import aiohttp

from bot.config.settings import settings
from bot.config.chains import CHAINS, ChainType, get_chain_by_name
from bot.config.tokens import get_token_address, get_token_decimals
from bot.utils.encryption import encrypt_private_key, decrypt_private_key
from bot.utils.validators import validate_private_key, validate_address
from bot.models.user import User, Wallet
from database.db import get_session


# ERC20 ABI for balance checking
ERC20_ABI = [
    {
        "constant": True,
        "inputs": [{"name": "_owner", "type": "address"}],
        "name": "balanceOf",
        "outputs": [{"name": "balance", "type": "uint256"}],
        "type": "function"
    },
    {
        "constant": True,
        "inputs": [],
        "name": "decimals",
        "outputs": [{"name": "", "type": "uint8"}],
        "type": "function"
    },
]


class WalletService:
    """Service for managing user wallets across chains."""
    
    def __init__(self):
        self._web3_instances: dict[str, Web3] = {}
        self._solana_client: Optional[SolanaClient] = None
    
    def _get_web3(self, chain_name: str) -> Web3:
        """Get or create a Web3 instance for a chain."""
        if chain_name not in self._web3_instances:
            chain = get_chain_by_name(chain_name)
            if not chain or chain.chain_type != ChainType.EVM:
                raise ValueError(f"Invalid EVM chain: {chain_name}")
            
            rpc_url = settings.get_rpc_url(chain_name)
            if not rpc_url:
                raise ValueError(f"RPC URL not configured for {chain_name}")
            
            self._web3_instances[chain_name] = Web3(Web3.HTTPProvider(rpc_url))
        
        return self._web3_instances[chain_name]
    
    async def _get_solana_client(self) -> SolanaClient:
        """Get or create a Solana RPC client."""
        if self._solana_client is None:
            rpc_url = settings.get_rpc_url("solana")
            self._solana_client = SolanaClient(rpc_url)
        return self._solana_client
    
    # === Wallet Creation ===
    
    def create_evm_wallet(self) -> tuple[str, str]:
        """
        Create a new EVM wallet.
        
        Returns:
            Tuple of (address, private_key)
        """
        account = Account.create()
        return account.address, account.key.hex()
    
    def create_solana_wallet(self) -> tuple[str, str]:
        """
        Create a new Solana wallet.
        
        Returns:
            Tuple of (address, private_key as base58)
        """
        keypair = Keypair()
        address = str(keypair.pubkey())
        private_key = base58.b58encode(bytes(keypair)).decode()
        return address, private_key
    
    # === Wallet Import ===
    
    def import_evm_wallet(self, private_key: str) -> str:
        """
        Import an EVM wallet from private key.
        
        Args:
            private_key: Private key (hex string, with or without 0x prefix)
            
        Returns:
            Wallet address
            
        Raises:
            ValueError: If private key is invalid
        """
        if not validate_private_key(private_key, "evm"):
            raise ValueError("Invalid EVM private key")
        
        if not private_key.startswith("0x"):
            private_key = "0x" + private_key
        
        account = Account.from_key(private_key)
        return account.address
    
    def import_solana_wallet(self, private_key: str) -> str:
        """
        Import a Solana wallet from private key.
        
        Args:
            private_key: Private key (base58 encoded or JSON array)
            
        Returns:
            Wallet address
            
        Raises:
            ValueError: If private key is invalid
        """
        if not validate_private_key(private_key, "solana"):
            raise ValueError("Invalid Solana private key")
        
        try:
            # Try base58 decoding
            key_bytes = base58.b58decode(private_key)
        except Exception:
            # Try JSON array
            key_bytes = bytes(json.loads(private_key))
        
        keypair = Keypair.from_bytes(key_bytes)
        return str(keypair.pubkey())
    
    # === Database Operations ===
    
    def save_wallet(
        self,
        user_id: int,
        address: str,
        private_key: str,
        chain_type: str,
        name: str = "Default Wallet",
        is_default: bool = False,
    ) -> Wallet:
        """
        Save a wallet to the database with encrypted private key.
        
        Args:
            user_id: Database user ID
            address: Wallet address
            private_key: Plain private key
            chain_type: "evm" or "solana"
            name: Wallet name
            is_default: Whether this is the default wallet
            
        Returns:
            Created Wallet object
        """
        encrypted_key = encrypt_private_key(private_key, settings.encryption_key)
        
        with get_session() as session:
            # If setting as default, unset other defaults of same type
            if is_default:
                session.query(Wallet).filter(
                    Wallet.user_id == user_id,
                    Wallet.chain_type == chain_type,
                    Wallet.is_default == True
                ).update({"is_default": False})
            
            wallet = Wallet(
                user_id=user_id,
                address=address,
                encrypted_private_key=encrypted_key,
                chain_type=chain_type,
                name=name,
                is_default=is_default,
            )
            session.add(wallet)
            session.flush()
            wallet_id = wallet.id
        
        return self.get_wallet_by_id(wallet_id)
    
    def get_wallet_by_id(self, wallet_id: int) -> Optional[Wallet]:
        """Get a wallet by ID."""
        with get_session() as session:
            return session.query(Wallet).filter(Wallet.id == wallet_id).first()
    
    def get_user_wallets(self, user_id: int, chain_type: Optional[str] = None) -> list[Wallet]:
        """Get all wallets for a user, optionally filtered by chain type."""
        with get_session() as session:
            query = session.query(Wallet).filter(Wallet.user_id == user_id, Wallet.is_active == True)
            if chain_type:
                query = query.filter(Wallet.chain_type == chain_type)
            return query.all()
    
    def get_default_wallet(self, user_id: int, chain_type: str) -> Optional[Wallet]:
        """Get the default wallet for a user and chain type."""
        with get_session() as session:
            wallet = session.query(Wallet).filter(
                Wallet.user_id == user_id,
                Wallet.chain_type == chain_type,
                Wallet.is_default == True,
                Wallet.is_active == True,
            ).first()
            
            if not wallet:
                # Return first wallet of this type if no default
                wallet = session.query(Wallet).filter(
                    Wallet.user_id == user_id,
                    Wallet.chain_type == chain_type,
                    Wallet.is_active == True,
                ).first()
            
            return wallet
    
    def get_private_key(self, wallet: Wallet) -> str:
        """Decrypt and return the private key for a wallet."""
        return decrypt_private_key(wallet.encrypted_private_key, settings.encryption_key)
    
    # === Balance Checking ===
    
    async def get_evm_token_balance(
        self,
        chain_name: str,
        token_symbol: str,
        address: str,
    ) -> float:
        """
        Get ERC20 token balance for an address.
        
        Returns:
            Token balance as float
        """
        token_address = get_token_address(token_symbol, chain_name)
        if not token_address:
            return 0.0
        
        web3 = self._get_web3(chain_name)
        contract = web3.eth.contract(
            address=Web3.to_checksum_address(token_address),
            abi=ERC20_ABI
        )
        
        try:
            balance_raw = contract.functions.balanceOf(
                Web3.to_checksum_address(address)
            ).call()
            
            decimals = get_token_decimals(token_symbol, chain_name)
            return balance_raw / (10 ** decimals)
        except Exception:
            return 0.0
    
    async def get_evm_native_balance(self, chain_name: str, address: str) -> float:
        """Get native token balance (ETH, BNB, etc.) for an address."""
        chain = get_chain_by_name(chain_name)
        if not chain:
            return 0.0
        
        web3 = self._get_web3(chain_name)
        
        try:
            balance_wei = web3.eth.get_balance(Web3.to_checksum_address(address))
            return balance_wei / (10 ** chain.native_decimals)
        except Exception:
            return 0.0
    
    async def get_solana_token_balance(
        self,
        token_symbol: str,
        address: str,
    ) -> float:
        """
        Get SPL token balance for a Solana address.
        
        Returns:
            Token balance as float
        """
        token_mint = get_token_address(token_symbol, "solana")
        if not token_mint:
            return 0.0
        
        client = await self._get_solana_client()
        
        try:
            # Get token accounts for the wallet
            pubkey = Pubkey.from_string(address)
            mint_pubkey = Pubkey.from_string(token_mint)
            
            # Use getTokenAccountsByOwner RPC method
            async with aiohttp.ClientSession() as session:
                payload = {
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "getTokenAccountsByOwner",
                    "params": [
                        address,
                        {"mint": token_mint},
                        {"encoding": "jsonParsed"}
                    ]
                }
                async with session.post(settings.solana_rpc_url, json=payload) as resp:
                    result = await resp.json()
                    
                    if "result" in result and result["result"]["value"]:
                        accounts = result["result"]["value"]
                        total_balance = 0
                        for account in accounts:
                            info = account["account"]["data"]["parsed"]["info"]
                            amount = int(info["tokenAmount"]["amount"])
                            decimals = info["tokenAmount"]["decimals"]
                            total_balance += amount / (10 ** decimals)
                        return total_balance
            
            return 0.0
        except Exception:
            return 0.0
    
    async def get_solana_native_balance(self, address: str) -> float:
        """Get SOL balance for an address."""
        try:
            async with aiohttp.ClientSession() as session:
                payload = {
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "getBalance",
                    "params": [address]
                }
                async with session.post(settings.solana_rpc_url, json=payload) as resp:
                    result = await resp.json()
                    
                    if "result" in result:
                        lamports = result["result"]["value"]
                        return lamports / 1e9  # Convert lamports to SOL
            
            return 0.0
        except Exception:
            return 0.0
    
    async def get_all_balances(self, wallet: Wallet) -> dict[str, dict[str, float]]:
        """
        Get all token balances for a wallet.
        
        Returns:
            Dict of chain_name -> {token_symbol: balance}
        """
        from bot.config.tokens import TOKENS
        
        balances: dict[str, dict[str, float]] = {}
        
        if wallet.chain_type == "evm":
            # Check balances on all EVM chains
            for chain_name, chain in CHAINS.items():
                if chain.chain_type != ChainType.EVM:
                    continue
                
                chain_balances: dict[str, float] = {}
                
                # Native balance
                native_balance = await self.get_evm_native_balance(chain_name, wallet.address)
                if native_balance > 0:
                    chain_balances[chain.native_token] = native_balance
                
                # Token balances
                for token_symbol, token in TOKENS.items():
                    if chain_name in token.addresses:
                        balance = await self.get_evm_token_balance(
                            chain_name, token_symbol, wallet.address
                        )
                        if balance > 0:
                            chain_balances[token_symbol] = balance
                
                if chain_balances:
                    balances[chain_name] = chain_balances
        
        elif wallet.chain_type == "solana":
            chain_balances: dict[str, float] = {}
            
            # SOL balance
            sol_balance = await self.get_solana_native_balance(wallet.address)
            if sol_balance > 0:
                chain_balances["SOL"] = sol_balance
            
            # Token balances
            for token_symbol, token in TOKENS.items():
                if "solana" in token.addresses:
                    balance = await self.get_solana_token_balance(token_symbol, wallet.address)
                    if balance > 0:
                        chain_balances[token_symbol] = balance
            
            if chain_balances:
                balances["solana"] = chain_balances
        
        return balances
    
    async def get_balances_by_address(self, address: str, chain_type: str) -> dict[str, dict[str, float]]:
        """
        Get all token balances for an address without needing a Wallet object.
        
        Args:
            address: Wallet address
            chain_type: "evm" or "solana"
            
        Returns:
            Dict of chain_name -> {token_symbol: balance}
        """
        from bot.config.tokens import TOKENS
        
        balances: dict[str, dict[str, float]] = {}
        
        if chain_type == "evm":
            # Check balances on all EVM chains
            for chain_name, chain in CHAINS.items():
                if chain.chain_type != ChainType.EVM:
                    continue
                
                chain_balances: dict[str, float] = {}
                
                # Native balance
                native_balance = await self.get_evm_native_balance(chain_name, address)
                if native_balance > 0:
                    chain_balances[chain.native_token] = native_balance
                
                # Token balances
                for token_symbol, token in TOKENS.items():
                    if chain_name in token.addresses:
                        balance = await self.get_evm_token_balance(
                            chain_name, token_symbol, address
                        )
                        if balance > 0:
                            chain_balances[token_symbol] = balance
                
                if chain_balances:
                    balances[chain_name] = chain_balances
        
        elif chain_type == "solana":
            chain_balances: dict[str, float] = {}
            
            # SOL balance
            sol_balance = await self.get_solana_native_balance(address)
            if sol_balance > 0:
                chain_balances["SOL"] = sol_balance
            
            # Token balances
            for token_symbol, token in TOKENS.items():
                if "solana" in token.addresses:
                    balance = await self.get_solana_token_balance(token_symbol, address)
                    if balance > 0:
                        chain_balances[token_symbol] = balance
            
            if chain_balances:
                balances["solana"] = chain_balances
        
        return balances
    
    # === Transaction Signing ===
    
    def sign_evm_transaction(self, wallet: Wallet, transaction: dict) -> str:
        """
        Sign an EVM transaction.
        
        Args:
            wallet: Wallet to sign with
            transaction: Transaction dict
            
        Returns:
            Signed transaction hex string
        """
        private_key = self.get_private_key(wallet)
        if not private_key.startswith("0x"):
            private_key = "0x" + private_key
        
        signed = Account.sign_transaction(transaction, private_key)
        return signed.raw_transaction.hex()
    
    def sign_solana_transaction(self, wallet: Wallet, transaction_bytes: bytes) -> bytes:
        """
        Sign a Solana transaction.
        
        Args:
            wallet: Wallet to sign with
            transaction_bytes: Serialized transaction
            
        Returns:
            Signed transaction bytes
        """
        from solders.transaction import VersionedTransaction
        
        private_key = self.get_private_key(wallet)
        
        try:
            key_bytes = base58.b58decode(private_key)
        except Exception:
            key_bytes = bytes(json.loads(private_key))
        
        keypair = Keypair.from_bytes(key_bytes)
        
        # Deserialize, sign, and serialize
        tx = VersionedTransaction.from_bytes(transaction_bytes)
        tx.sign([keypair])
        
        return bytes(tx)
    
    def sign_evm_transaction_raw(self, encrypted_private_key: str, transaction: dict) -> str:
        """
        Sign an EVM transaction using encrypted private key directly.
        
        Args:
            encrypted_private_key: Encrypted private key string
            transaction: Transaction dict
            
        Returns:
            Signed transaction hex string
        """
        private_key = decrypt_private_key(encrypted_private_key, settings.encryption_key)
        if not private_key.startswith("0x"):
            private_key = "0x" + private_key
        
        signed = Account.sign_transaction(transaction, private_key)
        return signed.raw_transaction.hex()
    
    def sign_solana_transaction_raw(self, encrypted_private_key: str, transaction_bytes: bytes) -> bytes:
        """
        Sign a Solana transaction using encrypted private key directly.
        
        Args:
            encrypted_private_key: Encrypted private key string
            transaction_bytes: Serialized transaction
            
        Returns:
            Signed transaction bytes
        """
        from solders.transaction import VersionedTransaction
        
        private_key = decrypt_private_key(encrypted_private_key, settings.encryption_key)
        
        try:
            key_bytes = base58.b58decode(private_key)
        except Exception:
            key_bytes = bytes(json.loads(private_key))
        
        keypair = Keypair.from_bytes(key_bytes)
        
        # Deserialize, sign, and serialize
        tx = VersionedTransaction.from_bytes(transaction_bytes)
        tx.sign([keypair])
        
        return bytes(tx)

