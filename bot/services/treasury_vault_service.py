"""Treasury Vault Service — Aave v3 and Morpho Blue (ERC-4626) on Base for SUWP staker yield."""

import logging
from decimal import Decimal
from datetime import datetime, timezone
from typing import Optional

from web3 import Web3
from eth_account import Account

from bot.config.settings import settings
from database.db import get_session

logger = logging.getLogger(__name__)

# ── Aave v3 on Base ──────────────────────────────────────────────────────────
AAVE_POOL_ADDRESS = "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5"
USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
AUSDC_ADDRESS = "0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB"
USDC_DECIMALS = 6

ERC20_ABI = [
    {
        "name": "balanceOf",
        "type": "function",
        "stateMutability": "view",
        "inputs": [{"name": "account", "type": "address"}],
        "outputs": [{"name": "", "type": "uint256"}],
    },
    {
        "name": "approve",
        "type": "function",
        "stateMutability": "nonpayable",
        "inputs": [{"name": "spender", "type": "address"}, {"name": "amount", "type": "uint256"}],
        "outputs": [{"name": "", "type": "bool"}],
    },
    {
        "name": "allowance",
        "type": "function",
        "stateMutability": "view",
        "inputs": [{"name": "owner", "type": "address"}, {"name": "spender", "type": "address"}],
        "outputs": [{"name": "", "type": "uint256"}],
    },
]

AAVE_POOL_ABI = [
    {
        "name": "supply",
        "type": "function",
        "stateMutability": "nonpayable",
        "inputs": [
            {"name": "asset", "type": "address"},
            {"name": "amount", "type": "uint256"},
            {"name": "onBehalfOf", "type": "address"},
            {"name": "referralCode", "type": "uint16"},
        ],
        "outputs": [],
    },
    {
        "name": "withdraw",
        "type": "function",
        "stateMutability": "nonpayable",
        "inputs": [
            {"name": "asset", "type": "address"},
            {"name": "amount", "type": "uint256"},
            {"name": "to", "type": "address"},
        ],
        "outputs": [{"name": "", "type": "uint256"}],
    },
    {
        "name": "getReserveData",
        "type": "function",
        "stateMutability": "view",
        "inputs": [{"name": "asset", "type": "address"}],
        "outputs": [
            {"name": "configuration", "type": "uint256"},
            {"name": "liquidityIndex", "type": "uint128"},
            {"name": "currentLiquidityRate", "type": "uint128"},
            {"name": "variableBorrowIndex", "type": "uint128"},
            {"name": "currentVariableBorrowRate", "type": "uint128"},
            {"name": "currentStableBorrowRate", "type": "uint128"},
            {"name": "lastUpdateTimestamp", "type": "uint40"},
            {"name": "id", "type": "uint16"},
            {"name": "aTokenAddress", "type": "address"},
            {"name": "stableDebtTokenAddress", "type": "address"},
            {"name": "variableDebtTokenAddress", "type": "address"},
            {"name": "interestRateStrategyAddress", "type": "address"},
            {"name": "accruedToTreasury", "type": "uint128"},
            {"name": "unbacked", "type": "uint128"},
            {"name": "isolationModeTotalDebt", "type": "uint128"},
        ],
    },
]

# ── ERC-4626 standard ABI (used by Morpho MetaMorpho vaults) ─────────────────
ERC4626_ABI = [
    {
        "name": "deposit",
        "type": "function",
        "stateMutability": "nonpayable",
        "inputs": [{"name": "assets", "type": "uint256"}, {"name": "receiver", "type": "address"}],
        "outputs": [{"name": "shares", "type": "uint256"}],
    },
    {
        "name": "withdraw",
        "type": "function",
        "stateMutability": "nonpayable",
        "inputs": [
            {"name": "assets", "type": "uint256"},
            {"name": "receiver", "type": "address"},
            {"name": "owner", "type": "address"},
        ],
        "outputs": [{"name": "shares", "type": "uint256"}],
    },
    {
        "name": "redeem",
        "type": "function",
        "stateMutability": "nonpayable",
        "inputs": [
            {"name": "shares", "type": "uint256"},
            {"name": "receiver", "type": "address"},
            {"name": "owner", "type": "address"},
        ],
        "outputs": [{"name": "assets", "type": "uint256"}],
    },
    {
        "name": "balanceOf",
        "type": "function",
        "stateMutability": "view",
        "inputs": [{"name": "account", "type": "address"}],
        "outputs": [{"name": "", "type": "uint256"}],
    },
    {
        "name": "convertToAssets",
        "type": "function",
        "stateMutability": "view",
        "inputs": [{"name": "shares", "type": "uint256"}],
        "outputs": [{"name": "assets", "type": "uint256"}],
    },
    {
        "name": "totalAssets",
        "type": "function",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"name": "", "type": "uint256"}],
    },
    {
        "name": "previewDeposit",
        "type": "function",
        "stateMutability": "view",
        "inputs": [{"name": "assets", "type": "uint256"}],
        "outputs": [{"name": "shares", "type": "uint256"}],
    },
    {
        "name": "asset",
        "type": "function",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"name": "", "type": "address"}],
    },
]


class TreasuryVaultService:
    # ── routing helpers ───────────────────────────────────────────────────────

    def _is_morpho(self) -> bool:
        return getattr(settings, "vault_type", "aave").lower() == "morpho"

    def _get_vault_address(self) -> str:
        if self._is_morpho():
            addr = getattr(settings, "morpho_vault_address", None)
            if not addr:
                raise ValueError("MORPHO_VAULT_ADDRESS not set")
            return addr
        return AAVE_POOL_ADDRESS

    def _vault_name(self) -> str:
        return "morpho_base_usdc" if self._is_morpho() else "aave_v3_base_usdc"

    # ── low-level helpers ─────────────────────────────────────────────────────

    def _get_web3(self) -> Web3:
        from bot.services.rpc_manager import rpc_manager

        return rpc_manager.get_web3("base")

    def _get_treasury_wallet(self):
        wallet_name = getattr(settings, "treasury_vault_hot_wallet_name", "treasury_vault")
        from bot.models.custodial import HotWallet

        with get_session() as session:
            wallet = session.query(HotWallet).filter(HotWallet.name == wallet_name).first()
            if not wallet:
                raise ValueError(
                    f"Treasury hot wallet '{wallet_name}' not found. "
                    "Create it via admin or set TREASURY_VAULT_HOT_WALLET_NAME env var."
                )
            return wallet

    def _get_private_key(self, wallet) -> str:
        from bot.services.hot_wallet import hot_wallet_service

        return hot_wallet_service.get_private_key(wallet)

    def _usdc_to_wei(self, amount: Decimal) -> int:
        return int(amount * Decimal(10**USDC_DECIMALS))

    def _wei_to_usdc(self, amount_wei: int) -> Decimal:
        return Decimal(amount_wei) / Decimal(10**USDC_DECIMALS)

    def _build_and_send(self, web3: Web3, wallet, contract_fn, private_key: str) -> str:
        nonce = web3.eth.get_transaction_count(Web3.to_checksum_address(wallet.address))
        gas_price = web3.eth.gas_price
        tx = contract_fn.build_transaction(
            {
                "from": Web3.to_checksum_address(wallet.address),
                "nonce": nonce,
                "gasPrice": gas_price,
                "chainId": 8453,  # Base mainnet
            }
        )
        tx["gas"] = web3.eth.estimate_gas(tx)
        if not private_key.startswith("0x"):
            private_key = "0x" + private_key
        signed = Account.sign_transaction(tx, private_key)
        # eth-account >= 0.13 uses raw_transaction (snake_case)
        raw = getattr(signed, "raw_transaction", None) or signed.rawTransaction
        tx_hash = web3.eth.send_raw_transaction(raw)
        return tx_hash.hex()

    def _ensure_usdc_approval(
        self, web3: Web3, wallet, private_key: str, amount_wei: int, spender: Optional[str] = None
    ) -> None:
        """Approve USDC to `spender` (defaults to Aave pool for backwards-compat)."""
        if spender is None:
            spender = AAVE_POOL_ADDRESS
        usdc = web3.eth.contract(address=Web3.to_checksum_address(USDC_ADDRESS), abi=ERC20_ABI)
        spender_addr = Web3.to_checksum_address(spender)
        allowance = usdc.functions.allowance(
            Web3.to_checksum_address(wallet.address), spender_addr
        ).call()
        if allowance < amount_wei:
            MAX_UINT256 = 2**256 - 1
            self._build_and_send(
                web3, wallet, usdc.functions.approve(spender_addr, MAX_UINT256), private_key
            )
            logger.info("USDC approved for spender %s (max uint256)", spender_addr)

    # ── deposit ───────────────────────────────────────────────────────────────

    def deposit_to_vault(self, usdc_amount: Decimal) -> str:
        if not getattr(settings, "aave_enabled", False):
            logger.info(
                "[mock] deposit_to_vault %.6f USDC (vault_type=%s)",
                usdc_amount,
                getattr(settings, "vault_type", "aave"),
            )
            return "0x" + "0" * 64
        try:
            if self._is_morpho():
                return self._deposit_morpho(usdc_amount)
            else:
                return self._deposit_aave(usdc_amount)
        except Exception as e:
            logger.error("deposit_to_vault failed: %s", e, exc_info=True)
            raise

    def _deposit_aave(self, usdc_amount: Decimal) -> str:
        web3 = self._get_web3()
        wallet = self._get_treasury_wallet()
        private_key = self._get_private_key(wallet)
        amount_wei = self._usdc_to_wei(usdc_amount)
        # Check balance
        usdc_contract = web3.eth.contract(
            address=Web3.to_checksum_address(USDC_ADDRESS), abi=ERC20_ABI
        )
        balance = usdc_contract.functions.balanceOf(Web3.to_checksum_address(wallet.address)).call()
        if balance < amount_wei:
            available = self._wei_to_usdc(balance)
            raise ValueError(f"Insufficient USDC: have {available:.6f}, need {usdc_amount:.6f}")
        self._ensure_usdc_approval(web3, wallet, private_key, amount_wei, spender=AAVE_POOL_ADDRESS)
        pool = web3.eth.contract(
            address=Web3.to_checksum_address(AAVE_POOL_ADDRESS), abi=AAVE_POOL_ABI
        )
        tx_hash = self._build_and_send(
            web3,
            wallet,
            pool.functions.supply(
                Web3.to_checksum_address(USDC_ADDRESS),
                amount_wei,
                Web3.to_checksum_address(wallet.address),
                0,
            ),
            private_key,
        )
        logger.info("Deposited %.6f USDC to Aave v3 Base tx=%s", usdc_amount, tx_hash)
        self._update_position_after_deposit(usdc_amount)
        return tx_hash

    def _deposit_morpho(self, usdc_amount: Decimal) -> str:
        web3 = self._get_web3()
        wallet = self._get_treasury_wallet()
        private_key = self._get_private_key(wallet)
        amount_wei = self._usdc_to_wei(usdc_amount)
        vault_addr = Web3.to_checksum_address(self._get_vault_address())

        # Approve USDC to vault (not the Aave pool — ERC-4626 pulls via transferFrom)
        self._ensure_usdc_approval(web3, wallet, private_key, amount_wei, spender=vault_addr)

        vault = web3.eth.contract(address=vault_addr, abi=ERC4626_ABI)
        tx_hash = self._build_and_send(
            web3,
            wallet,
            vault.functions.deposit(amount_wei, Web3.to_checksum_address(wallet.address)),
            private_key,
        )
        logger.info(
            "Deposited %.6f USDC to Morpho vault %s tx=%s", usdc_amount, vault_addr, tx_hash
        )
        self._update_position_after_deposit(usdc_amount)
        return tx_hash

    # ── harvest ───────────────────────────────────────────────────────────────

    def harvest_yield(self) -> Decimal:
        if not getattr(settings, "aave_enabled", False):
            return Decimal("0")
        try:
            if self._is_morpho():
                return self._harvest_morpho()
            else:
                return self._harvest_aave()
        except Exception as e:
            logger.error("harvest_yield failed: %s", e, exc_info=True)
            return Decimal("0")

    def _harvest_aave(self) -> Decimal:
        """Read aUSDC balance vs principal — returns accumulated yield. No on-chain write."""
        web3 = self._get_web3()
        wallet = self._get_treasury_wallet()
        ausdc = web3.eth.contract(address=Web3.to_checksum_address(AUSDC_ADDRESS), abi=ERC20_ABI)
        balance_wei = ausdc.functions.balanceOf(Web3.to_checksum_address(wallet.address)).call()
        current_balance = self._wei_to_usdc(balance_wei)
        with get_session() as session:
            from bot.models.token_staking import TreasuryPosition

            pos = (
                session.query(TreasuryPosition)
                .filter(TreasuryPosition.vault_name == "aave_v3_base_usdc")
                .first()
            )
            principal = Decimal(str(pos.principal_usdc)) if pos else Decimal("0")
            if pos:
                pos.current_a_token_balance = current_balance
                pos.last_harvest_at = datetime.now(timezone.utc)
        yield_amount = max(current_balance - principal, Decimal("0"))
        logger.info(
            "harvest_aave: principal=%.6f aUSDC=%.6f yield=%.6f",
            principal,
            current_balance,
            yield_amount,
        )
        return yield_amount

    def _harvest_morpho(self) -> Decimal:
        web3 = self._get_web3()
        wallet = self._get_treasury_wallet()
        vault_addr = Web3.to_checksum_address(self._get_vault_address())
        vault = web3.eth.contract(address=vault_addr, abi=ERC4626_ABI)

        # ERC-4626: convertToAssets(balanceOf(treasury)) = current value in USDC
        shares = vault.functions.balanceOf(Web3.to_checksum_address(wallet.address)).call()
        current_assets_wei = vault.functions.convertToAssets(shares).call() if shares > 0 else 0
        current_balance = self._wei_to_usdc(current_assets_wei)

        with get_session() as session:
            from bot.models.token_staking import TreasuryPosition

            pos = (
                session.query(TreasuryPosition)
                .filter(TreasuryPosition.vault_name == "morpho_base_usdc")
                .first()
            )
            principal = Decimal(str(pos.principal_usdc)) if pos else Decimal("0")
            if pos:
                pos.current_a_token_balance = current_balance
                pos.last_harvest_at = datetime.now(timezone.utc)

        yield_amount = max(current_balance - principal, Decimal("0"))
        logger.info(
            "harvest_morpho: principal=%.6f current=%.6f yield=%.6f",
            principal,
            current_balance,
            yield_amount,
        )
        return yield_amount

    # ── withdraw ──────────────────────────────────────────────────────────────

    def withdraw_yield(self, yield_amount: Decimal, to_address: str) -> str:
        if not getattr(settings, "aave_enabled", False):
            logger.info("[mock] withdraw_yield %.6f USDC to %s", yield_amount, to_address)
            return "0x" + "0" * 64
        try:
            if self._is_morpho():
                return self._withdraw_morpho(yield_amount, to_address)
            else:
                return self._withdraw_aave(yield_amount, to_address)
        except Exception as e:
            logger.error("withdraw_yield failed: %s", e, exc_info=True)
            raise

    def _withdraw_aave(self, yield_amount: Decimal, to_address: str) -> str:
        web3 = self._get_web3()
        wallet = self._get_treasury_wallet()
        private_key = self._get_private_key(wallet)
        amount_wei = self._usdc_to_wei(yield_amount)
        pool = web3.eth.contract(
            address=Web3.to_checksum_address(AAVE_POOL_ADDRESS), abi=AAVE_POOL_ABI
        )
        tx_hash = self._build_and_send(
            web3,
            wallet,
            pool.functions.withdraw(
                Web3.to_checksum_address(USDC_ADDRESS),
                amount_wei,
                Web3.to_checksum_address(to_address),
            ),
            private_key,
        )
        logger.info("Withdrew %.6f USDC yield from Aave tx=%s", yield_amount, tx_hash)
        with get_session() as session:
            from bot.models.token_staking import TreasuryPosition

            pos = (
                session.query(TreasuryPosition)
                .filter(TreasuryPosition.vault_name == "aave_v3_base_usdc")
                .first()
            )
            if pos:
                pos.total_yield_harvested_usdc = (
                    Decimal(str(pos.total_yield_harvested_usdc)) + yield_amount
                )
        return tx_hash

    def _withdraw_morpho(self, yield_amount: Decimal, to_address: str) -> str:
        web3 = self._get_web3()
        wallet = self._get_treasury_wallet()
        private_key = self._get_private_key(wallet)
        amount_wei = self._usdc_to_wei(yield_amount)
        vault_addr = Web3.to_checksum_address(self._get_vault_address())
        vault = web3.eth.contract(address=vault_addr, abi=ERC4626_ABI)

        tx_hash = self._build_and_send(
            web3,
            wallet,
            vault.functions.withdraw(
                amount_wei,
                Web3.to_checksum_address(to_address),
                Web3.to_checksum_address(wallet.address),
            ),
            private_key,
        )
        logger.info("Withdrew %.6f USDC yield from Morpho tx=%s", yield_amount, tx_hash)

        with get_session() as session:
            from bot.models.token_staking import TreasuryPosition

            pos = (
                session.query(TreasuryPosition)
                .filter(TreasuryPosition.vault_name == "morpho_base_usdc")
                .first()
            )
            if pos:
                pos.total_yield_harvested_usdc = (
                    Decimal(str(pos.total_yield_harvested_usdc)) + yield_amount
                )
        return tx_hash

    # ── stats ─────────────────────────────────────────────────────────────────

    def get_vault_stats(self) -> dict:
        try:
            vault_name = self._vault_name()
            live_balance = 0.0
            apy_pct = 0.0

            if getattr(settings, "aave_enabled", False):
                try:
                    web3 = self._get_web3()
                    wallet = self._get_treasury_wallet()

                    if self._is_morpho():
                        vault_addr = Web3.to_checksum_address(self._get_vault_address())
                        vault = web3.eth.contract(address=vault_addr, abi=ERC4626_ABI)
                        shares = vault.functions.balanceOf(
                            Web3.to_checksum_address(wallet.address)
                        ).call()
                        assets_wei = (
                            vault.functions.convertToAssets(shares).call() if shares > 0 else 0
                        )
                        live_balance = float(self._wei_to_usdc(assets_wei))
                        # APY approximation via weekly compounding: not available from contract
                        # Use DB principal for the ratio; guard zero-division
                        with get_session() as session:
                            from bot.models.token_staking import TreasuryPosition

                            _pos = (
                                session.query(TreasuryPosition)
                                .filter(TreasuryPosition.vault_name == vault_name)
                                .first()
                            )
                            _principal = float(_pos.principal_usdc) if _pos else 0.0
                        if _principal > 0 and live_balance > 0:
                            apy_pct = round((live_balance / _principal - 1) * 52 * 100, 4)
                    else:
                        ausdc = web3.eth.contract(
                            address=Web3.to_checksum_address(AUSDC_ADDRESS), abi=ERC20_ABI
                        )
                        balance_wei = ausdc.functions.balanceOf(
                            Web3.to_checksum_address(wallet.address)
                        ).call()
                        live_balance = float(self._wei_to_usdc(balance_wei))
                        pool = web3.eth.contract(
                            address=Web3.to_checksum_address(AAVE_POOL_ADDRESS), abi=AAVE_POOL_ABI
                        )
                        reserve = pool.functions.getReserveData(
                            Web3.to_checksum_address(USDC_ADDRESS)
                        ).call()
                        apy_pct = round((reserve[2] / 1e27) * 100, 4)
                except Exception as e:
                    logger.warning("Live vault stats unavailable: %s", e)

            with get_session() as session:
                from bot.models.token_staking import TreasuryPosition

                pos = (
                    session.query(TreasuryPosition)
                    .filter(TreasuryPosition.vault_name == vault_name)
                    .first()
                )

            principal = float(pos.principal_usdc) if pos else 0.0
            balance = live_balance or (float(pos.current_a_token_balance) if pos else 0.0)
            return {
                "vault_name": pos.vault_name if pos else vault_name,
                "chain": pos.chain if pos else "base",
                "principal_usdc": principal,
                "current_balance_usdc": balance,
                "yield_earned_usdc": max(balance - principal, 0.0),
                "apy_estimate_pct": apy_pct,
                "total_yield_harvested_usdc": float(pos.total_yield_harvested_usdc) if pos else 0.0,
                "last_deposit_at": (
                    pos.last_deposit_at.isoformat() if pos and pos.last_deposit_at else None
                ),
                "last_harvest_at": (
                    pos.last_harvest_at.isoformat() if pos and pos.last_harvest_at else None
                ),
            }
        except Exception as e:
            logger.error("get_vault_stats failed: %s", e, exc_info=True)
            return {"vault_name": self._vault_name(), "chain": "base", "error": str(e)}

    # ── position bookkeeping ──────────────────────────────────────────────────

    def _update_position_after_deposit(self, amount: Decimal) -> None:
        from bot.models.token_staking import TreasuryPosition

        vault_name = self._vault_name()
        now = datetime.now(timezone.utc)
        with get_session() as session:
            pos = (
                session.query(TreasuryPosition)
                .filter(TreasuryPosition.vault_name == vault_name)
                .first()
            )
            if pos:
                pos.principal_usdc = Decimal(str(pos.principal_usdc)) + amount
                pos.last_deposit_at = now
                pos.updated_at = now
            else:
                session.add(
                    TreasuryPosition(
                        vault_name=vault_name,
                        chain="base",
                        principal_usdc=amount,
                        current_a_token_balance=amount,
                        total_yield_harvested_usdc=Decimal("0"),
                        last_deposit_at=now,
                    )
                )


treasury_vault_service = TreasuryVaultService()
