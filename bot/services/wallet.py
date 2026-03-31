"""Wallet management service for EVM and Solana chains."""

import asyncio
import json
import logging
import time
from typing import Optional
from web3 import Web3
from eth_account import Account
from solders.keypair import Keypair
from solders.pubkey import Pubkey
from solana.rpc.async_api import AsyncClient as SolanaClient
import base58
import aiohttp

from bot.config.settings import settings
from bot.services.rpc_manager import rpc_manager
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
        self._solana_client: Optional[SolanaClient] = None

    def _get_web3(self, chain_name: str) -> Web3:
        """Get Web3 instance for a chain via RPCManager."""
        from bot.services.rpc_manager import rpc_manager
        return rpc_manager.get_web3(chain_name)

    def _web3_cache_url(self, chain_name: str) -> str:
        """Get the URL currently cached for a chain (for failure reporting)."""
        cached = rpc_manager._web3_cache.get(chain_name.lower())
        return cached[1] if cached else ""

    def _invalidate_web3(self, chain_name: str):
        """Invalidate cached Web3 so next call picks a fresh RPC."""
        from bot.services.rpc_manager import rpc_manager
        rpc_manager.invalidate(chain_name)

    async def _evm_rpc_call(self, chain_name: str, method: str, params: list, timeout: float = 3.5):
        """Make a JSON-RPC call via aiohttp — fully async, no thread pool blocking."""
        url = rpc_manager.get_rpc_url(chain_name)
        payload = {"jsonrpc": "2.0", "method": method, "params": params, "id": 1}
        t0 = time.monotonic()
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    url, json=payload,
                    timeout=aiohttp.ClientTimeout(total=timeout),
                ) as resp:
                    if resp.status == 429:
                        raise ConnectionError("rate_limited_429")
                    if resp.status != 200:
                        raise ConnectionError(f"http_{resp.status}")
                    data = await resp.json()
                    if "error" in data:
                        raise ConnectionError(f"rpc_error: {str(data['error'])[:60]}")
                    rpc_manager.report_success(chain_name, url, (time.monotonic() - t0) * 1000)
                    return data.get("result")
        except Exception as e:
            rpc_manager.report_failure(chain_name, url, str(e)[:80])
            raise
    
    async def _get_solana_client(self) -> SolanaClient:
        """Get or create a Solana RPC client."""
        if self._solana_client is None:
            rpc_url = rpc_manager.get_rpc_url("solana")
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

    def create_tron_wallet(self) -> tuple[str, str]:
        """
        Create a new TRON wallet.

        Returns:
            Tuple of (address, private_key as hex)
        """
        from tronpy.keys import PrivateKey
        pk = PrivateKey.random()
        address = pk.public_key.to_base58check_address()
        return address, pk.hex()

    async def create_wallet(self, user_id: int, name: str, chain_type: str = "evm"):
        """
        Convenience method to create and save a wallet in one call.

        Routes to Turnkey if configured, otherwise creates local wallet.

        Args:
            user_id: Target user
            name: Label for the wallet
            chain_type: "evm", "solana", or "tron"

        Returns:
            Wallet object
        """
        # Check if Turnkey is configured (Turnkey doesn't support TRON yet)
        if settings.wallet_provider == "turnkey" and chain_type != "tron":
            return await self._create_turnkey_wallet(user_id, name, chain_type)

        # Local wallet creation
        if chain_type == "evm":
            address, pk = self.create_evm_wallet()
        elif chain_type == "solana":
            address, pk = self.create_solana_wallet()
        elif chain_type == "tron":
            address, pk = self.create_tron_wallet()
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

        # Export and backup private key from Turnkey (with retry)
        export_success = False
        for attempt in range(2):
            try:
                wallet_obj = self.get_wallet_by_id(wallet_id)
                if wallet_obj:
                    from bot.services.turnkey_export import export_and_backup_wallet
                    with get_session() as session:
                        attached = session.query(Wallet).filter(Wallet.id == wallet_id).first()
                        if attached:
                            await export_and_backup_wallet(attached, client, session)
                            export_success = True
                            break
            except Exception as e:
                logger.warning(f"Backup key export attempt {attempt + 1}/2 failed for wallet {wallet_id}: {e}")
                if attempt == 0:
                    import asyncio
                    await asyncio.sleep(2)

        if not export_success:
            logger.error(f"Backup key export FAILED for wallet {wallet_id} after 2 attempts — fallback signing will NOT work for this wallet")

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

    def import_tron_wallet(self, private_key: str) -> str:
        """
        Import a TRON wallet from private key.

        Args:
            private_key: Private key (64 hex chars, with or without 0x prefix)

        Returns:
            TRON wallet address (base58check, starts with T)

        Raises:
            ValueError: If private key is invalid
        """
        if not validate_private_key(private_key, "tron"):
            raise ValueError("Invalid TRON private key")

        from tronpy.keys import PrivateKey as TronPrivateKey
        key_hex = private_key.replace("0x", "")
        pk = TronPrivateKey(bytes.fromhex(key_hex))
        return pk.public_key.to_base58check_address()

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
    
    def get_backup_private_key(self, wallet: Wallet) -> str:
        """
        Get the backup private key for a Turnkey wallet.

        Turnkey wallets store an encrypted backup key (exported at creation time)
        in the same DB columns as local wallets. This method decrypts and returns it.

        Args:
            wallet: Wallet object (must have backup key exported)

        Returns:
            Decrypted private key string

        Raises:
            ValueError: If no backup key exists for this wallet
        """
        if not wallet.encrypted_private_key or wallet.encrypted_private_key == "turnkey_managed":
            raise ValueError(f"No backup key for wallet {wallet.id}")

        return get_private_key_with_auto_migrate(wallet, auto_migrate=False)

    def get_tron_private_key(self, wallet: Wallet) -> str:
        """Get the private key for a TRON wallet (handles Turnkey backup fallback).

        Returns:
            Hex-encoded private key string (without 0x prefix)
        """
        if wallet.is_turnkey_wallet:
            pk = self.get_backup_private_key(wallet)
        else:
            pk = self.get_private_key(wallet)
        return pk.replace("0x", "")

    # === Balance Checking ===

    async def get_evm_token_balance(
        self,
        chain_name: str,
        token_symbol: str,
        address: str,
    ) -> float:
        """Get ERC20 token balance via direct aiohttp JSON-RPC (no executor)."""
        token_address = get_token_address(token_symbol, chain_name)
        if not token_address:
            return 0.0

        # Skip zero/null addresses (native tokens listed as 0x000...0)
        if token_address.replace("0x", "").strip("0") == "":
            return await self.get_evm_native_balance(chain_name, address)

        # ABI-encode balanceOf(address): selector + 32-byte padded address
        selector = "70a08231"
        padded_addr = address.lower().replace("0x", "").zfill(64)
        data = f"0x{selector}{padded_addr}"
        checksum_contract = Web3.to_checksum_address(token_address)

        try:
            result = await self._evm_rpc_call(
                chain_name,
                "eth_call",
                [{"to": checksum_contract, "data": data}, "latest"],
            )
            if not result or result == "0x":
                return 0.0
            balance_raw = int(result, 16)
            decimals = get_token_decimals(token_symbol, chain_name)
            return balance_raw / (10 ** decimals)
        except Exception:
            return 0.0

    async def get_evm_native_balance(self, chain_name: str, address: str) -> float:
        """Get native token balance (ETH, BNB, etc.) via direct aiohttp JSON-RPC."""
        # Tempo has no native gas token — skip entirely.
        if chain_name == "tempo":
            return 0.0

        chain = get_chain_by_name(chain_name)
        if not chain:
            return 0.0

        checksum = Web3.to_checksum_address(address)
        try:
            result = await self._evm_rpc_call(
                chain_name,
                "eth_getBalance",
                [checksum, "latest"],
            )
            if not result:
                return 0.0
            return int(result, 16) / (10 ** chain.native_decimals)
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
            Token balance as float, or raises on RPC error
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
                async with session.post(rpc_manager.get_rpc_url("solana"), json=payload) as resp:
                    if resp.status == 429:
                        logger.warning(f"Solana RPC rate limited (429) fetching {token_symbol} for {address[:8]}...")
                        raise ConnectionError("Solana RPC rate limited")
                    if resp.status >= 400:
                        logger.warning(f"Solana RPC HTTP {resp.status} fetching {token_symbol}")
                        raise ConnectionError(f"Solana RPC HTTP {resp.status}")

                    result = await resp.json()

                    if "error" in result:
                        logger.warning(f"Solana RPC error fetching {token_symbol}: {result['error']}")
                        raise ConnectionError(f"Solana RPC error: {result['error']}")

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
        except ConnectionError:
            raise  # Let RPC errors propagate to _safe_call
        except Exception as e:
            logger.warning(f"Failed to fetch Solana token balance: {e}")
            return 0.0

    async def get_solana_native_balance(self, address: str) -> float:
        """Get SOL balance for an address. Raises on RPC error."""
        try:
            async with aiohttp.ClientSession() as session:
                payload = {
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "getBalance",
                    "params": [address]
                }
                async with session.post(rpc_manager.get_rpc_url("solana"), json=payload) as resp:
                    if resp.status == 429:
                        logger.warning(f"Solana RPC rate limited (429) fetching SOL for {address[:8]}...")
                        raise ConnectionError("Solana RPC rate limited")
                    if resp.status >= 400:
                        logger.warning(f"Solana RPC HTTP {resp.status} fetching SOL balance")
                        raise ConnectionError(f"Solana RPC HTTP {resp.status}")

                    result = await resp.json()

                    if "error" in result:
                        logger.warning(f"Solana RPC error for {address[:8]}...: {result['error']}")
                        raise ConnectionError(f"Solana RPC error: {result['error']}")

                    if "result" in result:
                        lamports = result["result"]["value"]
                        return lamports / 1e9  # Convert lamports to SOL

            return 0.0
        except ConnectionError:
            raise  # Let RPC errors propagate to _safe_call
        except Exception as e:
            logger.warning(f"Failed to fetch SOL balance for {address[:8]}...: {e}")
            return 0.0

    async def get_tron_native_balance(self, address: str) -> float:
        """Get TRX balance for a TRON address."""
        try:
            rpc_url = rpc_manager.get_rpc_url("tron") or "https://api.trongrid.io"
            async with aiohttp.ClientSession() as session:
                url = f"{rpc_url}/v1/accounts/{address}"
                async with session.get(url) as resp:
                    result = await resp.json()
                    if "data" in result and result["data"]:
                        balance = result["data"][0].get("balance", 0)
                        return balance / 1e6
            return 0.0
        except Exception as e:
            logger.warning(f"Failed to fetch TRX balance for {address[:8]}...: {e}")
            return 0.0

    async def get_tron_token_balance(self, token_symbol: str, address: str) -> float:
        """Get TRC20 token balance for a TRON address."""
        token_address = get_token_address(token_symbol, "tron")
        if not token_address or token_address == "native":
            return 0.0

        try:
            rpc_url = rpc_manager.get_rpc_url("tron") or "https://api.trongrid.io"
            async with aiohttp.ClientSession() as session:
                url = f"{rpc_url}/v1/accounts/{address}/tokens"
                async with session.get(url) as resp:
                    result = await resp.json()
                    if "data" in result:
                        for token_data in result["data"]:
                            if token_data.get("tokenId") == token_address:
                                decimals = token_data.get("tokenDecimal", 6)
                                balance = int(token_data.get("balance", 0))
                                return balance / (10 ** decimals)
            return 0.0
        except Exception as e:
            logger.warning(f"Failed to fetch TRC20 token balance for {address[:8]}...: {e}")
            return 0.0

    async def get_all_balances(self, wallet: Wallet) -> dict[str, dict[str, float]]:
        """
        Get all token balances for a wallet.

        Returns:
            Dict of chain_name -> {token_symbol: balance}

        Uses asyncio.gather to fetch all chains/tokens in parallel instead of
        sequentially, reducing latency from O(chains * tokens) to O(max_rpc_latency).
        """
        import asyncio
        from bot.config.tokens import TOKENS

        # Limit concurrency to avoid RPC rate limits
        sem = asyncio.Semaphore(10)

        async def _safe_fetch(coro):
            async with sem:
                try:
                    return await coro
                except Exception:
                    return 0.0

        balances: dict[str, dict[str, float]] = {}

        if wallet.chain_type == "evm":
            # Build all fetch tasks across all EVM chains in parallel
            async def _fetch_evm_chain(chain_name, chain):
                chain_balances: dict[str, float] = {}

                # Build tasks: native + all tokens for this chain
                tasks = []
                task_labels = []

                tasks.append(_safe_fetch(self.get_evm_native_balance(chain_name, wallet.address)))
                task_labels.append(chain.native_token)

                for token_symbol, token in TOKENS.items():
                    if chain_name in token.addresses:
                        tasks.append(_safe_fetch(self.get_evm_token_balance(
                            chain_name, token_symbol, wallet.address
                        )))
                        task_labels.append(token_symbol)

                results = await asyncio.gather(*tasks)
                for label, bal in zip(task_labels, results):
                    if isinstance(bal, (int, float)) and bal > 0:
                        chain_balances[label] = bal

                return chain_name, chain_balances

            # Launch all chains in parallel
            chain_tasks = [
                _fetch_evm_chain(chain_name, chain)
                for chain_name, chain in CHAINS.items()
                if chain.chain_type == ChainType.EVM
            ]
            chain_results = await asyncio.gather(*chain_tasks, return_exceptions=True)
            for result in chain_results:
                if isinstance(result, tuple):
                    name, chain_bal = result
                    if chain_bal:
                        balances[name] = chain_bal

        elif wallet.chain_type == "solana":
            chain_balances: dict[str, float] = {}

            # Parallel: SOL native + all SPL tokens
            tasks = []
            task_labels = []

            tasks.append(_safe_fetch(self.get_solana_native_balance(wallet.address)))
            task_labels.append("SOL")

            for token_symbol, token in TOKENS.items():
                if "solana" in token.addresses:
                    tasks.append(_safe_fetch(self.get_solana_token_balance(token_symbol, wallet.address)))
                    task_labels.append(token_symbol)

            results = await asyncio.gather(*tasks)
            for label, bal in zip(task_labels, results):
                if isinstance(bal, (int, float)) and bal > 0:
                    chain_balances[label] = bal

            if chain_balances:
                balances["solana"] = chain_balances

        elif wallet.chain_type == "tron":
            chain_balances: dict[str, float] = {}

            # Parallel: TRX native + all TRC20 tokens
            tasks = []
            task_labels = []

            tasks.append(_safe_fetch(self.get_tron_native_balance(wallet.address)))
            task_labels.append("TRX")

            for token_symbol, token in TOKENS.items():
                if "tron" in token.addresses and token.addresses["tron"] != "native":
                    tasks.append(_safe_fetch(self.get_tron_token_balance(token_symbol, wallet.address)))
                    task_labels.append(token_symbol)

            results = await asyncio.gather(*tasks)
            for label, bal in zip(task_labels, results):
                if isinstance(bal, (int, float)) and bal > 0:
                    chain_balances[label] = bal

            if chain_balances:
                balances["tron"] = chain_balances

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

        # Don't cache empty results caused by RPC failures
        rpc_failed = balances.pop("_solana_rpc_failed", False)
        if not rpc_failed:
            await balance_cache.set(cache_key, balances)
        else:
            logger.warning(f"Skipping cache for {chain_type}:{address[:8]}... due to RPC failures")

        return balances

    async def _fetch_balances_live(self, address: str, chain_type: str) -> dict[str, dict[str, float]]:
        """Fetch balances from RPCs / Alchemy (no caching)."""
        from bot.config.tokens import TOKENS

        CALL_TIMEOUT = 4  # seconds per RPC call (must exceed HTTPProvider timeout of 3s)
        GLOBAL_TIMEOUT = 20  # seconds for entire balance fetch

        balances: dict[str, dict[str, float]] = {}

        async def _safe_call(coro, default=0.0):
            """Wrap an RPC call with a timeout. Returns None on RPC errors (not 0.0)."""
            try:
                return await asyncio.wait_for(coro, timeout=CALL_TIMEOUT)
            except asyncio.TimeoutError:
                logger.warning("RPC call timed out")
                return None  # Distinguish timeout from zero balance
            except ConnectionError as e:
                logger.warning(f"RPC connection error: {e}")
                return None  # RPC failed — don't report as zero
            except Exception as e:
                logger.warning(f"Unexpected RPC error: {e}")
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
                    # Always use RPC rotator — Alchemy token batch API has monthly caps
                    # that take down ALL balance fetching when exceeded. The RPC manager
                    # handles failover across chainlist.org + configured endpoints.
                    chain_tasks = []
                    for chain_name, chain in CHAINS.items():
                        if chain.chain_type != ChainType.EVM:
                            continue
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

                    any_rpc_failed = False
                    for key, result in zip(task_keys, results):
                        if result is None:
                            any_rpc_failed = True  # RPC error — don't treat as zero
                        elif isinstance(result, (int, float)) and result > 0:
                            chain_balances[key] = result

                    if chain_balances:
                        balances["solana"] = chain_balances
                    elif any_rpc_failed:
                        # Mark that Solana fetch failed — prevents caching empty as truth
                        balances["_solana_rpc_failed"] = True

                elif chain_type == "tron":
                    chain_balances: dict[str, float] = {}

                    tasks = []
                    task_keys = []

                    tasks.append(_safe_call(self.get_tron_native_balance(address)))
                    task_keys.append("TRX")

                    for token_symbol, token in TOKENS.items():
                        if "tron" in token.addresses and token.addresses["tron"] != "native":
                            tasks.append(_safe_call(
                                self.get_tron_token_balance(token_symbol, address)
                            ))
                            task_keys.append(token_symbol)

                    results = await asyncio.gather(*tasks, return_exceptions=True)

                    for key, result in zip(task_keys, results):
                        if isinstance(result, (int, float)) and result > 0:
                            chain_balances[key] = result

                    if chain_balances:
                        balances["tron"] = chain_balances

        except asyncio.TimeoutError:
            logger.warning(f"Global timeout fetching balances for {address}")

        return balances
    
    # === Transaction Signing ===
    
    async def sign_evm_transaction(self, wallet: Wallet, transaction: dict) -> str:
        """
        Sign an EVM transaction.

        Routes to Turnkey for Turnkey wallets, local signing for local wallets.
        Falls back to local signing using backup key if Turnkey is unavailable.

        Args:
            wallet: Wallet to sign with
            transaction: Transaction dict

        Returns:
            Signed transaction hex string
        """
        if wallet.is_turnkey_wallet:
            from bot.services.turnkey_fallback import sign_evm_with_fallback
            return await sign_evm_with_fallback(self, wallet, transaction)

        return self._sign_evm_local(wallet, transaction)

    def _sign_evm_local(self, wallet: Wallet, transaction: dict) -> str:
        """Sign EVM transaction with local private key."""
        private_key = self.get_private_key(wallet)
        if not private_key.startswith("0x"):
            private_key = "0x" + private_key

        signed = Account.sign_transaction(transaction, private_key)
        return signed.raw_transaction.hex()
    
    async def sign_typed_data(self, wallet: Wallet, typed_data: dict) -> str:
        """Sign EIP-712 typed data. Falls back to local signing if Turnkey is down."""
        if wallet.is_turnkey_wallet:
            from bot.services.turnkey_fallback import sign_typed_data_with_fallback
            return await sign_typed_data_with_fallback(self, wallet, typed_data)

        return self._sign_typed_data_local(wallet, typed_data)

    def _sign_typed_data_local(self, wallet: Wallet, typed_data: dict) -> str:
        """Sign EIP-712 typed data with local private key."""
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
        Sign a Solana transaction. Falls back to local signing if Turnkey is down.

        Args:
            wallet: Wallet to sign with
            transaction_bytes: Serialized transaction

        Returns:
            Signed transaction bytes
        """
        if wallet.is_turnkey_wallet:
            from bot.services.turnkey_fallback import sign_solana_with_fallback
            return await sign_solana_with_fallback(self, wallet, transaction_bytes)

        return self._sign_solana_local(wallet, transaction_bytes)

    def _sign_solana_local(self, wallet: Wallet, transaction_bytes: bytes) -> bytes:
        """Sign Solana transaction with local private key."""
        from solders.transaction import VersionedTransaction

        private_key = self.get_private_key(wallet)

        try:
            key_bytes = base58.b58decode(private_key)
        except Exception:
            key_bytes = bytes(json.loads(private_key))

        keypair = Keypair.from_bytes(key_bytes)
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

    async def sign_and_broadcast_tron_transaction(self, wallet: Wallet, tx_request: dict) -> str:
        """
        Sign and broadcast a TRON transaction from Li.Fi tx_request.

        TRON transactions must be signed and broadcast through TronGrid/fullnode API.
        Li.Fi returns the raw transaction JSON which we sign locally and submit.
        For Turnkey wallets with backup keys, uses the backup key for local signing.

        Args:
            wallet: Wallet to sign with
            tx_request: Li.Fi transaction request containing TRON transaction data

        Returns:
            Transaction hash (txID)
        """
        from tronpy.keys import PrivateKey as TronPrivateKey

        # TRON always signs locally — use backup key for Turnkey wallets
        if wallet.is_turnkey_wallet:
            private_key_hex = self.get_backup_private_key(wallet)
        else:
            private_key_hex = self.get_private_key(wallet)
        pk = TronPrivateKey(bytes.fromhex(private_key_hex.replace("0x", "")))

        rpc_url = rpc_manager.get_rpc_url("tron") or "https://api.trongrid.io"

        # Li.Fi provides the raw TRON transaction in tx_request
        raw_txn = tx_request.get("rawTransaction") or tx_request
        tx_id = raw_txn.get("txID", "")
        raw_data_hex = raw_txn.get("raw_data_hex", "")

        # Sign the transaction ID (32-byte hash)
        signature = pk.sign(bytes.fromhex(tx_id))

        # Broadcast via TronGrid API
        signed_payload = {
            "raw_data": raw_txn.get("raw_data", {}),
            "raw_data_hex": raw_data_hex,
            "txID": tx_id,
            "signature": [signature.hex()],
        }

        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{rpc_url}/wallet/broadcasttransaction",
                json=signed_payload,
            ) as resp:
                result = await resp.json()
                if result.get("result") is True:
                    return result.get("txid", tx_id)
                error_msg = result.get("message", "Unknown error")
                if isinstance(error_msg, str) and error_msg.startswith("0x"):
                    error_msg = bytes.fromhex(error_msg[2:]).decode("utf-8", errors="replace")
                raise Exception(f"TRON broadcast failed: {error_msg}")

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

