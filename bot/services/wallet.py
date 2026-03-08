"""Wallet management service for EVM and Solana chains."""

import asyncio
import json
import logging
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
from bot.utils.envelope_crypto import (
    encrypt_private_key_v2,
    encode_for_db,
    get_private_key_with_auto_migrate,
    SCHEME_LEGACY_FERNET_V1,
    SCHEME_KMS_AESGCM_V2,
)
from bot.utils.validators import validate_private_key, validate_address
from bot.models.user import User, Wallet
from database.db import get_session

logger = logging.getLogger(__name__)


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
        """Get or create a Web3 instance for a chain, with RPC fallback."""
        if chain_name not in self._web3_instances:
            chain = get_chain_by_name(chain_name)
            if not chain or chain.chain_type != ChainType.EVM:
                raise ValueError(f"Invalid EVM chain: {chain_name}")

            rpc_attr = f"{chain_name.lower().replace('-', '_')}_rpc_url"
            rpc_str = getattr(settings, rpc_attr, "") or ""
            urls = [u.strip() for u in rpc_str.split(",") if u.strip()]
            if not urls:
                raise ValueError(f"RPC URL not configured for {chain_name}")

            import random
            random.shuffle(urls)
            for url in urls:
                try:
                    w3 = Web3(Web3.HTTPProvider(url, request_kwargs={"timeout": 10}))
                    w3.eth.block_number  # verify connectivity
                    self._web3_instances[chain_name] = w3
                    break
                except Exception:
                    continue

            if chain_name not in self._web3_instances:
                # Last resort: use first URL without connectivity check
                self._web3_instances[chain_name] = Web3(
                    Web3.HTTPProvider(urls[0], request_kwargs={"timeout": 10})
                )

        return self._web3_instances[chain_name]

    def _invalidate_web3(self, chain_name: str):
        """Remove cached Web3 instance so next call picks a fresh RPC."""
        self._web3_instances.pop(chain_name, None)
    
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

    async def create_wallet(self, user_id: int, name: str, chain_type: str = "evm"):
        """
        Convenience method to create and save a wallet in one call.
        
        Routes to Turnkey if configured, otherwise creates local wallet.
        
        Args:
            user_id: Target user
            name: Label for the wallet
            chain_type: "evm" or "solana"
            
        Returns:
            Wallet object
        """
        # Check if Turnkey is configured
        if settings.wallet_provider == "turnkey":
            return await self._create_turnkey_wallet(user_id, name, chain_type)
        
        # Local wallet creation
        if chain_type == "evm":
            address, pk = self.create_evm_wallet()
        elif chain_type == "solana":
            address, pk = self.create_solana_wallet()
        else:
            raise ValueError(f"Unsupported chain type: {chain_type}")
            
        return self.save_wallet(
            user_id=user_id,
            address=address,
            private_key=pk,
            chain_type=chain_type,
            name=name
        )
    
    async def _create_turnkey_wallet(self, user_id: int, name: str, chain_type: str) -> Wallet:
        """
        Create a wallet via Turnkey infrastructure.
        
        Args:
            user_id: Target user
            name: Label for the wallet
            chain_type: "evm" or "solana"
            
        Returns:
            Wallet object
        """
        from bot.services.turnkey_client import get_turnkey_client
        
        client = get_turnkey_client()
        
        # Ensure user has a sub-organization
        sub_org_id = await self._ensure_user_sub_org(user_id)
        
        # Create wallet in user's sub-org
        turnkey_wallet = await client.create_wallet(
            wallet_name=f"{name}_{user_id}_{chain_type}",
            chain_type=chain_type,
            organization_id=sub_org_id,
        )
        
        if not turnkey_wallet.address:
            raise RuntimeError("Turnkey wallet creation failed: no address returned")
        
        # Save wallet reference to database
        with get_session() as session:
            wallet = Wallet(
                user_id=user_id,
                address=turnkey_wallet.address,
                # For Turnkey wallets, use a placeholder to satisfy NOT NULL constraints if they exist
                encrypted_private_key="turnkey_managed",
                encryption_scheme="turnkey",
                wallet_provider="turnkey",
                turnkey_sub_org_id=sub_org_id,
                turnkey_wallet_id=turnkey_wallet.wallet_id,
                turnkey_account_id=turnkey_wallet.account_id,
                chain_type=chain_type,
                name=name,
                is_default=False,
            )
            session.add(wallet)
            session.flush()
            wallet_id = wallet.id
        
        logger.info(f"Created Turnkey wallet for user {user_id}: {turnkey_wallet.address}")
        return self.get_wallet_by_id(wallet_id)
    
    async def _ensure_user_sub_org(self, user_id: int) -> str:
        """
        Ensure user has a Turnkey sub-organization, creating one if needed.
        
        Args:
            user_id: Database user ID
            
        Returns:
            Sub-organization ID
        """
        from bot.services.turnkey_client import get_turnkey_client
        
        # Check if user already has a sub-org
        with get_session() as session:
            existing = session.query(Wallet).filter(
                Wallet.user_id == user_id,
                Wallet.wallet_provider == "turnkey",
                Wallet.turnkey_sub_org_id.isnot(None),
            ).first()
            
            if existing and existing.turnkey_sub_org_id:
                return existing.turnkey_sub_org_id
        
        # Create new sub-organization
        client = get_turnkey_client()
        sub_org = await client.create_sub_organization(f"user_{user_id}")
        
        logger.info(f"Created Turnkey sub-org for user {user_id}: {sub_org.sub_org_id}")
        return sub_org.sub_org_id
    
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
        
        Uses KMS envelope encryption (v2) if configured, otherwise falls back to legacy.
        
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
        # Determine encryption scheme based on settings
        use_v2 = settings.wallet_encryption_scheme == SCHEME_KMS_AESGCM_V2
        
        if use_v2:
            # Use envelope encryption with KMS
            encrypted = encrypt_private_key_v2(private_key)
            db_fields = encode_for_db(encrypted)
        else:
            # Legacy Fernet encryption
            db_fields = {
                "encrypted_private_key": encrypt_private_key(private_key, settings.encryption_key),
                "encryption_scheme": SCHEME_LEGACY_FERNET_V1,
                "kms_wrapped_dek": None,
                "aesgcm_nonce": None,
                "kms_key_id": None,
                "key_version": 1,
            }
        
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
                encrypted_private_key=db_fields["encrypted_private_key"],
                encryption_scheme=db_fields["encryption_scheme"],
                kms_wrapped_dek=db_fields.get("kms_wrapped_dek"),
                aesgcm_nonce=db_fields.get("aesgcm_nonce"),
                kms_key_id=db_fields.get("kms_key_id"),
                key_version=db_fields.get("key_version", 1),
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
    
    def get_private_key(self, wallet: Wallet, auto_migrate: bool = True) -> str:
        """
        Decrypt and return the private key for a wallet.
        
        Handles both legacy (Fernet) and v2 (KMS + AES-GCM) encryption schemes.
        Optionally auto-migrates legacy wallets to v2 on first access.
        
        Note: Turnkey wallets do not have accessible private keys - they stay in TEEs.
        
        Args:
            wallet: Wallet object
            auto_migrate: Whether to migrate legacy wallets to v2
            
        Returns:
            Decrypted private key string
            
        Raises:
            ValueError: If wallet is a Turnkey wallet (keys don't leave Turnkey)
        """
        # Turnkey wallets don't have local private keys
        if wallet.is_turnkey_wallet:
            raise ValueError(
                "Cannot access private key for Turnkey wallet. "
                "Use sign_evm_transaction or sign_solana_transaction instead."
            )
        
        with get_session() as session:
            # Re-attach wallet to session for potential migration update
            wallet = session.merge(wallet)
            return get_private_key_with_auto_migrate(
                wallet_row=wallet,
                session=session,
                auto_migrate=auto_migrate,
            )
    
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

        for attempt in range(2):
            try:
                loop = asyncio.get_event_loop()
                balance_raw = await loop.run_in_executor(
                    None,
                    contract.functions.balanceOf(Web3.to_checksum_address(address)).call,
                )

                decimals = get_token_decimals(token_symbol, chain_name)
                return balance_raw / (10 ** decimals)
            except Exception as e:
                if attempt == 0:
                    # Retry with a fresh RPC
                    logger.warning(f"Balance check failed on {chain_name}, retrying with new RPC: {e}")
                    self._invalidate_web3(chain_name)
                    web3 = self._get_web3(chain_name)
                    contract = web3.eth.contract(
                        address=Web3.to_checksum_address(token_address),
                        abi=ERC20_ABI,
                    )
                else:
                    logger.error(f"Balance check failed on {chain_name} after retry: {e}")
                    return 0.0
        return 0.0

    async def get_evm_native_balance(self, chain_name: str, address: str) -> float:
        """Get native token balance (ETH, BNB, etc.) for an address."""
        chain = get_chain_by_name(chain_name)
        if not chain:
            return 0.0

        for attempt in range(2):
            web3 = self._get_web3(chain_name)
            try:
                loop = asyncio.get_event_loop()
                balance_wei = await loop.run_in_executor(
                    None,
                    web3.eth.get_balance,
                    Web3.to_checksum_address(address),
                )
                return balance_wei / (10 ** chain.native_decimals)
            except Exception as e:
                if attempt == 0:
                    logger.warning(f"Native balance check failed on {chain_name}, retrying: {e}")
                    self._invalidate_web3(chain_name)
                else:
                    logger.error(f"Native balance check failed on {chain_name} after retry: {e}")
                    return 0.0
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
                async with session.post(settings.get_rpc_url("solana"), json=payload) as resp:
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
                async with session.post(settings.get_rpc_url("solana"), json=payload) as resp:
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

        Uses a cache-first strategy (60s TTL).  On cache miss, uses Alchemy
        batch API for supported EVM chains and falls back to per-token RPC
        for unsupported chains and Solana.
        """
        from bot.utils.cache import balance_cache

        cache_key = f"bal:{address}:{chain_type}"

        # --- Layer 2: cache-first read ---
        cached = await balance_cache.get(cache_key)
        if cached is not None:
            return cached

        # --- Cache miss → live fetch ---
        balances = await self._fetch_balances_live(address, chain_type)

        # Store in cache (60s TTL via default)
        await balance_cache.set(cache_key, balances)
        return balances

    async def _fetch_balances_live(self, address: str, chain_type: str) -> dict[str, dict[str, float]]:
        """Fetch balances from RPCs / Alchemy (no caching)."""
        from bot.config.tokens import TOKENS

        CALL_TIMEOUT = 5  # seconds per RPC call
        GLOBAL_TIMEOUT = 20  # seconds for entire balance fetch

        balances: dict[str, dict[str, float]] = {}

        async def _safe_call(coro, default=0.0):
            """Wrap an RPC call with a timeout."""
            try:
                return await asyncio.wait_for(coro, timeout=CALL_TIMEOUT)
            except (asyncio.TimeoutError, Exception):
                return default

        async def _fetch_evm_chain_alchemy(chain_name, chain):
            """Fetch all balances for a single EVM chain via Alchemy batch API."""
            from bot.services.alchemy_client import get_alchemy_client
            from bot.config.tokens import get_token_decimals

            client = get_alchemy_client()
            chain_balances: dict[str, float] = {}

            try:
                # 1. Native balance via Alchemy
                native = await asyncio.wait_for(
                    client.get_native_balance(address, chain_name),
                    timeout=CALL_TIMEOUT,
                )
                if native and native > 0:
                    chain_balances[chain.native_token] = native

                # 2. All ERC-20 balances in ONE call
                raw_balances = await asyncio.wait_for(
                    client.get_token_balances_raw(address, chain_name),
                    timeout=CALL_TIMEOUT,
                )

                # Build reverse lookup: lowercase contract address → (symbol, decimals)
                addr_to_token: dict[str, tuple[str, int]] = {}
                for token_symbol, token in TOKENS.items():
                    token_addr = token.addresses.get(chain_name)
                    if token_addr:
                        addr_to_token[token_addr.lower()] = (
                            token_symbol,
                            get_token_decimals(token_symbol, chain_name),
                        )

                for contract_lower, raw_balance in raw_balances.items():
                    entry = addr_to_token.get(contract_lower)
                    if entry:
                        symbol, decimals = entry
                        balance = raw_balance / (10 ** decimals)
                        if balance > 0:
                            chain_balances[symbol] = balance

            except Exception as e:
                logger.debug(f"Alchemy fetch failed for {chain_name}, falling back to RPC: {e}")
                # Fall back to per-token RPC
                return await _fetch_evm_chain_rpc(chain_name, chain)

            return chain_name, chain_balances

        async def _fetch_evm_chain_rpc(chain_name, chain):
            """Fetch all balances for a single EVM chain via individual RPC calls."""
            chain_balances: dict[str, float] = {}

            tasks = []
            task_keys = []

            # Native balance
            tasks.append(_safe_call(self.get_evm_native_balance(chain_name, address)))
            task_keys.append(chain.native_token)

            # Token balances
            for token_symbol, token in TOKENS.items():
                if chain_name in token.addresses:
                    tasks.append(_safe_call(
                        self.get_evm_token_balance(chain_name, token_symbol, address)
                    ))
                    task_keys.append(token_symbol)

            results = await asyncio.gather(*tasks, return_exceptions=True)

            for key, result in zip(task_keys, results):
                if isinstance(result, (int, float)) and result > 0:
                    chain_balances[key] = result

            return chain_name, chain_balances

        try:
            async with asyncio.timeout(GLOBAL_TIMEOUT):
                if chain_type == "evm":
                    from bot.services.alchemy_client import get_alchemy_client
                    alchemy = get_alchemy_client()

                    # Fetch ALL chains in parallel
                    chain_tasks = []
                    for chain_name, chain in CHAINS.items():
                        if chain.chain_type != ChainType.EVM:
                            continue
                        # Use Alchemy for supported chains, RPC for the rest
                        if alchemy.is_configured and alchemy.supports_chain(chain_name):
                            chain_tasks.append(_fetch_evm_chain_alchemy(chain_name, chain))
                        else:
                            chain_tasks.append(_fetch_evm_chain_rpc(chain_name, chain))

                    results = await asyncio.gather(*chain_tasks, return_exceptions=True)

                    for result in results:
                        if isinstance(result, tuple):
                            chain_name, chain_balances = result
                            if chain_balances:
                                balances[chain_name] = chain_balances

                elif chain_type == "solana":
                    chain_balances: dict[str, float] = {}

                    # Build all Solana tasks in parallel
                    tasks = []
                    task_keys = []

                    tasks.append(_safe_call(self.get_solana_native_balance(address)))
                    task_keys.append("SOL")

                    for token_symbol, token in TOKENS.items():
                        if "solana" in token.addresses:
                            tasks.append(_safe_call(
                                self.get_solana_token_balance(token_symbol, address)
                            ))
                            task_keys.append(token_symbol)

                    results = await asyncio.gather(*tasks, return_exceptions=True)

                    for key, result in zip(task_keys, results):
                        if isinstance(result, (int, float)) and result > 0:
                            chain_balances[key] = result

                    if chain_balances:
                        balances["solana"] = chain_balances

        except asyncio.TimeoutError:
            logger.warning(f"Global timeout fetching balances for {address}")

        return balances
    
    # === Transaction Signing ===
    
    async def sign_evm_transaction(self, wallet: Wallet, transaction: dict) -> str:
        """
        Sign an EVM transaction.
        
        Routes to Turnkey for Turnkey wallets, local signing for local wallets.
        
        Args:
            wallet: Wallet to sign with
            transaction: Transaction dict
            
        Returns:
            Signed transaction hex string
        """
        if wallet.is_turnkey_wallet:
            return await self._sign_evm_via_turnkey(wallet, transaction)
        
        # Local signing
        private_key = self.get_private_key(wallet)
        if not private_key.startswith("0x"):
            private_key = "0x" + private_key
        
        signed = Account.sign_transaction(transaction, private_key)
        return signed.raw_transaction.hex()
    
    async def sign_typed_data(self, wallet: Wallet, typed_data: dict) -> str:
        """Sign EIP-712 typed data. Routes to Turnkey for Turnkey wallets."""
        if wallet.is_turnkey_wallet:
            return await self._sign_typed_data_via_turnkey(wallet, typed_data)

        # Local signing
        from eth_account.messages import encode_typed_data

        private_key = self.get_private_key(wallet)
        if not private_key.startswith("0x"):
            private_key = "0x" + private_key

        account = Account.from_key(private_key)
        encoded_message = encode_typed_data(full_message=typed_data)
        signed = account.sign_message(encoded_message)
        return signed.signature.hex()

    async def _sign_typed_data_via_turnkey(self, wallet: Wallet, typed_data: dict) -> str:
        """Sign typed data via Turnkey."""
        from bot.services.turnkey_client import get_turnkey_client

        client = get_turnkey_client()
        return await client.sign_typed_data(
            typed_data=typed_data,
            sign_with=wallet.address,
            organization_id=wallet.turnkey_sub_org_id,
        )

    async def _sign_evm_via_turnkey(self, wallet: Wallet, transaction: dict) -> str:
        """Sign EVM transaction via Turnkey API."""
        from bot.services.turnkey_client import get_turnkey_client
        from rlp import encode as rlp_encode
        
        client = get_turnkey_client()
        
        # Serialize transaction to hex for Turnkey
        # Turnkey expects the unsigned transaction as hex
        unsigned_tx_hex = self._serialize_evm_transaction(transaction)
        
        signed_tx = await client.sign_transaction(
            unsigned_transaction=unsigned_tx_hex,
            sign_with=wallet.address,  # Sign with the wallet address
            transaction_type="TRANSACTION_TYPE_ETHEREUM",
            organization_id=wallet.turnkey_sub_org_id,
        )
        
        return signed_tx
    
    def _serialize_evm_transaction(self, transaction: dict) -> str:
        """Serialize an EVM transaction to hex for Turnkey signing."""
        # Create unsigned transaction bytes
        # For EIP-1559 transactions
        if "maxFeePerGas" in transaction:
            from eth_account._utils.typed_transactions import TypedTransaction
            typed_tx = TypedTransaction.from_dict(transaction)
            return "0x" + typed_tx.hash().hex()
        
        # For legacy transactions, build the serialized form
        tx_data = {
            "nonce": transaction.get("nonce", 0),
            "gasPrice": transaction.get("gasPrice", 0),
            "gas": transaction.get("gas", 21000),
            "to": bytes.fromhex(transaction["to"][2:]) if transaction.get("to") else b"",
            "value": transaction.get("value", 0),
            "data": bytes.fromhex(transaction.get("data", "0x")[2:]) if transaction.get("data") else b"",
        }
        
        # Return as hex string
        import rlp
        encoded = rlp.encode([
            tx_data["nonce"],
            tx_data["gasPrice"],
            tx_data["gas"],
            tx_data["to"],
            tx_data["value"],
            tx_data["data"],
            transaction.get("chainId", 1),
            0,
            0,
        ])
        return "0x" + encoded.hex()
    
    async def sign_solana_transaction(self, wallet: Wallet, transaction_bytes: bytes) -> bytes:
        """
        Sign a Solana transaction.
        
        Routes to Turnkey for Turnkey wallets, local signing for local wallets.
        
        Args:
            wallet: Wallet to sign with
            transaction_bytes: Serialized transaction
            
        Returns:
            Signed transaction bytes
        """
        if wallet.is_turnkey_wallet:
            return await self._sign_solana_via_turnkey(wallet, transaction_bytes)
        
        # Local signing
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
    
    async def _sign_solana_via_turnkey(self, wallet: Wallet, transaction_bytes: bytes) -> bytes:
        """Sign Solana transaction via Turnkey API."""
        from bot.services.turnkey_client import get_turnkey_client
        
        client = get_turnkey_client()
        
        # Convert transaction bytes to hex
        unsigned_tx_hex = "0x" + transaction_bytes.hex()
        
        signed_tx_hex = await client.sign_transaction(
            unsigned_transaction=unsigned_tx_hex,
            sign_with=wallet.address,
            transaction_type="TRANSACTION_TYPE_SOLANA",
            organization_id=wallet.turnkey_sub_org_id,
        )
        
        # Convert back to bytes
        return bytes.fromhex(signed_tx_hex.replace("0x", ""))
    
    def sign_evm_transaction_raw(
        self,
        encrypted_private_key: str,
        transaction: dict,
        encryption_scheme: str = None,
        kms_wrapped_dek: str = None,
        aesgcm_nonce: str = None,
        kms_key_id: str = None,
        key_version: int = None,
    ) -> str:
        """
        Sign an EVM transaction using encrypted private key directly.

        Supports both legacy and v2 encryption schemes.
        Not compatible with Turnkey wallets - use sign_evm_transaction() instead.

        Args:
            encrypted_private_key: Encrypted private key string
            transaction: Transaction dict
            encryption_scheme: Encryption scheme (None = legacy)
            kms_wrapped_dek: Base64 KMS-wrapped DEK (v2 only)
            aesgcm_nonce: Base64 AES-GCM nonce (v2 only)
            kms_key_id: KMS key identifier (v2 only)
            key_version: Key version (v2 only)

        Returns:
            Signed transaction hex string
        """
        if encrypted_private_key == "turnkey_managed":
            raise ValueError(
                "Cannot sign with raw method for Turnkey wallets. "
                "Use sign_evm_transaction() with a Wallet object instead."
            )
        from bot.utils.envelope_crypto import decrypt_wallet_key
        
        private_key = decrypt_wallet_key(
            encrypted_private_key=encrypted_private_key,
            encryption_scheme=encryption_scheme,
            kms_wrapped_dek=kms_wrapped_dek,
            aesgcm_nonce=aesgcm_nonce,
            kms_key_id=kms_key_id,
            key_version=key_version,
        )
        
        if not private_key.startswith("0x"):
            private_key = "0x" + private_key
        
        signed = Account.sign_transaction(transaction, private_key)
        return signed.raw_transaction.hex()
    
    def sign_solana_transaction_raw(
        self,
        encrypted_private_key: str,
        transaction_bytes: bytes,
        encryption_scheme: str = None,
        kms_wrapped_dek: str = None,
        aesgcm_nonce: str = None,
        kms_key_id: str = None,
        key_version: int = None,
    ) -> bytes:
        """
        Sign a Solana transaction using encrypted private key directly.

        Supports both legacy and v2 encryption schemes.
        Not compatible with Turnkey wallets - use sign_solana_transaction() instead.

        Args:
            encrypted_private_key: Encrypted private key string
            transaction_bytes: Serialized transaction
            encryption_scheme: Encryption scheme (None = legacy)
            kms_wrapped_dek: Base64 KMS-wrapped DEK (v2 only)
            aesgcm_nonce: Base64 AES-GCM nonce (v2 only)
            kms_key_id: KMS key identifier (v2 only)
            key_version: Key version (v2 only)

        Returns:
            Signed transaction bytes
        """
        if encrypted_private_key == "turnkey_managed":
            raise ValueError(
                "Cannot sign with raw method for Turnkey wallets. "
                "Use sign_solana_transaction() with a Wallet object instead."
            )
        from solders.transaction import VersionedTransaction
        from bot.utils.envelope_crypto import decrypt_wallet_key
        
        private_key = decrypt_wallet_key(
            encrypted_private_key=encrypted_private_key,
            encryption_scheme=encryption_scheme,
            kms_wrapped_dek=kms_wrapped_dek,
            aesgcm_nonce=aesgcm_nonce,
            kms_key_id=kms_key_id,
            key_version=key_version,
        )
        
        try:
            key_bytes = base58.b58decode(private_key)
        except Exception:
            key_bytes = bytes(json.loads(private_key))
        
        keypair = Keypair.from_bytes(key_bytes)
        
        # Deserialize, sign, and serialize
        tx = VersionedTransaction.from_bytes(transaction_bytes)
        tx.sign([keypair])
        
        return bytes(tx)

