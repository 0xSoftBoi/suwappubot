"""Hot wallet management service for custodial operations."""

import asyncio
import logging
from typing import Optional, Tuple
from decimal import Decimal
from datetime import datetime, timezone
from web3 import Web3
from eth_account import Account
import aiohttp
import base58

from bot.config.settings import settings
from bot.services.rpc_manager import rpc_manager
from bot.config.chains import CHAINS, ChainType, get_chain_by_name
from bot.config.tokens import get_token_address, get_token_decimals, NATIVE_TOKEN_ADDRESS
from bot.utils.encryption import encrypt_private_key, decrypt_private_key
from bot.utils.envelope_crypto import (
    encrypt_private_key_v2,
    encode_for_db,
    get_private_key_with_auto_migrate,
    SCHEME_LEGACY_FERNET_V1,
    SCHEME_KMS_AESGCM_V2,
)
from bot.models.custodial import (
    HotWallet,
    CustodialBalance,
    CustodialTransaction,
    TransactionType,
    TransactionStatus,
)
from database.db import get_session

logger = logging.getLogger(__name__)


class HotWalletService:
    """Service for managing hot wallets and custodial balances."""

    def _get_web3(self, chain_name: str) -> Web3:
        """Get Web3 instance for a chain via RPCManager."""
        from bot.services.rpc_manager import rpc_manager

        return rpc_manager.get_web3(chain_name)

    # === Hot Wallet Management ===

    async def create_hot_wallet(
        self,
        name: str,
        chain_type: str,
        is_deposit_wallet: bool = True,
        is_gas_payer: bool = False,
    ) -> HotWallet:
        """
        Create a new hot wallet.

        Routes to Turnkey if configured, otherwise creates local wallet.
        """
        # Check if Turnkey is configured
        if settings.wallet_provider == "turnkey":
            return await self._create_turnkey_hot_wallet(
                name, chain_type, is_deposit_wallet, is_gas_payer
            )

        # Local hot wallet creation
        return self._create_local_hot_wallet(name, chain_type, is_deposit_wallet, is_gas_payer)

    def _create_local_hot_wallet(
        self,
        name: str,
        chain_type: str,
        is_deposit_wallet: bool,
        is_gas_payer: bool,
    ) -> HotWallet:
        """Create a local hot wallet with encrypted private key."""
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

        # Use envelope encryption (v2) or legacy based on settings
        use_v2 = settings.wallet_encryption_scheme == SCHEME_KMS_AESGCM_V2

        if use_v2:
            encrypted = encrypt_private_key_v2(private_key)
            db_fields = encode_for_db(encrypted)
        else:
            db_fields = {
                "encrypted_private_key": encrypt_private_key(private_key, settings.encryption_key),
                "encryption_scheme": SCHEME_LEGACY_FERNET_V1,
                "kms_wrapped_dek": None,
                "aesgcm_nonce": None,
                "kms_key_id": None,
                "key_version": 1,
            }

        with get_session() as session:
            wallet = HotWallet(
                name=name,
                chain_type=chain_type,
                address=address,
                encrypted_private_key=db_fields["encrypted_private_key"],
                encryption_scheme=db_fields["encryption_scheme"],
                kms_wrapped_dek=db_fields.get("kms_wrapped_dek"),
                aesgcm_nonce=db_fields.get("aesgcm_nonce"),
                kms_key_id=db_fields.get("kms_key_id"),
                key_version=db_fields.get("key_version", 1),
                wallet_provider="local",
                is_deposit_wallet=is_deposit_wallet,
                is_gas_payer=is_gas_payer,
            )
            session.add(wallet)
            session.flush()
            wallet_id = wallet.id

        return self.get_hot_wallet_by_id(wallet_id)

    async def _create_turnkey_hot_wallet(
        self,
        name: str,
        chain_type: str,
        is_deposit_wallet: bool,
        is_gas_payer: bool,
    ) -> HotWallet:
        """Create a hot wallet via Turnkey (in main organization)."""
        from bot.services.turnkey_client import get_turnkey_client

        client = get_turnkey_client()

        # Create wallet in main organization (for hot wallets)
        turnkey_wallet = await client.create_wallet(
            wallet_name=f"hot_{name}_{chain_type}",
            chain_type=chain_type,
            organization_id=None,  # Use parent org
        )

        if not turnkey_wallet.address:
            raise RuntimeError("Turnkey hot wallet creation failed: no address returned")

        with get_session() as session:
            wallet = HotWallet(
                name=name,
                chain_type=chain_type,
                address=turnkey_wallet.address,
                # For Turnkey wallets, use a placeholder to satisfy NOT NULL constraints if they exist
                encrypted_private_key="turnkey_managed",
                encryption_scheme="turnkey",
                wallet_provider="turnkey",
                turnkey_wallet_id=turnkey_wallet.wallet_id,
                turnkey_account_id=turnkey_wallet.account_id,
                is_deposit_wallet=is_deposit_wallet,
                is_gas_payer=is_gas_payer,
            )
            session.add(wallet)
            session.flush()
            wallet_id = wallet.id

        logger.info(f"Created Turnkey hot wallet: {turnkey_wallet.address}")
        return self.get_hot_wallet_by_id(wallet_id)

    def import_hot_wallet(
        self,
        name: str,
        chain_type: str,
        private_key: str,
        is_deposit_wallet: bool = True,
        is_gas_payer: bool = False,
    ) -> HotWallet:
        """Import an existing wallet as hot wallet with KMS envelope encryption (v2)."""
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

        # Use envelope encryption (v2) or legacy based on settings
        use_v2 = settings.wallet_encryption_scheme == SCHEME_KMS_AESGCM_V2

        if use_v2:
            encrypted = encrypt_private_key_v2(private_key)
            db_fields = encode_for_db(encrypted)
        else:
            db_fields = {
                "encrypted_private_key": encrypt_private_key(private_key, settings.encryption_key),
                "encryption_scheme": SCHEME_LEGACY_FERNET_V1,
                "kms_wrapped_dek": None,
                "aesgcm_nonce": None,
                "kms_key_id": None,
                "key_version": 1,
            }

        with get_session() as session:
            wallet = HotWallet(
                name=name,
                chain_type=chain_type,
                address=address,
                encrypted_private_key=db_fields["encrypted_private_key"],
                encryption_scheme=db_fields["encryption_scheme"],
                kms_wrapped_dek=db_fields.get("kms_wrapped_dek"),
                aesgcm_nonce=db_fields.get("aesgcm_nonce"),
                kms_key_id=db_fields.get("kms_key_id"),
                key_version=db_fields.get("key_version", 1),
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
            return (
                session.query(HotWallet)
                .filter(
                    HotWallet.chain_type == chain_type,
                    HotWallet.is_deposit_wallet == True,
                    HotWallet.is_active == True,
                )
                .first()
            )

    def get_gas_payer_wallet(self, chain_type: str) -> Optional[HotWallet]:
        """Get the gas payer wallet for a chain type."""
        with get_session() as session:
            return (
                session.query(HotWallet)
                .filter(
                    HotWallet.chain_type == chain_type,
                    HotWallet.is_gas_payer == True,
                    HotWallet.is_active == True,
                )
                .first()
            )

    def get_private_key(self, wallet: HotWallet, auto_migrate: bool = True) -> str:
        """
        Decrypt and return private key.

        Handles both legacy (Fernet) and v2 (KMS + AES-GCM) encryption schemes.
        Optionally auto-migrates legacy wallets to v2 on first access.

        Note: Turnkey wallets do not have accessible private keys.

        Args:
            wallet: HotWallet object
            auto_migrate: Whether to migrate legacy wallets to v2

        Returns:
            Decrypted private key string

        Raises:
            ValueError: If wallet is a Turnkey wallet
        """
        # Turnkey wallets don't have local private keys
        if wallet.is_turnkey_wallet:
            raise ValueError(
                "Cannot access private key for Turnkey hot wallet. "
                "Use send_native_token or send_token instead."
            )

        with get_session() as session:
            # Re-attach wallet to session for potential migration update
            wallet = session.merge(wallet)
            return get_private_key_with_auto_migrate(
                wallet_row=wallet,
                session=session,
                auto_migrate=auto_migrate,
            )

    # === Balance Management ===

    def get_custodial_balance(
        self,
        user_id: int,
        chain: str,
        token_symbol: str,
    ) -> Decimal:
        """Get user's custodial balance for a token."""
        with get_session() as session:
            balance = (
                session.query(CustodialBalance)
                .filter(
                    CustodialBalance.user_id == user_id,
                    CustodialBalance.chain == chain,
                    CustodialBalance.token_symbol == token_symbol,
                )
                .first()
            )

            if balance:
                return Decimal(balance.balance)
            return Decimal("0")

    def get_all_custodial_balances(self, user_id: int) -> dict[str, dict[str, Decimal]]:
        """Get all custodial balances for a user."""
        with get_session() as session:
            balances = (
                session.query(CustodialBalance)
                .filter(
                    CustodialBalance.user_id == user_id,
                )
                .all()
            )

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
            balance = (
                session.query(CustodialBalance)
                .filter(
                    CustodialBalance.user_id == user_id,
                    CustodialBalance.chain == chain,
                    CustodialBalance.token_symbol == token_symbol,
                )
                .first()
            )

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
            return (
                session.query(CustodialTransaction).filter(CustodialTransaction.id == tx_id).first()
            )

    def update_transaction_status(
        self,
        tx_id: int,
        status: TransactionStatus,
        tx_hash: Optional[str] = None,
    ) -> None:
        """Update transaction status."""
        with get_session() as session:
            tx = (
                session.query(CustodialTransaction).filter(CustodialTransaction.id == tx_id).first()
            )

            if tx:
                tx.status = status.value
                if tx_hash:
                    tx.tx_hash = tx_hash
                if status == TransactionStatus.COMPLETED:
                    tx.completed_at = datetime.now(timezone.utc)

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
        native_balance = Decimal(str(native_wei)) / Decimal(10**18)

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
                    except Exception as e:
                        logger.debug(f"Failed to fetch {token_symbol} balance: {e}")

        return native_balance, token_balances

    async def _get_erc20_balance(
        self,
        web3: Web3,
        token_address: str,
        wallet_address: str,
        decimals: int,
    ) -> Decimal:
        """Get ERC20 token balance."""
        abi = [
            {
                "constant": True,
                "inputs": [{"name": "_owner", "type": "address"}],
                "name": "balanceOf",
                "outputs": [{"name": "balance", "type": "uint256"}],
                "type": "function",
            }
        ]

        contract = web3.eth.contract(address=Web3.to_checksum_address(token_address), abi=abi)

        balance = contract.functions.balanceOf(Web3.to_checksum_address(wallet_address)).call()
        return Decimal(str(balance)) / Decimal(10**decimals)

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
                    "params": [wallet.address],
                }
                async with session.post(rpc_manager.get_rpc_url("solana"), json=payload) as resp:
                    result = await resp.json()
                    if "result" in result:
                        lamports = result["result"]["value"]
                        native_balance = Decimal(str(lamports)) / Decimal(10**9)
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
        if wallet.chain_type == "solana":
            return await self._send_sol_native(wallet, to_address, amount)
        elif wallet.chain_type != "evm":
            raise NotImplementedError(f"Chain type {wallet.chain_type} not supported")

        web3 = self._get_web3(chain_name)
        chain = get_chain_by_name(chain_name)

        amount_wei = int(amount * Decimal(10**18))

        # Build transaction
        nonce = web3.eth.get_transaction_count(Web3.to_checksum_address(wallet.address))
        gas_price = web3.eth.gas_price

        tx = {
            "nonce": nonce,
            "to": Web3.to_checksum_address(to_address),
            "value": amount_wei,
            "gas": 21000,
            "gasPrice": gas_price,
            "chainId": chain.chain_id,
        }

        # Sign based on wallet provider
        if wallet.is_turnkey_wallet:
            signed_tx_hex = await self._sign_via_turnkey(wallet, tx)
            tx_hash = web3.eth.send_raw_transaction(bytes.fromhex(signed_tx_hex.replace("0x", "")))
        else:
            private_key = self.get_private_key(wallet)
            if not private_key.startswith("0x"):
                private_key = "0x" + private_key
            signed = Account.sign_transaction(tx, private_key)
            tx_hash = web3.eth.send_raw_transaction(signed.rawTransaction)

        return tx_hash.hex()

    async def _send_sol_native(
        self,
        wallet: HotWallet,
        to_address: str,
        amount: Decimal,
    ) -> str:
        """Send native SOL from hot wallet. Returns transaction signature."""
        from solana.rpc.async_api import AsyncClient
        from solders.keypair import Keypair
        from solders.pubkey import Pubkey
        from solders.system_program import transfer, TransferParams
        from solders.transaction import Transaction
        from solders.message import Message

        # Get Solana RPC URL
        rpc_url = getattr(settings, "solana_rpc_url", None)
        if not rpc_url:
            raise ValueError("Solana RPC URL not configured")

        # Decrypt private key and restore keypair
        private_key = self.get_private_key(wallet)
        key_bytes = base58.b58decode(private_key)
        keypair = Keypair.from_bytes(key_bytes)

        # Convert amount to lamports (1 SOL = 10^9 lamports)
        lamports = int(amount * Decimal(10**9))

        # Create async client
        async with AsyncClient(rpc_url) as client:
            # Build transfer instruction
            transfer_ix = transfer(
                TransferParams(
                    from_pubkey=keypair.pubkey(),
                    to_pubkey=Pubkey.from_string(to_address),
                    lamports=lamports,
                )
            )

            # Get recent blockhash
            blockhash_resp = await client.get_latest_blockhash()
            recent_blockhash = blockhash_resp.value.blockhash

            # Create and sign transaction
            message = Message.new_with_blockhash(
                [transfer_ix],
                keypair.pubkey(),
                recent_blockhash,
            )
            tx = Transaction.new_unsigned(message)
            tx.sign([keypair], recent_blockhash)

            # Send transaction
            result = await client.send_transaction(tx)
            signature = str(result.value)

            logger.info(f"Sent {amount} SOL to {to_address}, signature: {signature}")
            return signature

    async def _send_spl_token(
        self,
        wallet: HotWallet,
        token_address: str,
        to_address: str,
        amount: Decimal,
        decimals: int,
    ) -> str:
        """Send SPL token from hot wallet. Returns transaction signature."""
        from solana.rpc.async_api import AsyncClient
        from solders.keypair import Keypair
        from solders.pubkey import Pubkey
        from solders.transaction import Transaction
        from solders.message import Message
        from spl.token.instructions import (
            transfer_checked,
            TransferCheckedParams,
            get_associated_token_address,
        )
        from spl.token.async_client import AsyncToken

        # Get Solana RPC URL
        rpc_url = getattr(settings, "solana_rpc_url", None)
        if not rpc_url:
            raise ValueError("Solana RPC URL not configured")

        # Decrypt private key and restore keypair
        private_key = self.get_private_key(wallet)
        key_bytes = base58.b58decode(private_key)
        keypair = Keypair.from_bytes(key_bytes)

        # Convert token addresses to Pubkey
        mint_pubkey = Pubkey.from_string(token_address)
        dest_pubkey = Pubkey.from_string(to_address)

        # Get associated token accounts
        source_ata = get_associated_token_address(keypair.pubkey(), mint_pubkey)
        dest_ata = get_associated_token_address(dest_pubkey, mint_pubkey)

        # Convert amount to token units
        amount_raw = int(amount * Decimal(10**decimals))

        # Create async client
        async with AsyncClient(rpc_url) as client:
            # Build transfer_checked instruction (validates decimals for safety)
            transfer_ix = transfer_checked(
                TransferCheckedParams(
                    program_id=Pubkey.from_string(
                        "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
                    ),  # SPL Token program
                    source=source_ata,
                    mint=mint_pubkey,
                    dest=dest_ata,
                    owner=keypair.pubkey(),
                    amount=amount_raw,
                    decimals=decimals,
                )
            )

            # Get recent blockhash
            blockhash_resp = await client.get_latest_blockhash()
            recent_blockhash = blockhash_resp.value.blockhash

            # Create and sign transaction
            message = Message.new_with_blockhash(
                [transfer_ix],
                keypair.pubkey(),
                recent_blockhash,
            )
            tx = Transaction.new_unsigned(message)
            tx.sign([keypair], recent_blockhash)

            # Send transaction
            result = await client.send_transaction(tx)
            signature = str(result.value)

            logger.info(
                f"Sent {amount} of token {token_address} to {to_address}, signature: {signature}"
            )
            return signature

    async def send_token(
        self,
        wallet: HotWallet,
        chain_name: str,
        token_address: str,
        to_address: str,
        amount: Decimal,
        decimals: int,
        memo: Optional[str] = None,
    ) -> str:
        """Send ERC20/SPL token from hot wallet. Returns tx hash/signature.

        ``memo`` is only honored for TIP-20 tokens on Tempo: it routes through the
        TIP-20 ``transferWithMemo(address,uint256,bytes32)`` extension (the official
        fixed-32-byte memo, via pytempo) so the payment carries an on-chain memo.
        Ignored on every other chain. None/empty → a plain ERC-20 ``transfer``.
        """
        if wallet.chain_type == "solana":
            return await self._send_spl_token(wallet, token_address, to_address, amount, decimals)
        elif wallet.chain_type != "evm":
            raise NotImplementedError(f"Chain type {wallet.chain_type} not supported")

        web3 = self._get_web3(chain_name)
        chain = get_chain_by_name(chain_name)

        amount_raw = int(amount * Decimal(10**decimals))
        nonce = web3.eth.get_transaction_count(Web3.to_checksum_address(wallet.address))
        gas_price = web3.eth.gas_price

        if chain_name.lower() == "tempo" and memo:
            # TIP-20 transferWithMemo (memo is a fixed bytes32; pytempo right-pads).
            from pytempo.contracts import TIP20

            call = TIP20(Web3.to_checksum_address(token_address)).transfer_with_memo(
                to=Web3.to_checksum_address(to_address),
                amount=amount_raw,
                memo=memo.encode("utf-8")[:32],
            )
            tx = {
                "to": Web3.to_checksum_address(token_address),
                "data": "0x" + call.data.hex(),
                "value": 0,
                "nonce": nonce,
                "gasPrice": gas_price,
                "chainId": chain.chain_id,
            }
        else:
            # ERC20 transfer ABI
            abi = [
                {
                    "constant": False,
                    "inputs": [
                        {"name": "_to", "type": "address"},
                        {"name": "_value", "type": "uint256"},
                    ],
                    "name": "transfer",
                    "outputs": [{"name": "", "type": "bool"}],
                    "type": "function",
                }
            ]
            contract = web3.eth.contract(address=Web3.to_checksum_address(token_address), abi=abi)
            tx = contract.functions.transfer(
                Web3.to_checksum_address(to_address), amount_raw
            ).build_transaction(
                {
                    "nonce": nonce,
                    "gasPrice": gas_price,
                    "chainId": chain.chain_id,
                }
            )

        # Estimate gas
        tx["gas"] = web3.eth.estimate_gas(tx)

        # Sign based on wallet provider
        if wallet.is_turnkey_wallet:
            signed_tx_hex = await self._sign_via_turnkey(wallet, tx)
            tx_hash = web3.eth.send_raw_transaction(bytes.fromhex(signed_tx_hex.replace("0x", "")))
        else:
            private_key = self.get_private_key(wallet)
            if not private_key.startswith("0x"):
                private_key = "0x" + private_key
            signed = Account.sign_transaction(tx, private_key)
            tx_hash = web3.eth.send_raw_transaction(signed.rawTransaction)

        return tx_hash.hex()

    async def _sign_via_turnkey(self, wallet: HotWallet, transaction: dict) -> str:
        """Sign a transaction via Turnkey API."""
        from bot.services.turnkey_client import get_turnkey_client
        import rlp

        client = get_turnkey_client()

        # Serialize transaction for Turnkey
        tx_data = [
            transaction.get("nonce", 0),
            transaction.get("gasPrice", 0),
            transaction.get("gas", 21000),
            bytes.fromhex(transaction["to"][2:]) if transaction.get("to") else b"",
            transaction.get("value", 0),
            bytes.fromhex(transaction.get("data", "0x")[2:]) if transaction.get("data") else b"",
            transaction.get("chainId", 1),
            0,
            0,
        ]
        encoded = rlp.encode(tx_data)
        unsigned_tx_hex = "0x" + encoded.hex()

        signed_tx = await client.sign_transaction(
            unsigned_transaction=unsigned_tx_hex,
            sign_with=wallet.address,
            transaction_type="TRANSACTION_TYPE_ETHEREUM",
            organization_id=None,  # Main org for hot wallets
        )

        return signed_tx


# Global instance
hot_wallet_service = HotWalletService()
