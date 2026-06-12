"""Starknet BTC yield service — Endur LST + Vesu ERC-4626 venues (Phase 4).

Two venue families, one interface:

- ENDUR_XWBTC: deposit WBTC into Endur's xWBTC LST (auto-compounding STRK
  staking rewards from the official Starknet BTC staking program). Endur also
  exposes deposit_with_referral(assets, receiver, referral: ByteArray); we use
  plain ERC-4626 deposit(assets, receiver) for now.
- VESU_VWBTC / VESU_VSTRKBTC: deposit WBTC / strkBTC into the Vesu V2
  Re7-curated xBTC pool vTokens (full ERC-4626/SNIP-22 surface).

All vaults are ERC-4626: deposit(assets u256, receiver) mints shares,
redeem(shares u256, receiver, owner) burns shares for assets, and
convert_to_assets(shares) gives the BTC-denominated value of a position.

Execution mirrors swap_engine._execute_avnu_swap exactly:
- exact-amount approve(underlying -> venue) + deposit in ONE multicall;
- gasless SNIP-29 paymaster path first (deploy_and_invoke for undeployed
  wallets); ONLY PaymasterUnavailableError (tx definitely not submitted)
  falls back to direct self-paid execute_v3. PaymasterSubmittedError is
  surfaced — the tx MAY have landed, so we NEVER re-execute.
- key-material: _zeroize_str scrubs the private-key string in a finally
  block (the int copies inside starknet_py's KeyPair live until GC).

APY policy: NEVER hardcode an APY number. Endur returns None ("STRK staking
rewards, variable"); Vesu is read best-effort from the vToken contract ABI
(lazy Contract.from_address) and returns None when no clean rate view exists.

starknet_py is imported lazily throughout so this module parses and imports
on interpreters without it (e.g. local Python 3.9).
"""

import logging
from dataclasses import dataclass
from typing import Optional, Union

from bot.config import starknet_addresses as sn
from bot.config.settings import settings

logger = logging.getLogger(__name__)

# All supported underlyings are BTC-denominated with 8 decimals (sats).
BTC_DECIMALS = 8
SATS = 10**BTC_DECIMALS

# Candidate Vesu rate-view entrypoints, probed against the live ABI.
_VESU_RATE_VIEWS = ("interest_rate", "utilization", "current_utilization")


class StarknetYieldError(Exception):
    """User-safe yield error — message is safe to surface in the UI."""


@dataclass(frozen=True)
class YieldVenue:
    key: str
    name: str
    vault_address: str  # ERC-4626 vault (also the LST/vToken token)
    underlying_symbol: str  # WBTC or STRKBTC
    underlying_address: str
    family: str  # "endur" | "vesu"
    yield_note: str


VENUES: dict[str, YieldVenue] = {
    "endur_xwbtc": YieldVenue(
        key="endur_xwbtc",
        name="Endur xWBTC",
        vault_address=sn.XWBTC,
        underlying_symbol="WBTC",
        underlying_address=sn.WBTC,
        family="endur",
        yield_note="STRK staking rewards, variable",
    ),
    "vesu_vwbtc": YieldVenue(
        key="vesu_vwbtc",
        name="Vesu vWBTC (Re7 xBTC)",
        vault_address=sn.V_WBTC_RE7_XBTC,
        underlying_symbol="WBTC",
        underlying_address=sn.WBTC,
        family="vesu",
        yield_note="lending yield in BTC, variable",
    ),
    "vesu_vstrkbtc": YieldVenue(
        key="vesu_vstrkbtc",
        name="Vesu vstrkBTC (Re7 xBTC)",
        vault_address=sn.V_STRKBTC_RE7_XBTC,
        underlying_symbol="STRKBTC",
        underlying_address=sn.STRKBTC,
        family="vesu",
        yield_note="lending yield in BTC, variable",
    ),
}


def get_venue(venue_key: str) -> YieldVenue:
    venue = VENUES.get(venue_key)
    if venue is None:
        raise StarknetYieldError(f"Unknown yield venue: {venue_key}")
    return venue


def _split_u256(value: int) -> tuple[int, int]:
    from bot.services.avnu_api import split_u256

    return split_u256(value)


class StarknetYieldService:
    """BTC-denominated yield on Starknet (Endur LSTs + Vesu vTokens)."""

    def __init__(self, wallet_service=None):
        self._wallet_service = wallet_service

    @property
    def wallet_service(self):
        if self._wallet_service is None:
            from bot.services.wallet import WalletService

            self._wallet_service = WalletService()
        return self._wallet_service

    # ── reads ────────────────────────────────────────────────────────────────

    async def _view_u256(self, contract_address: str, entrypoint: str, calldata: list[str]) -> int:
        """starknet_call a view returning u256 and recombine the limbs."""
        ws = self.wallet_service
        result = await ws._starknet_rpc_call(
            "starknet_call",
            [
                {
                    "contract_address": contract_address,
                    "entry_point_selector": ws._starknet_selector(entrypoint),
                    "calldata": calldata,
                },
                "latest",
            ],
        )
        if isinstance(result, dict) and "error" in result:
            raise StarknetYieldError(f"Contract call {entrypoint} failed: {result['error']}")
        if not isinstance(result, list) or not result:
            raise StarknetYieldError(f"Contract call {entrypoint} returned no data")
        low = int(result[0], 16)
        high = int(result[1], 16) if len(result) > 1 else 0
        return (high << 128) | low

    async def get_position(self, wallet_address: str, venue_key: str) -> dict:
        """Return the user's position in a venue, BTC-denominated.

        Returns {shares_raw, assets_raw, assets_btc, share_price_raw} where
        share_price_raw = convert_to_assets(1e8) (implied assets per 10^8
        shares — the venue's current exchange rate).
        """
        venue = get_venue(venue_key)
        addr_hex = hex(int(wallet_address, 16))
        try:
            shares_raw = await self._view_u256(venue.vault_address, "balanceOf", [addr_hex])
            low, high = _split_u256(SATS)
            share_price_raw = await self._view_u256(
                venue.vault_address, "convert_to_assets", [hex(low), hex(high)]
            )
            assets_raw = 0
            if shares_raw > 0:
                s_low, s_high = _split_u256(shares_raw)
                assets_raw = await self._view_u256(
                    venue.vault_address, "convert_to_assets", [hex(s_low), hex(s_high)]
                )
        except StarknetYieldError:
            raise
        except Exception as e:
            logger.warning("Yield position read failed (%s): %s", venue_key, str(e)[:160])
            raise StarknetYieldError(
                "Could not fetch your yield position. Try again shortly."
            ) from e
        return {
            "shares_raw": shares_raw,
            "assets_raw": assets_raw,
            "assets_btc": assets_raw / SATS,
            "share_price_raw": share_price_raw,
        }

    async def get_apy(self, venue_key: str) -> Optional[float]:
        """Best-effort live APY in percent, or None ("variable").

        NEVER hardcodes a number. Endur returns None (STRK staking rewards
        accrue via the share price; no on-chain APY view). Vesu is probed
        lazily through starknet_py Contract.from_address — if the live vToken
        ABI exposes no clean rate view, returns None.
        """
        venue = get_venue(venue_key)
        if venue.family == "endur":
            return None
        try:
            from starknet_py.contract import Contract

            from bot.services.starknet.client import get_starknet_client

            client = await get_starknet_client()
            contract = await Contract.from_address(
                address=int(venue.vault_address, 16), provider=client
            )
            for view in _VESU_RATE_VIEWS:
                fn = contract.functions.get(view)
                if fn is None:
                    continue
                result = await fn.call()
                value = result[0] if isinstance(result, (tuple, list)) else result
                logger.info("Vesu %s.%s = %s (raw)", venue_key, view, value)
                # No documented scale for these views — refuse to guess a
                # number and present "variable" instead of a wrong APY.
                return None
            return None
        except Exception as e:
            logger.debug("Vesu APY probe failed (%s): %s", venue_key, str(e)[:160])
            return None

    # ── call builders (pure — unit-testable, no starknet_py) ─────────────────

    @staticmethod
    def build_deposit_calls(venue: YieldVenue, amount_raw: int, owner_address: str) -> list[dict]:
        """Exact-amount approve(underlying -> vault) + deposit(amount, owner).

        ONE multicall, zero residual allowance: the vault pulls exactly
        `amount_raw`, consuming the entire approval.
        """
        if amount_raw <= 0:
            raise StarknetYieldError("Amount must be greater than zero.")
        owner = int(owner_address, 16)
        low, high = _split_u256(amount_raw)
        approve_call = {
            "to": venue.underlying_address,
            "entrypoint": "approve",
            "calldata": [int(venue.vault_address, 16), low, high],
        }
        deposit_call = {
            "to": venue.vault_address,
            "entrypoint": "deposit",
            "calldata": [low, high, owner],
        }
        return [approve_call, deposit_call]

    @staticmethod
    def build_redeem_calls(venue: YieldVenue, shares_raw: int, owner_address: str) -> list[dict]:
        """redeem(shares, receiver=owner, owner=owner) — assets land back in the wallet."""
        if shares_raw <= 0:
            raise StarknetYieldError("Shares must be greater than zero.")
        owner = int(owner_address, 16)
        low, high = _split_u256(shares_raw)
        return [
            {
                "to": venue.vault_address,
                "entrypoint": "redeem",
                "calldata": [low, high, owner, owner],
            }
        ]

    # ── writes ───────────────────────────────────────────────────────────────

    async def deposit(self, wallet, venue_key: str, amount_raw: int) -> str:
        """Deposit `amount_raw` (sats, 8dp base units) of the venue's underlying.

        Verifies the wallet balance, then executes the exact-amount
        approve+deposit multicall (paymaster-first). Returns the tx hash.
        """
        venue = get_venue(venue_key)
        if amount_raw <= 0:
            raise StarknetYieldError("Amount must be greater than zero.")

        try:
            balance = await self.wallet_service.get_starknet_token_balance(
                venue.underlying_symbol, wallet.address
            )
        except Exception as e:
            raise StarknetYieldError(
                f"Could not fetch your {venue.underlying_symbol} balance. Try again shortly."
            ) from e
        balance_raw = int(balance * SATS)
        if balance_raw < amount_raw:
            raise StarknetYieldError(
                f"Insufficient {venue.underlying_symbol}. You have "
                f"{balance_raw / SATS:.8f} but tried to deposit {amount_raw / SATS:.8f}."
            )

        calls = self.build_deposit_calls(venue, amount_raw, wallet.address)
        tx_hash = await self._execute_calls(wallet, calls)
        logger.info(
            "starknet yield deposit: venue=%s amount_raw=%s tx=%s", venue_key, amount_raw, tx_hash
        )
        return tx_hash

    async def withdraw(self, wallet, venue_key: str, shares_raw: Union[int, str]) -> str:
        """Redeem vault shares back to the underlying. Pass "max" for everything.

        redeem(shares, receiver=wallet, owner=wallet) — the underlying lands
        back in the user's own wallet.

        Endur note: exits via the staking path may be subject to the Starknet
        staking unbonding period (21 days worst case; Endur matches deposits
        and withdrawals to soften this). We surface whatever the transaction
        does on-chain and do NOT block the withdrawal here.
        """
        venue = get_venue(venue_key)
        if shares_raw == "max":
            position = await self.get_position(wallet.address, venue_key)
            shares_raw = position["shares_raw"]
        shares_raw = int(shares_raw)
        if shares_raw <= 0:
            raise StarknetYieldError("Nothing to withdraw from this venue.")

        calls = self.build_redeem_calls(venue, shares_raw, wallet.address)
        tx_hash = await self._execute_calls(wallet, calls)
        logger.info(
            "starknet yield withdraw: venue=%s shares_raw=%s tx=%s", venue_key, shares_raw, tx_hash
        )
        return tx_hash

    # ── execution (mirrors swap_engine._execute_avnu_swap) ───────────────────

    async def _execute_calls(self, wallet, calls: list[dict]) -> str:
        """Execute calls paymaster-first with the swap engine's exact fallback split.

        - PaymasterUnavailableError (tx definitely NOT submitted) → direct
          self-paid execute_v3 fallback (after ensure_starknet_deployed).
        - PaymasterSubmittedError (tx MAY have landed) → NEVER re-execute;
          raise a user-safe "submitted, may still confirm" error.
        """
        from bot.services.starknet.client import get_starknet_account
        from bot.services.starknet.paymaster import (
            PaymasterSubmittedError,
            PaymasterUnavailableError,
        )
        from bot.services.wallet import _zeroize_str

        use_paymaster = False
        deployed = True
        if settings.starknet_paymaster_enabled:
            try:
                deployed = await self.wallet_service.is_starknet_deployed(wallet.address)
                if deployed:
                    strk_balance = await self.wallet_service.get_starknet_token_balance(
                        "STRK", wallet.address
                    )
                    use_paymaster = strk_balance <= 0
                else:
                    use_paymaster = True
            except Exception as e:
                logger.warning("Yield paymaster eligibility check failed: %s", str(e)[:200])

        private_key = self.wallet_service.get_private_key(wallet)
        try:
            account = await get_starknet_account(private_key, wallet.address)

            paymaster_error: Optional[Exception] = None
            tx_hash: Optional[str] = None
            if use_paymaster:
                try:
                    tx_hash = await self._execute_via_paymaster(account, wallet, calls, deployed)
                except PaymasterUnavailableError as e:
                    # Tx definitely NOT submitted — safe to fall back.
                    paymaster_error = e
                    logger.warning(
                        "Yield paymaster path failed before submission (%s); "
                        "falling back to direct execution",
                        str(e)[:200],
                    )
                except PaymasterSubmittedError as e:
                    # The paymaster tx MAY have landed — NEVER fire the direct
                    # path (double-deposit/double-redeem risk).
                    logger.warning(
                        "Yield paymaster tx dispatched without a usable response "
                        "(%s); refusing direct fallback",
                        str(e)[:200],
                    )
                    raise StarknetYieldError(
                        "Your transaction was submitted via the gasless paymaster but "
                        "we did not receive a confirmation — it may still confirm "
                        "on-chain. Check your balance shortly before retrying."
                    ) from e

            if tx_hash is None:
                try:
                    # Counterfactual accounts must be deployed before their first invoke.
                    await self.wallet_service.ensure_starknet_deployed(wallet)
                    tx_hash = await self._execute_direct(account, calls)
                except StarknetYieldError:
                    raise
                except Exception as direct_error:
                    if paymaster_error is not None:
                        raise StarknetYieldError(
                            "Transaction failed via both the gasless paymaster "
                            f"({str(paymaster_error)[:150]}) and direct execution "
                            f"({str(direct_error)[:150]})"
                        ) from direct_error
                    raise
        finally:
            _zeroize_str(private_key)

        return tx_hash

    async def _execute_via_paymaster(self, account, wallet, calls: list[dict], deployed: bool):
        """SNIP-29 paymaster execution: invoke, or deploy_and_invoke when undeployed."""
        from bot.services.starknet.paymaster import avnu_paymaster, build_argent_deployment

        gas_token = None
        if not settings.avnu_paymaster_api_key:
            gas_token = await self.wallet_service._pick_paymaster_gas_token(wallet.address)
            if gas_token is None:
                from bot.services.starknet.paymaster import PaymasterUnavailableError

                raise PaymasterUnavailableError(
                    "Paymaster accepts none of the wallet's held tokens as gas token"
                )

        deployment = None
        if not deployed:
            deployment = build_argent_deployment(wallet.address, account.signer.public_key)

        tx_hash = await avnu_paymaster.execute_calls_via_paymaster(
            account, calls, gas_token=gas_token, deployment=deployment
        )
        logger.info("Yield paymaster tx submitted: %s", tx_hash)
        return tx_hash

    @staticmethod
    async def _execute_direct(account, calls: list[dict]) -> str:
        """Self-paid v3 (STRK-fee) multicall via starknet_py (lazy imports)."""
        from starknet_py.hash.selector import get_selector_from_name
        from starknet_py.net.client_models import Call

        from bot.services.avnu_api import _to_int

        sn_calls = [
            Call(
                to_addr=_to_int(c["to"]),
                selector=get_selector_from_name(c["entrypoint"]),
                calldata=[_to_int(x) for x in c["calldata"]],
            )
            for c in calls
        ]
        response = await account.execute_v3(calls=sn_calls, auto_estimate=True)
        return hex(response.transaction_hash)


# Global instance
starknet_yield_service = StarknetYieldService()
