"""Treasury Vault Service — Aave v3 on Base for SUWP staker yield."""
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
USDC_ADDRESS      = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
AUSDC_ADDRESS     = "0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB"
USDC_DECIMALS     = 6

ERC20_ABI = [
    {"name": "balanceOf", "type": "function", "stateMutability": "view",
     "inputs": [{"name": "account", "type": "address"}],
     "outputs": [{"name": "", "type": "uint256"}]},
    {"name": "approve", "type": "function", "stateMutability": "nonpayable",
     "inputs": [{"name": "spender", "type": "address"}, {"name": "amount", "type": "uint256"}],
     "outputs": [{"name": "", "type": "bool"}]},
    {"name": "allowance", "type": "function", "stateMutability": "view",
     "inputs": [{"name": "owner", "type": "address"}, {"name": "spender", "type": "address"}],
     "outputs": [{"name": "", "type": "uint256"}]},
]

AAVE_POOL_ABI = [
    {"name": "supply", "type": "function", "stateMutability": "nonpayable",
     "inputs": [{"name": "asset", "type": "address"}, {"name": "amount", "type": "uint256"},
                {"name": "onBehalfOf", "type": "address"}, {"name": "referralCode", "type": "uint16"}],
     "outputs": []},
    {"name": "withdraw", "type": "function", "stateMutability": "nonpayable",
     "inputs": [{"name": "asset", "type": "address"}, {"name": "amount", "type": "uint256"},
                {"name": "to", "type": "address"}],
     "outputs": [{"name": "", "type": "uint256"}]},
    {"name": "getReserveData", "type": "function", "stateMutability": "view",
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
     ]},
]


class TreasuryVaultService:
    def _get_web3(self) -> Web3:
        from bot.services.rpc_manager import rpc_manager
        return rpc_manager.get_web3("base")

    def _get_treasury_wallet(self):
        wallet_name = getattr(settings, "treasury_vault_hot_wallet_name", "treasury_vault")
        from bot.models.custodial import HotWallet
        with get_session() as session:
            wallet = session.query(HotWallet).filter(
                HotWallet.name == wallet_name
            ).first()
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
        return int(amount * Decimal(10 ** USDC_DECIMALS))

    def _wei_to_usdc(self, amount_wei: int) -> Decimal:
        return Decimal(amount_wei) / Decimal(10 ** USDC_DECIMALS)

    def _build_and_send(self, web3: Web3, wallet, contract_fn, private_key: str) -> str:
        nonce = web3.eth.get_transaction_count(Web3.to_checksum_address(wallet.address))
        gas_price = web3.eth.gas_price
        tx = contract_fn.build_transaction({
            "from": Web3.to_checksum_address(wallet.address),
            "nonce": nonce,
            "gasPrice": gas_price,
            "chainId": 8453,  # Base mainnet
        })
        tx["gas"] = web3.eth.estimate_gas(tx)
        if not private_key.startswith("0x"):
            private_key = "0x" + private_key
        signed = Account.sign_transaction(tx, private_key)
        # eth-account >= 0.13 uses raw_transaction (snake_case)
        raw = getattr(signed, "raw_transaction", None) or signed.rawTransaction
        tx_hash = web3.eth.send_raw_transaction(raw)
        return tx_hash.hex()

    def _ensure_usdc_approval(self, web3: Web3, wallet, private_key: str, amount_wei: int) -> None:
        usdc = web3.eth.contract(address=Web3.to_checksum_address(USDC_ADDRESS), abi=ERC20_ABI)
        pool_addr = Web3.to_checksum_address(AAVE_POOL_ADDRESS)
        allowance = usdc.functions.allowance(
            Web3.to_checksum_address(wallet.address), pool_addr
        ).call()
        if allowance < amount_wei:
            MAX_UINT256 = 2**256 - 1
            self._build_and_send(web3, wallet, usdc.functions.approve(pool_addr, MAX_UINT256), private_key)
            logger.info("USDC approved for Aave Pool (max uint256)")

    def deposit_to_vault(self, usdc_amount: Decimal) -> str:
        if not getattr(settings, "aave_enabled", False):
            logger.info("[mock] deposit_to_vault %.6f USDC", usdc_amount)
            return "0x" + "0" * 64
        try:
            web3 = self._get_web3()
            wallet = self._get_treasury_wallet()
            private_key = self._get_private_key(wallet)
            amount_wei = self._usdc_to_wei(usdc_amount)
            # Check balance
            usdc_contract = web3.eth.contract(address=Web3.to_checksum_address(USDC_ADDRESS), abi=ERC20_ABI)
            balance = usdc_contract.functions.balanceOf(Web3.to_checksum_address(wallet.address)).call()
            if balance < amount_wei:
                available = self._wei_to_usdc(balance)
                raise ValueError(f"Insufficient USDC: have {available:.6f}, need {usdc_amount:.6f}")
            self._ensure_usdc_approval(web3, wallet, private_key, amount_wei)
            pool = web3.eth.contract(address=Web3.to_checksum_address(AAVE_POOL_ADDRESS), abi=AAVE_POOL_ABI)
            tx_hash = self._build_and_send(
                web3, wallet,
                pool.functions.supply(
                    Web3.to_checksum_address(USDC_ADDRESS), amount_wei,
                    Web3.to_checksum_address(wallet.address), 0,
                ),
                private_key,
            )
            logger.info("Deposited %.6f USDC to Aave v3 Base tx=%s", usdc_amount, tx_hash)
            self._update_position_after_deposit(usdc_amount)
            return tx_hash
        except Exception as e:
            logger.error("deposit_to_vault failed: %s", e, exc_info=True)
            raise

    def harvest_yield(self) -> Decimal:
        """Read aUSDC balance vs principal — returns accumulated yield. No on-chain write."""
        if not getattr(settings, "aave_enabled", False):
            return Decimal("0")
        try:
            web3 = self._get_web3()
            wallet = self._get_treasury_wallet()
            ausdc = web3.eth.contract(address=Web3.to_checksum_address(AUSDC_ADDRESS), abi=ERC20_ABI)
            balance_wei = ausdc.functions.balanceOf(Web3.to_checksum_address(wallet.address)).call()
            current_balance = self._wei_to_usdc(balance_wei)
            with get_session() as session:
                from bot.models.token_staking import TreasuryPosition
                pos = session.query(TreasuryPosition).filter(
                    TreasuryPosition.vault_name == "aave_v3_base_usdc"
                ).first()
                principal = Decimal(str(pos.principal_usdc)) if pos else Decimal("0")
                if pos:
                    pos.current_a_token_balance = current_balance
                    pos.last_harvest_at = datetime.now(timezone.utc)
            yield_amount = max(current_balance - principal, Decimal("0"))
            logger.info("harvest_yield: principal=%.6f aUSDC=%.6f yield=%.6f", principal, current_balance, yield_amount)
            return yield_amount
        except Exception as e:
            logger.error("harvest_yield failed: %s", e, exc_info=True)
            return Decimal("0")  # fail safe

    def withdraw_yield(self, yield_amount: Decimal, to_address: str) -> str:
        if not getattr(settings, "aave_enabled", False):
            logger.info("[mock] withdraw_yield %.6f USDC to %s", yield_amount, to_address)
            return "0x" + "0" * 64
        try:
            web3 = self._get_web3()
            wallet = self._get_treasury_wallet()
            private_key = self._get_private_key(wallet)
            amount_wei = self._usdc_to_wei(yield_amount)
            pool = web3.eth.contract(address=Web3.to_checksum_address(AAVE_POOL_ADDRESS), abi=AAVE_POOL_ABI)
            tx_hash = self._build_and_send(
                web3, wallet,
                pool.functions.withdraw(
                    Web3.to_checksum_address(USDC_ADDRESS), amount_wei, Web3.to_checksum_address(to_address),
                ),
                private_key,
            )
            logger.info("Withdrew %.6f USDC yield from Aave tx=%s", yield_amount, tx_hash)
            with get_session() as session:
                from bot.models.token_staking import TreasuryPosition
                pos = session.query(TreasuryPosition).filter(
                    TreasuryPosition.vault_name == "aave_v3_base_usdc"
                ).first()
                if pos:
                    pos.total_yield_harvested_usdc = (
                        Decimal(str(pos.total_yield_harvested_usdc)) + yield_amount
                    )
            return tx_hash
        except Exception as e:
            logger.error("withdraw_yield failed: %s", e, exc_info=True)
            raise

    def get_vault_stats(self) -> dict:
        try:
            live_balance = 0.0
            apy_pct = 0.0
            if getattr(settings, "aave_enabled", False):
                try:
                    web3 = self._get_web3()
                    wallet = self._get_treasury_wallet()
                    ausdc = web3.eth.contract(address=Web3.to_checksum_address(AUSDC_ADDRESS), abi=ERC20_ABI)
                    balance_wei = ausdc.functions.balanceOf(Web3.to_checksum_address(wallet.address)).call()
                    live_balance = float(self._wei_to_usdc(balance_wei))
                    pool = web3.eth.contract(address=Web3.to_checksum_address(AAVE_POOL_ADDRESS), abi=AAVE_POOL_ABI)
                    reserve = pool.functions.getReserveData(Web3.to_checksum_address(USDC_ADDRESS)).call()
                    apy_pct = round((reserve[2] / 1e27) * 100, 4)
                except Exception as e:
                    logger.warning("Live vault stats unavailable: %s", e)

            with get_session() as session:
                from bot.models.token_staking import TreasuryPosition
                pos = session.query(TreasuryPosition).filter(
                    TreasuryPosition.vault_name == "aave_v3_base_usdc"
                ).first()

            principal = float(pos.principal_usdc) if pos else 0.0
            balance = live_balance or (float(pos.current_a_token_balance) if pos else 0.0)
            return {
                "vault_name": pos.vault_name if pos else "aave_v3_base_usdc",
                "chain": pos.chain if pos else "base",
                "principal_usdc": principal,
                "current_balance_usdc": balance,
                "yield_earned_usdc": max(balance - principal, 0.0),
                "apy_estimate_pct": apy_pct,
                "total_yield_harvested_usdc": float(pos.total_yield_harvested_usdc) if pos else 0.0,
                "last_deposit_at": pos.last_deposit_at.isoformat() if pos and pos.last_deposit_at else None,
                "last_harvest_at": pos.last_harvest_at.isoformat() if pos and pos.last_harvest_at else None,
            }
        except Exception as e:
            logger.error("get_vault_stats failed: %s", e, exc_info=True)
            return {"vault_name": "aave_v3_base_usdc", "chain": "base", "error": str(e)}

    def _update_position_after_deposit(self, amount: Decimal) -> None:
        from bot.models.token_staking import TreasuryPosition
        now = datetime.now(timezone.utc)
        with get_session() as session:
            pos = session.query(TreasuryPosition).filter(
                TreasuryPosition.vault_name == "aave_v3_base_usdc"
            ).first()
            if pos:
                pos.principal_usdc = Decimal(str(pos.principal_usdc)) + amount
                pos.last_deposit_at = now
                pos.updated_at = now
            else:
                session.add(TreasuryPosition(
                    vault_name="aave_v3_base_usdc", chain="base",
                    principal_usdc=amount, current_a_token_balance=amount,
                    total_yield_harvested_usdc=Decimal("0"), last_deposit_at=now,
                ))


treasury_vault_service = TreasuryVaultService()
