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
import time
from decimal import Decimal
from typing import Callable, Optional, TypeVar

from web3 import Web3

T = TypeVar("T")

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


class _SentTx(Exception):
    """A raw tx was broadcast but a follow-up step failed — never retry elsewhere."""


class SavingsService:
    """Non-custodial USDC savings on Aave V3 (Base)."""

    # ── low-level helpers ─────────────────────────────────────────────────────

    def _get_web3(self) -> Web3:
        from bot.services.rpc_manager import rpc_manager

        return rpc_manager.get_web3("base")

    def _failover(self, op: Callable[[Web3], T], attempts: int = 4) -> T:
        """Run `op(web3)` against Base RPCs, failing over across endpoints.

        Some public Base endpoints reject eth_call or rate-limit (429), and a
        single rpc_manager pick can land on one. Try the healthiest endpoints in
        order and report success/failure back so broken endpoints get
        deprioritized globally. A `_SentTx` failure (tx already broadcast) is
        NEVER retried on another endpoint — that could double-send.
        """
        from bot.services.rpc_manager import rpc_manager

        urls = rpc_manager.get_all_urls("base")[:attempts]
        if not urls:
            return op(self._get_web3())

        last_exc: Optional[Exception] = None
        for url in urls:
            web3 = Web3(Web3.HTTPProvider(url, request_kwargs={"timeout": 15}))
            started = time.monotonic()
            try:
                result = op(web3)
                rpc_manager.report_success("base", url, (time.monotonic() - started) * 1000)
                return result
            except _SentTx:
                rpc_manager.report_failure("base", url, "post-send failure")
                raise
            except SavingsError:
                raise  # validation/user error, not an RPC problem
            except Exception as e:
                rpc_manager.report_failure("base", url, str(e))
                logger.warning(f"savings RPC failed on {url[:48]}: {e}")
                last_exc = e
        raise last_exc if last_exc is not None else SavingsError("No Base RPC available.")

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

    def _sign_transaction(self, wallet, tx: dict) -> bytes:
        """Sign via WalletService.sign_evm_transaction — routes Turnkey wallets
        through the Turnkey API (with backup-key fallback) and local wallets
        through local signing. We run inside asyncio.to_thread, so there is no
        event loop in this thread and asyncio.run is safe.
        """
        import asyncio as _asyncio

        from bot.services.wallet import WalletService

        signed_hex = _asyncio.run(WalletService().sign_evm_transaction(wallet, tx))
        if signed_hex.startswith("0x"):
            signed_hex = signed_hex[2:]
        return bytes.fromhex(signed_hex)

    def _build_and_send(self, web3: Web3, wallet, contract_fn) -> str:
        """Build, sign, send a contract call and wait for the receipt.

        Mirrors the swap EVM pattern: nonce + gasPrice + estimate_gas + sign
        (via WalletService → Turnkey API or local key) + send_raw_transaction +
        wait_for_transaction_receipt. Raises SavingsError (user-safe) if the
        transaction reverts on-chain.
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

        raw = self._sign_transaction(wallet, tx)
        tx_hash = web3.eth.send_raw_transaction(raw)
        # Point of no return: the tx is broadcast. Any failure after this must
        # surface as _SentTx so the failover loop never re-sends elsewhere.
        try:
            receipt = web3.eth.wait_for_transaction_receipt(tx_hash, timeout=180)
        except Exception as e:
            raise _SentTx(f"receipt wait failed for {tx_hash.hex()}: {e}") from e
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
            reserve = self._failover(
                lambda web3: self._pool(web3)
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
            balance_wei = self._failover(
                lambda web3: self._erc20(web3, ABASUSDC_ADDRESS)
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
            balance_wei = self._failover(
                lambda web3: self._erc20(web3, USDC_ADDRESS)
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
        owner = Web3.to_checksum_address(wallet.address)
        pool_addr = Web3.to_checksum_address(AAVE_POOL_ADDRESS)

        def _op(web3: Web3) -> list[str]:
            usdc = self._erc20(web3, USDC_ADDRESS)
            balance_wei = usdc.functions.balanceOf(owner).call()
            if balance_wei < amount_wei:
                have = self._wei_to_usdc(balance_wei)
                raise SavingsError(
                    f"Insufficient USDC. You have {have:.2f} USDC "
                    f"but tried to deposit {amount:.2f}."
                )

            tx_hashes: list[str] = []
            allowance = usdc.functions.allowance(owner, pool_addr).call()
            if allowance < amount_wei:
                approve_fn = usdc.functions.approve(pool_addr, amount_wei)
                approve_hash = self._build_and_send(web3, wallet, approve_fn)
                tx_hashes.append(approve_hash)
                logger.info(f"savings deposit: approved USDC tx={approve_hash}")

            supply_fn = self._pool(web3).functions.supply(
                Web3.to_checksum_address(USDC_ADDRESS), amount_wei, owner, 0
            )
            supply_hash = self._build_and_send(web3, wallet, supply_fn)
            tx_hashes.append(supply_hash)
            logger.info(f"savings deposit: supplied {amount} USDC tx={supply_hash}")
            return tx_hashes

        try:
            return self._failover(_op)
        except SavingsError:
            raise
        except _SentTx as e:
            # Tx was broadcast; treat optimistically but tell the user to check.
            logger.error(f"savings deposit post-send failure: {e}")
            raise SavingsError(
                "Your deposit was submitted but confirmation timed out. "
                "Check your wallet on basescan before retrying."
            )
        except Exception as e:
            logger.error(f"savings deposit failed: {e}", exc_info=True)
            raise SavingsError("Deposit failed. Your funds were not moved. Try again shortly.")

    def withdraw(self, wallet, amount: Optional[Decimal]) -> str:
        """Withdraw from Aave V3. Pass amount=None (or "all") to withdraw everything.

        Aave burns the aToken and returns USDC to the user's wallet. Returns the
        withdraw tx hash.
        """
        owner = Web3.to_checksum_address(wallet.address)

        if amount is None:
            amount_wei = MAX_UINT256  # Aave sentinel: withdraw full balance.
        else:
            amount = Decimal(str(amount))
            if amount <= 0:
                raise SavingsError("Amount must be greater than zero.")
            amount_wei = self._usdc_to_wei(amount)

        def _op(web3: Web3) -> str:
            if amount_wei != MAX_UINT256:
                position_wei = self._erc20(web3, ABASUSDC_ADDRESS).functions.balanceOf(owner).call()
                if position_wei < amount_wei:
                    have = self._wei_to_usdc(position_wei)
                    raise SavingsError(
                        f"Insufficient savings. You have {have:.2f} USDC saved "
                        f"but tried to withdraw {amount:.2f}."
                    )
            withdraw_fn = self._pool(web3).functions.withdraw(
                Web3.to_checksum_address(USDC_ADDRESS), amount_wei, owner
            )
            tx_hash = self._build_and_send(web3, wallet, withdraw_fn)
            logger.info(f"savings withdraw: tx={tx_hash} amount_wei={amount_wei}")
            return tx_hash

        try:
            return self._failover(_op)
        except SavingsError:
            raise
        except _SentTx as e:
            logger.error(f"savings withdraw post-send failure: {e}")
            raise SavingsError(
                "Your withdrawal was submitted but confirmation timed out. "
                "Check your wallet on basescan before retrying."
            )
        except Exception as e:
            logger.error(f"savings withdraw failed: {e}", exc_info=True)
            raise SavingsError("Withdrawal failed. Your funds were not moved. Try again shortly.")


savings_service = SavingsService()
