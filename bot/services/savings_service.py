"""Savings Service — non-custodial USDC yield via Aave V3 on Base.

Users supply idle USDC into the Aave V3 lending pool on Base, earn the live
supply APY, and withdraw at any time. Funds stay in the user's own wallet's
control: the aToken (aBasUSDC) is minted to the user's address, never to a
custodial account.

Signing/sending reuses the exact local EVM pattern used by the swap path and
the treasury vault service (nonce + gasPrice + estimate_gas + sign + send +
wait_for_receipt). All web3 calls are blocking, so callers run this service via
asyncio.to_thread from async handlers.
"""

import logging
from decimal import Decimal
from typing import Optional

from web3 import Web3
from eth_account import Account

logger = logging.getLogger(__name__)

# ── Aave V3 on Base ──────────────────────────────────────────────────────────
AAVE_POOL_ADDRESS = "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5"
USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
ABASUSDC_ADDRESS = "0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB"  # aToken (rebasing)
USDC_DECIMALS = 6
BASE_CHAIN_ID = 8453

# uint256 max — Aave's sentinel for "withdraw entire balance".
MAX_UINT256 = 2**256 - 1

# Aave rates are expressed in ray (1e27).
RAY = Decimal(10**27)
SECONDS_PER_YEAR = Decimal(31_536_000)

# ── Minimal ABIs ─────────────────────────────────────────────────────────────
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
        "inputs": [
            {"name": "spender", "type": "address"},
            {"name": "amount", "type": "uint256"},
        ],
        "outputs": [{"name": "", "type": "bool"}],
    },
    {
        "name": "allowance",
        "type": "function",
        "stateMutability": "view",
        "inputs": [
            {"name": "owner", "type": "address"},
            {"name": "spender", "type": "address"},
        ],
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


class SavingsError(Exception):
    """User-safe savings error — message is safe to surface in the UI."""


class SavingsService:
    """Non-custodial USDC savings on Aave V3 (Base)."""

    # ── low-level helpers ─────────────────────────────────────────────────────

    def _get_web3(self) -> Web3:
        from bot.services.rpc_manager import rpc_manager

        return rpc_manager.get_web3("base")

    def _usdc_to_wei(self, amount: Decimal) -> int:
        return int(Decimal(str(amount)) * Decimal(10**USDC_DECIMALS))

    def _wei_to_usdc(self, amount_wei: int) -> Decimal:
        return Decimal(amount_wei) / Decimal(10**USDC_DECIMALS)

    def _erc20(self, web3: Web3, address: str):
        return web3.eth.contract(address=Web3.to_checksum_address(address), abi=ERC20_ABI)

    def _pool(self, web3: Web3):
        return web3.eth.contract(
            address=Web3.to_checksum_address(AAVE_POOL_ADDRESS), abi=AAVE_POOL_ABI
        )

    def _get_private_key(self, wallet) -> str:
        """Decrypt the signing key (handles Turnkey backup fallback)."""
        from bot.services.wallet import WalletService

        ws = WalletService()
        if getattr(wallet, "is_turnkey_wallet", False):
            return ws.get_backup_private_key(wallet)
        return ws.get_private_key(wallet)

    def _build_and_send(self, web3: Web3, wallet, contract_fn, private_key: str) -> str:
        """Build, sign, send a contract call and wait for the receipt.

        Mirrors the swap/treasury EVM pattern: nonce + gasPrice + estimate_gas +
        local sign + send_raw_transaction + wait_for_transaction_receipt. Raises
        SavingsError (user-safe) if the transaction reverts on-chain.
        """
        from_addr = Web3.to_checksum_address(wallet.address)
        nonce = web3.eth.get_transaction_count(from_addr)
        gas_price = web3.eth.gas_price
        tx = contract_fn.build_transaction(
            {
                "from": from_addr,
                "nonce": nonce,
                "gasPrice": gas_price,
                "chainId": BASE_CHAIN_ID,
            }
        )
        tx["gas"] = int(web3.eth.estimate_gas(tx) * 1.2)

        if not private_key.startswith("0x"):
            private_key = "0x" + private_key
        signed = Account.sign_transaction(tx, private_key)
        raw = getattr(signed, "raw_transaction", None) or signed.rawTransaction
        tx_hash = web3.eth.send_raw_transaction(raw)
        receipt = web3.eth.wait_for_transaction_receipt(tx_hash, timeout=180)
        if receipt.get("status") != 1:
            raise SavingsError("Transaction failed on-chain. No funds were moved.")
        return tx_hash.hex()

    # ── reads ─────────────────────────────────────────────────────────────────

    def get_apy(self) -> float:
        """Return the current USDC supply APY (%) on Aave V3 Base.

        currentLiquidityRate is the supply APR in ray (1e27). We compound it to an
        APY-approx; small differences from Aave's exact second-by-second compounding
        are immaterial for display.
        """
        try:
            web3 = self._get_web3()
            reserve = (
                self._pool(web3)
                .functions.getReserveData(Web3.to_checksum_address(USDC_ADDRESS))
                .call()
            )
            liquidity_rate = Decimal(reserve[2])  # currentLiquidityRate (ray)
            apr = liquidity_rate / RAY  # fractional APR, e.g. 0.05
            # Per-second compounding → APY.
            per_second = apr / SECONDS_PER_YEAR
            apy = (Decimal(1) + per_second) ** SECONDS_PER_YEAR - Decimal(1)
            return float(apy * Decimal(100))
        except Exception as e:
            logger.warning(f"Failed to read Aave USDC APY: {e}")
            raise SavingsError("Could not fetch the current savings rate. Try again shortly.")

    def get_position(self, wallet_address: str) -> Decimal:
        """Return the user's savings balance (aToken = principal + accrued interest).

        The aToken rebases, so its balance IS the redeemable USDC amount.
        """
        try:
            web3 = self._get_web3()
            balance_wei = (
                self._erc20(web3, ABASUSDC_ADDRESS)
                .functions.balanceOf(Web3.to_checksum_address(wallet_address))
                .call()
            )
            return self._wei_to_usdc(balance_wei)
        except Exception as e:
            logger.warning(f"Failed to read savings position for {wallet_address[:8]}: {e}")
            raise SavingsError("Could not fetch your savings balance. Try again shortly.")

    def get_usdc_balance(self, wallet_address: str) -> Decimal:
        """Return the wallet's idle (un-supplied) USDC balance on Base."""
        try:
            web3 = self._get_web3()
            balance_wei = (
                self._erc20(web3, USDC_ADDRESS)
                .functions.balanceOf(Web3.to_checksum_address(wallet_address))
                .call()
            )
            return self._wei_to_usdc(balance_wei)
        except Exception as e:
            logger.warning(f"Failed to read USDC balance for {wallet_address[:8]}: {e}")
            raise SavingsError("Could not fetch your USDC balance. Try again shortly.")

    # ── writes ────────────────────────────────────────────────────────────────

    def deposit(self, wallet, amount: Decimal) -> list[str]:
        """Supply `amount` USDC into Aave V3 on behalf of the user's wallet.

        Approves the pool first if the existing allowance is insufficient, then
        calls Pool.supply(USDC, amount, wallet, 0). Returns the list of tx hashes
        (approve tx is included only when an approval was actually sent).
        """
        amount = Decimal(str(amount))
        if amount <= 0:
            raise SavingsError("Amount must be greater than zero.")

        amount_wei = self._usdc_to_wei(amount)
        web3 = self._get_web3()
        owner = Web3.to_checksum_address(wallet.address)
        pool_addr = Web3.to_checksum_address(AAVE_POOL_ADDRESS)
        usdc = self._erc20(web3, USDC_ADDRESS)

        try:
            balance_wei = usdc.functions.balanceOf(owner).call()
        except Exception as e:
            logger.warning(f"deposit: balance read failed: {e}")
            raise SavingsError("Could not verify your USDC balance. Try again shortly.")

        if balance_wei < amount_wei:
            have = self._wei_to_usdc(balance_wei)
            raise SavingsError(
                f"Insufficient USDC. You have {have:.2f} USDC but tried to deposit {amount:.2f}."
            )

        try:
            private_key = self._get_private_key(wallet)
        except Exception as e:
            logger.warning(f"deposit: key access failed: {e}")
            raise SavingsError("Could not access this wallet for signing.")

        tx_hashes: list[str] = []

        try:
            allowance = usdc.functions.allowance(owner, pool_addr).call()
            if allowance < amount_wei:
                approve_fn = usdc.functions.approve(pool_addr, amount_wei)
                approve_hash = self._build_and_send(web3, wallet, approve_fn, private_key)
                tx_hashes.append(approve_hash)
                logger.info(f"savings deposit: approved USDC tx={approve_hash}")

            supply_fn = self._pool(web3).functions.supply(
                Web3.to_checksum_address(USDC_ADDRESS), amount_wei, owner, 0
            )
            supply_hash = self._build_and_send(web3, wallet, supply_fn, private_key)
            tx_hashes.append(supply_hash)
            logger.info(f"savings deposit: supplied {amount} USDC tx={supply_hash}")
            return tx_hashes
        except SavingsError:
            raise
        except Exception as e:
            logger.error(f"savings deposit failed: {e}", exc_info=True)
            raise SavingsError("Deposit failed. Your funds were not moved. Try again shortly.")

    def withdraw(self, wallet, amount: Optional[Decimal]) -> str:
        """Withdraw from Aave V3. Pass amount=None (or "all") to withdraw everything.

        Aave burns the aToken and returns USDC to the user's wallet. Returns the
        withdraw tx hash.
        """
        web3 = self._get_web3()
        owner = Web3.to_checksum_address(wallet.address)

        if amount is None:
            amount_wei = MAX_UINT256  # Aave sentinel: withdraw full balance.
        else:
            amount = Decimal(str(amount))
            if amount <= 0:
                raise SavingsError("Amount must be greater than zero.")
            amount_wei = self._usdc_to_wei(amount)

            try:
                position_wei = self._erc20(web3, ABASUSDC_ADDRESS).functions.balanceOf(owner).call()
            except Exception as e:
                logger.warning(f"withdraw: position read failed: {e}")
                raise SavingsError("Could not verify your savings balance. Try again shortly.")

            if position_wei < amount_wei:
                have = self._wei_to_usdc(position_wei)
                raise SavingsError(
                    f"Insufficient savings. You have {have:.2f} USDC saved "
                    f"but tried to withdraw {amount:.2f}."
                )

        try:
            private_key = self._get_private_key(wallet)
        except Exception as e:
            logger.warning(f"withdraw: key access failed: {e}")
            raise SavingsError("Could not access this wallet for signing.")

        try:
            withdraw_fn = self._pool(web3).functions.withdraw(
                Web3.to_checksum_address(USDC_ADDRESS), amount_wei, owner
            )
            tx_hash = self._build_and_send(web3, wallet, withdraw_fn, private_key)
            logger.info(f"savings withdraw: tx={tx_hash} amount_wei={amount_wei}")
            return tx_hash
        except SavingsError:
            raise
        except Exception as e:
            logger.error(f"savings withdraw failed: {e}", exc_info=True)
            raise SavingsError("Withdrawal failed. Your funds were not moved. Try again shortly.")


savings_service = SavingsService()
