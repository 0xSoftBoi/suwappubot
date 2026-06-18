"""HyperLiquid funding orchestrator — one-click cross-chain deposits.

The single biggest friction on HyperLiquid is getting funds onto it. Suwappu's
core competency is cross-chain routing, so this service lets a user fund their
HyperCore account from *any* chain in one flow:

  * USDC from any Across-supported chain  -> HyperCore USDC *spot* balance
    (via the Across Swap API, destinationChainId 1337; account auto-created).
  * Native BTC / ETH / SOL                -> HyperCore spot balance
    (via HyperUnit: we hand the user a deposit address; they/we send to it).

After a USDC deposit lands as spot, `move_spot_to_perp` shuttles it to the perp
wallet (usdClassTransfer) so the user can trade perps immediately.

This module reuses the proven custodial EVM send path (mirrors
SwapEngine._execute_across_swap): approval tx(s) then the swap tx, signed with
the user's wallet via WalletService and broadcast through rpc_manager.
"""

import asyncio
import logging
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from web3 import Web3

from bot.services.across_api import (
    ACROSS_TOKENS,
    AcrossError,
    HyperCoreDepositQuote,
    across_api,
)
from bot.services.hyperunit_api import (
    HyperUnitDepositAddress,
    get_minimum,
    hyperunit_api,
    normalize_asset,
)
from bot.services.perps_service import perps_service
from bot.services.rpc_manager import rpc_manager
from bot.services.wallet import WalletService
from bot.config.chains import get_chain_by_name
from bot.models.user import Wallet
from database.db import get_session, run_in_db

logger = logging.getLogger(__name__)

# USDC is 6 decimals everywhere we support.
USDC_DECIMALS = 6

# Conservative minimum USDC deposit. HyperLiquid's legacy bridge had a hard 5
# USDC floor (sub-5 lost); we keep 5 as a safe, user-friendly minimum.
MIN_USDC_DEPOSIT = 5.0


class FundingError(Exception):
    """Raised when a funding request can't be prepared or executed."""


@dataclass
class NativeDepositInstructions:
    """User-facing instructions for a native (BTC/ETH/SOL) HyperUnit deposit."""

    asset: str
    src_chain: str
    deposit_address: str
    hl_address: str
    min_amount: float
    eta_seconds: int


class HyperLiquidFundingService:
    """Quote + execute cross-chain deposits into a user's HyperCore account."""

    def __init__(self):
        self.wallet_service = WalletService()

    # ------------------------------------------------------------------ #
    # Shared helpers
    # ------------------------------------------------------------------ #
    def _require_hl_address(self, user_id: int) -> str:
        """Return the user's HyperCore account address or raise."""
        account = perps_service.get_account(user_id)
        if not account or not account.hl_address:
            raise FundingError(
                "No HyperLiquid account set up yet. Connect your account first "
                "(Perps → Setup) so we know where to send funds."
            )
        return account.hl_address

    # ------------------------------------------------------------------ #
    # USDC (Across Swap API -> HyperCore spot)
    # ------------------------------------------------------------------ #
    async def quote_usdc_deposit(
        self,
        user_id: int,
        from_chain: str,
        amount_human: float,
        depositor_address: str,
        slippage_pct: float = 0.5,
    ) -> HyperCoreDepositQuote:
        """Quote a USDC deposit from `from_chain` into the user's HyperCore account.

        Args:
            user_id: Suwappu user id (used to resolve the HyperCore recipient).
            from_chain: source chain name (must have USDC on Across).
            amount_human: USDC amount in whole tokens (e.g. 50.0).
            depositor_address: the user's origin-chain EVM wallet (the signer).
            slippage_pct: max slippage tolerance, percent.
        """
        if amount_human < MIN_USDC_DEPOSIT:
            raise FundingError(
                f"Minimum deposit is {MIN_USDC_DEPOSIT:g} USDC (got {amount_human:g})."
            )

        hl_address = self._require_hl_address(user_id)

        usdc_addrs = ACROSS_TOKENS.get("USDC", {})
        input_token = usdc_addrs.get(from_chain.lower())
        if not input_token:
            raise FundingError(f"USDC deposits from {from_chain} aren't supported yet.")

        amount_raw = str(int(round(amount_human * (10**USDC_DECIMALS))))

        try:
            return await across_api.get_hypercore_usdc_deposit(
                from_chain=from_chain,
                input_token_address=input_token,
                amount=amount_raw,
                recipient=hl_address,
                depositor=depositor_address,
                slippage_pct=slippage_pct,
            )
        except AcrossError as e:
            raise FundingError(f"Couldn't get a deposit quote: {e}") from e

    async def execute_usdc_deposit(
        self,
        wallet_data: Dict[str, Any],
        quote: HyperCoreDepositQuote,
    ) -> str:
        """Sign and broadcast the deposit (approval tx(s) then swap tx).

        Returns the swap (deposit) transaction hash on the origin chain. The
        relayer credits HyperCore a few seconds later (see quote.estimated_fill_time).
        """
        wallet = await self._get_wallet_for_signing(wallet_data)
        if not wallet:
            raise FundingError("Wallet not found for signing")

        chain = get_chain_by_name(quote.from_chain)
        web3 = rpc_manager.get_web3(quote.from_chain)
        sender = wallet_data["address"]

        # Approvals first (ERC-20 -> Across spoke pool). Each must confirm before
        # the next tx so nonces stay correct.
        for approval in quote.approval_txns:
            await self._sign_and_send(web3, wallet, sender, approval, chain.chain_id, gas=120000)

        # The deposit/swap tx.
        tx_hash = await self._sign_and_send(
            web3, wallet, sender, quote.swap_tx, chain.chain_id, gas=400000
        )
        logger.info("HyperCore USDC deposit tx: %s (recipient %s)", tx_hash, quote.recipient)
        return tx_hash

    async def _sign_and_send(
        self,
        web3,
        wallet: Wallet,
        sender: str,
        tx: Dict[str, Any],
        chain_id: int,
        gas: int,
    ) -> str:
        """Fill gas/nonce/chainId, sign with the user's wallet, broadcast, wait."""
        nonce = await asyncio.to_thread(lambda: web3.eth.get_transaction_count(sender))
        full_tx = {
            "to": Web3.to_checksum_address(tx["to"]),
            "data": tx["data"],
            "value": int(tx.get("value", 0) or 0),
            "gas": gas,
            "gasPrice": await asyncio.to_thread(lambda: web3.eth.gas_price),
            "nonce": nonce,
            "chainId": int(tx.get("chainId") or chain_id),
        }
        signed_hex = await self.wallet_service.sign_evm_transaction(wallet, full_tx)
        tx_hash = await asyncio.to_thread(
            lambda: web3.eth.send_raw_transaction(bytes.fromhex(signed_hex.replace("0x", "")))
        )
        await asyncio.to_thread(lambda: web3.eth.wait_for_transaction_receipt(tx_hash, timeout=180))
        return tx_hash.hex()

    async def _get_wallet_for_signing(self, wallet_data) -> Optional[Wallet]:
        """Resolve a Wallet model object from a dict/object for signing."""
        if isinstance(wallet_data, Wallet):
            return wallet_data
        wallet_id = wallet_data.get("id") or wallet_data.get("wallet_id")
        if wallet_id:

            def _by_id():
                with get_session() as session:
                    return session.query(Wallet).filter(Wallet.id == wallet_id).first()

            wallet = await run_in_db(_by_id)
            if wallet:
                return wallet
        address = wallet_data.get("address")
        if address:

            def _by_addr():
                with get_session() as session:
                    return session.query(Wallet).filter(Wallet.address == address).first()

            return await run_in_db(_by_addr)
        return None

    # ------------------------------------------------------------------ #
    # Native assets (HyperUnit -> HyperCore spot)
    # ------------------------------------------------------------------ #
    async def get_native_deposit_instructions(
        self,
        user_id: int,
        asset: str,
    ) -> NativeDepositInstructions:
        """Generate a HyperUnit deposit address to fund the user's HL account.

        The caller shows the address (and minimum) to the user, or drives the
        send through Suwappu's existing per-chain wallet. Funds minted to the
        user's HyperCore spot balance once the deposit confirms.
        """
        asset_key = normalize_asset(asset)
        hl_address = self._require_hl_address(user_id)
        addr: HyperUnitDepositAddress = await hyperunit_api.generate_deposit_address(
            asset_key, hl_address
        )
        return NativeDepositInstructions(
            asset=addr.asset,
            src_chain=addr.src_chain,
            deposit_address=addr.address,
            hl_address=hl_address,
            min_amount=addr.min_amount,
            eta_seconds=addr.eta_seconds,
        )

    def native_minimum(self, asset: str) -> float:
        """Minimum native deposit for an asset."""
        return get_minimum(asset)

    async def check_native_status(self, deposit_address: str):
        """Poll the HyperUnit mint status for a native deposit address.

        Returns a HyperUnitOperation (`.is_done` once the spot balance is
        credited, with `.destination_tx_hash`).
        """
        return await hyperunit_api.get_operation(deposit_address)

    # ------------------------------------------------------------------ #
    # Post-deposit: move USDC spot -> perp so the user can trade perps
    # ------------------------------------------------------------------ #
    async def move_spot_to_perp(self, user_id: int, amount: float) -> bool:
        """Move `amount` USDC from the user's HyperCore spot to perp wallet."""
        return await perps_service.transfer_usd(user_id, amount, to_perp=True)

    async def get_hl_balance(self, user_id: int) -> dict:
        """Best-effort current HyperLiquid holdings (spot/perp/total USD).

        Returns the `get_holdings_usd` dict, or all-zeros on any error so a
        balance line never breaks the funding menu.
        """
        try:
            return await perps_service.get_holdings_usd(user_id)
        except Exception as e:  # noqa: BLE001 — context only, never block the menu
            logger.warning("get_hl_balance failed (user %s): %s", user_id, e)
            return {"perps_usd": 0.0, "spot_usd": 0.0, "total_usd": 0.0}


# Global instance.
hyperliquid_funding = HyperLiquidFundingService()
