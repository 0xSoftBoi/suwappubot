"""HyperLiquid API client for perpetual trading."""

import logging
import time
from typing import Optional
from dataclasses import dataclass

import httpx

from bot.services.hyperliquid_signing import (
    sign_l1_action,
    sign_approve_builder_fee,
    sign_token_delegate,
    sign_staking_transfer,
    float_to_wire,
)

logger = logging.getLogger(__name__)

# Hyperliquid requires a builder address to hold at least this much perps account
# value (USDC) before it is permitted to collect builder fees. (This is an account
# *balance* requirement, not a trading-volume one — volume gating applies to the
# separate referral-code program, which needs $10k traded.)
BUILDER_MIN_ACCOUNT_VALUE_USD = 100.0

# HYPE uses 8 decimals for staking; the ``wei`` field in cDeposit/cWithdraw/
# tokenDelegate actions is denominated in these 1e-8 HYPE units.
HYPE_WEI_DECIMALS = 8

# Hyperliquidity Provider — the flagship community vault, surfaced first in /vault.
HLP_VAULT_ADDRESS = "0xdfc24b077bc1425ad1dea75bcb6f8158e10df303"


def hype_to_wei(amount: float) -> int:
    """Convert a HYPE amount to the integer ``wei`` units staking actions expect."""
    return int(round(amount * (10**HYPE_WEI_DECIMALS)))


@dataclass
class HLMarketInfo:
    """HyperLiquid market information."""

    name: str  # e.g., "ETH"
    sz_decimals: int
    max_leverage: int
    mark_price: float
    funding_rate: float


@dataclass
class HLOrderResult:
    """Result of a HyperLiquid order placement."""

    order_id: str
    status: str  # "filled", "open", "cancelled"
    fill_price: Optional[float] = None
    filled_size: Optional[float] = None


class HyperLiquidClient:
    """Client for HyperLiquid perpetuals exchange."""

    BASE_URL = "https://api.hyperliquid.xyz"
    TESTNET_BASE_URL = "https://api.hyperliquid-testnet.xyz"
    INFO_URL = f"{BASE_URL}/info"
    EXCHANGE_URL = f"{BASE_URL}/exchange"

    # Supported markets
    MARKETS = {
        "ETH-USD": "ETH",
        "BTC-USD": "BTC",
        "SOL-USD": "SOL",
        "ARB-USD": "ARB",
        "AVAX-USD": "AVAX",
        "DOGE-USD": "DOGE",
        "MATIC-USD": "MATIC",
        "OP-USD": "OP",
        "SUI-USD": "SUI",
        "APT-USD": "APT",
    }

    # Real HYPE spot token id (non-canonical + name-colliding with scams, so it
    # must be pinned by id, never resolved by name) — see resolve_spot_asset.
    HYPE_TOKEN_ID = "0x0d01dc56dcaaca66ad901c959b4011ec"

    def __init__(self, testnet: bool = False):
        # Instance URLs/flag shadow the class defaults so a testnet client can be
        # constructed without touching the global mainnet singleton. is_mainnet
        # flows into every signature (phantom-agent source "a" vs "b").
        self.is_mainnet = not testnet
        base = self.TESTNET_BASE_URL if testnet else self.BASE_URL
        self.INFO_URL = f"{base}/info"
        self.EXCHANGE_URL = f"{base}/exchange"
        self._client: Optional[httpx.AsyncClient] = None
        self._asset_index_cache: dict[str, int] = {}
        self._asset_sz_decimals: dict[str, int] = {}
        self._asset_index_fetched_at: float = 0.0
        self._spot_meta: dict = {}
        self._spot_meta_fetched_at: float = 0.0

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                timeout=30.0,
                headers={"Content-Type": "application/json"},
            )
        return self._client

    async def get_markets(self) -> list[HLMarketInfo]:
        """Get all available markets."""
        try:
            client = await self._get_client()
            response = await client.post(
                self.INFO_URL,
                json={"type": "meta"},
            )

            if response.status_code != 200:
                return []

            data = response.json()
            markets = []
            universe = data.get("universe", [])

            for asset_info in universe:
                name = asset_info.get("name", "")
                markets.append(
                    HLMarketInfo(
                        name=name,
                        sz_decimals=asset_info.get("szDecimals", 2),
                        max_leverage=asset_info.get("maxLeverage", 50),
                        mark_price=0.0,  # Fetched separately
                        funding_rate=0.0,
                    )
                )

            return markets
        except Exception as e:
            logger.error(f"Failed to get HyperLiquid markets: {e}")
            return []

    async def get_mark_price(self, market: str) -> Optional[float]:
        """Get current mark price for a market."""
        try:
            asset = self.MARKETS.get(market, market.split("-")[0])
            client = await self._get_client()

            response = await client.post(
                self.INFO_URL,
                json={"type": "allMids"},
            )

            if response.status_code == 200:
                mids = response.json()
                for mid_info in mids:
                    if isinstance(mid_info, dict) and mid_info.get("coin") == asset:
                        return float(mid_info.get("mid", 0))
                # Try dict format
                if isinstance(mids, dict):
                    return float(mids.get(asset, 0))
            return None
        except Exception as e:
            logger.error(f"Failed to get mark price for {market}: {e}")
            return None

    async def get_account_state(self, address: str) -> Optional[dict]:
        """Get account state including positions and margin."""
        try:
            client = await self._get_client()
            response = await client.post(
                self.INFO_URL,
                json={
                    "type": "clearinghouseState",
                    "user": address,
                },
            )

            if response.status_code == 200:
                data = response.json()
                return {
                    "margin_summary": data.get("marginSummary", {}),
                    "positions": data.get("assetPositions", []),
                    "cross_margin_summary": data.get("crossMarginSummary", {}),
                }
            return None
        except Exception as e:
            logger.error(f"Failed to get account state: {e}")
            return None

    async def get_open_positions(self, address: str) -> list[dict]:
        """Get all open positions for an account."""
        state = await self.get_account_state(address)
        if not state:
            return []

        positions = []
        for pos_info in state.get("positions", []):
            position = pos_info.get("position", {})
            if float(position.get("szi", 0)) != 0:
                size = float(position.get("szi", 0))
                positions.append(
                    {
                        "market": position.get("coin", "") + "-USD",
                        "side": "long" if size > 0 else "short",
                        "size": abs(size),
                        "entry_price": float(position.get("entryPx", 0)),
                        "unrealized_pnl": float(position.get("unrealizedPnl", 0)),
                        "liquidation_price": float(position.get("liquidationPx", 0) or 0),
                        "leverage": int(float(position.get("leverage", {}).get("value", 1))),
                        "margin_used": float(position.get("marginUsed", 0)),
                    }
                )

        return positions

    async def place_order(
        self,
        address: str,
        api_key: str,
        api_secret: str,
        market: str,
        side: str,  # "long" or "short"
        size: float,
        price: Optional[float] = None,
        leverage: int = 1,
        order_type: str = "market",
        reduce_only: bool = False,
        tp_price: Optional[float] = None,
        sl_price: Optional[float] = None,
        builder_address: Optional[str] = None,
        builder_fee_tenths_bps: Optional[int] = None,
    ) -> Optional[HLOrderResult]:
        """Place an order on HyperLiquid.

        If ``builder_address`` and ``builder_fee_tenths_bps`` are provided, a
        builder fee is attached to the order (the user must have previously
        approved the builder via :meth:`approve_builder_fee`). ``builder_fee_tenths_bps``
        is denominated in tenths of a basis point (10 = 1 bp = 0.01%).
        """
        try:
            asset = self.MARKETS.get(market, market.split("-")[0])
            client = await self._get_client()

            is_buy = (side == "long" and not reduce_only) or (side == "short" and reduce_only)
            asset_id = await self._resolve_asset_index(asset)
            sz_dec = self._asset_sz_decimals.get(asset, 2)

            # Resolve the wire price. A "market" order is an IOC limit that crosses
            # the book: send an aggressive price derived from the mid (a bare p="0"
            # — the previous behaviour — never fills).
            if order_type == "market":
                mid = await self.get_mark_price(market) or 0.0
                if mid <= 0:
                    logger.error("No mid price for %s; cannot place market order", market)
                    return None
                px = mid * 1.05 if is_buy else mid * 0.95
                order = self._order_wire(
                    asset_id, is_buy, px, size, sz_dec, False, tif="Ioc", reduce_only=reduce_only
                )
            elif order_type == "limit":
                order = self._order_wire(
                    asset_id,
                    is_buy,
                    float(price),
                    size,
                    sz_dec,
                    False,
                    tif="Gtc",
                    reduce_only=reduce_only,
                )
            else:  # take_profit / stop_loss trigger
                order = self._order_wire(
                    asset_id,
                    is_buy,
                    float(price),
                    size,
                    sz_dec,
                    False,
                    reduce_only=reduce_only,
                    tpsl="tp" if order_type == "take_profit" else "sl",
                )

            # Set leverage
            await self._set_leverage(client, address, api_key, api_secret, asset, leverage)

            # Build and sign the action
            action = {
                "type": "order",
                "orders": [order],
                "grouping": "na",
            }

            # Attach builder fee so Suwappu earns on the order. The builder
            # address must be lowercased to match the approveBuilderFee signature,
            # and the fee must not exceed the user's approved max fee rate.
            if builder_address and builder_fee_tenths_bps and builder_fee_tenths_bps > 0:
                action["builder"] = {
                    "b": builder_address.lower(),
                    "f": int(builder_fee_tenths_bps),
                }

            nonce = int(time.time() * 1000)

            response = await client.post(
                self.EXCHANGE_URL,
                json={
                    "action": action,
                    "nonce": nonce,
                    "signature": self._sign_action(action, nonce, api_secret),
                    "vaultAddress": None,
                },
                headers={"Authorization": f"Bearer {api_key}"},
            )

            if response.status_code == 200:
                data = response.json()
                status_data = data.get("response", {}).get("data", {})
                statuses = status_data.get("statuses", [{}])

                if statuses:
                    order_status = statuses[0]
                    if "resting" in order_status:
                        return HLOrderResult(
                            order_id=str(order_status["resting"]["oid"]),
                            status="open",
                        )
                    elif "filled" in order_status:
                        return HLOrderResult(
                            order_id=str(order_status["filled"]["oid"]),
                            status="filled",
                            fill_price=float(order_status["filled"].get("avgPx", 0)),
                            filled_size=float(order_status["filled"].get("totalSz", 0)),
                        )

                logger.warning(f"Unexpected order response: {data}")
                return None

            logger.error(f"Order placement failed: {response.status_code} {response.text[:200]}")
            return None

        except Exception as e:
            logger.error(f"Failed to place order on HyperLiquid: {e}")
            return None

    async def cancel_order(
        self,
        address: str,
        api_key: str,
        api_secret: str,
        market: str,
        order_id: str,
    ) -> bool:
        """Cancel an open order."""
        try:
            asset = self.MARKETS.get(market, market.split("-")[0])
            client = await self._get_client()

            action = {
                "type": "cancel",
                "cancels": [
                    {
                        "a": await self._resolve_asset_index(asset),
                        "o": int(order_id),
                    }
                ],
            }

            nonce = int(time.time() * 1000)

            response = await client.post(
                self.EXCHANGE_URL,
                json={
                    "action": action,
                    "nonce": nonce,
                    "signature": self._sign_action(action, nonce, api_secret),
                    "vaultAddress": None,
                },
                headers={"Authorization": f"Bearer {api_key}"},
            )

            return response.status_code == 200
        except Exception as e:
            logger.error(f"Failed to cancel order: {e}")
            return False

    async def approve_builder_fee(
        self,
        api_secret: str,
        builder_address: str,
        max_fee_rate: str = "0.1%",
    ) -> bool:
        """Approve a builder (and a max fee rate) for the signing user.

        This is a one-time, per-(user, builder) action that authorizes the builder
        to attach fees up to ``max_fee_rate`` to the user's future orders.

        Args:
            api_secret: The user's EVM private key.
            builder_address: Suwappu's builder wallet address.
            max_fee_rate: Max approved fee as a percent string, e.g. ``"0.1%"``.
        """
        try:
            client = await self._get_client()
            nonce = int(time.time() * 1000)
            action, signature = sign_approve_builder_fee(
                api_secret, builder_address, max_fee_rate, nonce, is_mainnet=self.is_mainnet
            )

            response = await client.post(
                self.EXCHANGE_URL,
                json={"action": action, "nonce": nonce, "signature": signature},
            )

            if response.status_code == 200:
                data = response.json()
                if data.get("status") == "ok":
                    return True
                logger.error(f"approveBuilderFee rejected: {data}")
                return False

            logger.error(f"approveBuilderFee failed: {response.status_code} {response.text[:200]}")
            return False
        except Exception as e:
            logger.error(f"Failed to approve builder fee: {e}")
            return False

    async def get_max_builder_fee(self, user_address: str, builder_address: str) -> int:
        """Return the max builder fee (tenths of a bp) the user has approved for the builder.

        Returns 0 when the user has not approved the builder.
        """
        try:
            client = await self._get_client()
            response = await client.post(
                self.INFO_URL,
                json={
                    "type": "maxBuilderFee",
                    "user": user_address,
                    "builder": builder_address.lower(),
                },
            )
            if response.status_code == 200:
                return int(response.json() or 0)
            return 0
        except Exception as e:
            logger.error(f"Failed to query maxBuilderFee: {e}")
            return 0

    async def get_account_value(self, address: str) -> float:
        """Return an address's perps account value (USDC) from clearinghouseState."""
        state = await self.get_account_state(address)
        if not state:
            return 0.0
        return float(state.get("margin_summary", {}).get("accountValue", 0) or 0)

    async def check_builder_eligibility(self, builder_address: str) -> dict:
        """Check whether the builder wallet meets Hyperliquid's requirement.

        A builder may only collect fees once its wallet holds at least 100 USDC of
        perps account value (and uses the standard account-abstraction mode).
        Returns the current account value, the requirement, and an ``eligible`` flag.
        """
        account_value = await self.get_account_value(builder_address)
        return {
            "builder_address": builder_address,
            "account_value_usd": account_value,
            "required_usd": BUILDER_MIN_ACCOUNT_VALUE_USD,
            "eligible": account_value >= BUILDER_MIN_ACCOUNT_VALUE_USD,
            "remaining_usd": max(0.0, BUILDER_MIN_ACCOUNT_VALUE_USD - account_value),
        }

    async def claim_rewards(self, api_secret: str) -> bool:
        """Claim accrued builder/referral rewards to the signer's spot balance.

        Builder-code fees are collected via the same ``claimRewards`` action as
        referral rewards. Must be signed by the builder wallet's own key. Rewards
        are claimable once they exceed $1.

        Args:
            api_secret: The builder wallet's EVM private key.
        """
        try:
            client = await self._get_client()
            action = {"type": "claimRewards"}
            nonce = int(time.time() * 1000)

            response = await client.post(
                self.EXCHANGE_URL,
                json={
                    "action": action,
                    "nonce": nonce,
                    "signature": self._sign_action(action, nonce, api_secret),
                    "vaultAddress": None,
                },
            )

            if response.status_code == 200:
                data = response.json()
                if data.get("status") == "ok":
                    return True
                logger.error(f"claimRewards rejected: {data}")
                return False

            logger.error(f"claimRewards failed: {response.status_code} {response.text[:200]}")
            return False
        except Exception as e:
            logger.error(f"Failed to claim rewards: {e}")
            return False

    # ------------------------------------------------------------------ #
    # TWAP orders                                                        #
    # ------------------------------------------------------------------ #

    async def place_twap_order(
        self,
        address: str,
        api_key: str,
        api_secret: str,
        market: str,
        side: str,  # "long" or "short"
        size: float,
        minutes: int,
        randomize: bool = True,
        reduce_only: bool = False,
    ) -> Optional[str]:
        """Place a TWAP order that slices ``size`` evenly over ``minutes``.

        Returns the TWAP id (as a string) on success, or None.
        """
        try:
            asset = self.MARKETS.get(market, market.split("-")[0])
            client = await self._get_client()
            is_buy = side == "long"
            asset_id = await self._resolve_asset_index(asset)
            sz_dec = self._asset_sz_decimals.get(asset, 2)

            action = {
                "type": "twapOrder",
                "twap": {
                    "a": asset_id,
                    "b": is_buy,
                    "s": float_to_wire(round(size, sz_dec)),
                    "r": reduce_only,
                    "m": int(minutes),
                    "t": bool(randomize),
                },
            }
            nonce = int(time.time() * 1000)

            response = await client.post(
                self.EXCHANGE_URL,
                json={
                    "action": action,
                    "nonce": nonce,
                    "signature": self._sign_action(action, nonce, api_secret),
                    "vaultAddress": None,
                },
                headers={"Authorization": f"Bearer {api_key}"},
            )
            if response.status_code == 200:
                data = response.json()
                status = data.get("response", {}).get("data", {}).get("status", {})
                if isinstance(status, dict) and "running" in status:
                    return str(status["running"].get("twapId"))
                # HL returns {"status": {"error": "..."}} on rejection.
                if isinstance(status, dict) and "error" in status:
                    logger.error(f"twapOrder rejected: {status['error']}")
                    return None
                logger.warning(f"Unexpected twapOrder response: {data}")
                return None
            logger.error(f"twapOrder failed: {response.status_code} {response.text[:200]}")
            return None
        except Exception as e:
            logger.error(f"Failed to place TWAP order: {e}")
            return None

    async def get_twap_history(self, address: str) -> list:
        """Return the user's TWAP history: ``[{time, state, status}]``.

        ``state`` has ``coin, side, sz, executedSz, executedNtl, minutes, ...``;
        ``status.status`` is one of ``activated | terminated | finished | error``.
        This is the authoritative source for TWAP progress + completion (there is
        no per-twapId status endpoint, so entries are matched by coin/side/time).
        """
        return await self._info({"type": "twapHistory", "user": address}) or []

    async def get_twap_slice_fills(self, address: str) -> list:
        """Return the user's TWAP slice fills: ``[{fill, twapId}]`` (most recent 2000)."""
        return await self._info({"type": "userTwapSliceFills", "user": address}) or []

    async def cancel_twap(
        self,
        address: str,
        api_key: str,
        api_secret: str,
        market: str,
        twap_id: int,
    ) -> bool:
        """Cancel a running TWAP order by id."""
        try:
            asset = self.MARKETS.get(market, market.split("-")[0])
            client = await self._get_client()
            action = {
                "type": "twapCancel",
                "a": await self._resolve_asset_index(asset),
                "t": int(twap_id),
            }
            nonce = int(time.time() * 1000)
            response = await client.post(
                self.EXCHANGE_URL,
                json={
                    "action": action,
                    "nonce": nonce,
                    "signature": self._sign_action(action, nonce, api_secret),
                    "vaultAddress": None,
                },
                headers={"Authorization": f"Bearer {api_key}"},
            )
            return response.status_code == 200 and response.json().get("status") == "ok"
        except Exception as e:
            logger.error(f"Failed to cancel TWAP: {e}")
            return False

    # ------------------------------------------------------------------ #
    # Staking (HYPE delegation)                                          #
    # ------------------------------------------------------------------ #

    async def _post_user_signed(self, action: dict, signature: dict, nonce: int) -> bool:
        """POST a pre-signed user-signed action and return whether it succeeded."""
        client = await self._get_client()
        response = await client.post(
            self.EXCHANGE_URL,
            json={"action": action, "nonce": nonce, "signature": signature},
        )
        if response.status_code == 200:
            data = response.json()
            if data.get("status") == "ok":
                return True
            logger.error(f"{action.get('type')} rejected: {data}")
            return False
        logger.error(f"{action.get('type')} failed: {response.status_code} {response.text[:200]}")
        return False

    async def staking_transfer(self, api_secret: str, amount_hype: float, is_deposit: bool) -> bool:
        """Move HYPE between the spot balance and the staking balance.

        ``is_deposit=True`` moves spot→staking (cDeposit); False moves staking→spot
        (cWithdraw). HYPE must be in the staking balance before it can be delegated.
        """
        try:
            nonce = int(time.time() * 1000)
            action, signature = sign_staking_transfer(
                api_secret, hype_to_wei(amount_hype), nonce, is_deposit, is_mainnet=self.is_mainnet
            )
            return await self._post_user_signed(action, signature, nonce)
        except Exception as e:
            logger.error(f"Failed staking transfer: {e}")
            return False

    async def delegate_stake(
        self, api_secret: str, validator: str, amount_hype: float, is_undelegate: bool
    ) -> bool:
        """Delegate (or undelegate) HYPE from the staking balance to a validator."""
        try:
            nonce = int(time.time() * 1000)
            action, signature = sign_token_delegate(
                api_secret,
                validator,
                hype_to_wei(amount_hype),
                is_undelegate,
                nonce,
                self.is_mainnet,
            )
            return await self._post_user_signed(action, signature, nonce)
        except Exception as e:
            logger.error(f"Failed to delegate stake: {e}")
            return False

    async def get_staking_summary(self, address: str) -> dict:
        """Return the delegator summary (delegated, undelegated, pending, rewards)."""
        return await self._info({"type": "delegatorSummary", "user": address}) or {}

    async def get_delegations(self, address: str) -> list:
        """Return the user's current per-validator delegations."""
        return await self._info({"type": "delegations", "user": address}) or []

    async def get_validators(self) -> list:
        """Return all validator summaries (for picking a delegation target)."""
        return await self._info({"type": "validatorSummaries"}) or []

    async def get_ranked_validators(self, limit: int = 8) -> list[dict]:
        """Return active validators ranked by predicted APR, parsed for display.

        Each entry: ``{validator, name, commission_pct, apr_pct, stake_hype}``.
        Jailed/inactive validators are excluded so users can't delegate to a dud.
        """
        raw = await self.get_validators()
        parsed: list[dict] = []
        for v in raw:
            try:
                if v.get("isJailed") or not v.get("isActive", True):
                    continue
                # predictedApr lives under the "day" stats bucket (list of [period, {..}]).
                apr = 0.0
                for period, st in v.get("stats", []):
                    if period == "day":
                        apr = float(st.get("predictedApr", 0) or 0)
                        break
                parsed.append(
                    {
                        "validator": v.get("validator", ""),
                        "name": v.get("name", "") or v.get("validator", "")[:10],
                        "commission_pct": float(v.get("commission", 0) or 0) * 100.0,
                        "apr_pct": apr * 100.0,
                        "stake_hype": float(v.get("stake", 0) or 0) / (10**HYPE_WEI_DECIMALS),
                    }
                )
            except (ValueError, TypeError, KeyError):
                continue
        parsed.sort(key=lambda x: x["apr_pct"], reverse=True)
        return parsed[:limit]

    async def get_hype_price(self) -> float:
        """Return the current HYPE price in USD (from perp mids), or 0.0."""
        mids = await self._info({"type": "allMids"}) or {}
        try:
            if isinstance(mids, dict):
                return float(mids.get("HYPE", 0) or 0)
            for m in mids:
                if isinstance(m, dict) and m.get("coin") == "HYPE":
                    return float(m.get("mid", 0) or 0)
        except (ValueError, TypeError):
            pass
        return 0.0

    # ------------------------------------------------------------------ #
    # Vaults                                                             #
    # ------------------------------------------------------------------ #

    async def vault_transfer(
        self, api_secret: str, vault_address: str, is_deposit: bool, usd: float
    ) -> bool:
        """Deposit USDC into (or withdraw from) a vault (HLP or a user vault).

        ``usd`` is in dollars; it is converted to the integer micro-USD the
        ``vaultTransfer`` action expects.
        """
        try:
            client = await self._get_client()
            action = {
                "type": "vaultTransfer",
                "vaultAddress": vault_address.lower(),
                "isDeposit": is_deposit,
                "usd": int(round(usd * 1_000_000)),
            }
            nonce = int(time.time() * 1000)
            response = await client.post(
                self.EXCHANGE_URL,
                json={
                    "action": action,
                    "nonce": nonce,
                    "signature": self._sign_action(action, nonce, api_secret),
                    "vaultAddress": None,
                },
            )
            return response.status_code == 200 and response.json().get("status") == "ok"
        except Exception as e:
            logger.error(f"Failed vault transfer: {e}")
            return False

    async def get_vault_details(self, vault_address: str, user: Optional[str] = None) -> dict:
        """Return a vault's details (APR, TVL, leader) and optionally the user's stake."""
        req = {"type": "vaultDetails", "vaultAddress": vault_address}
        if user:
            req["user"] = user
        return await self._info(req) or {}

    async def get_user_vault_equities(self, address: str) -> list:
        """Return the user's equity across all vaults they're invested in."""
        return await self._info({"type": "userVaultEquities", "user": address}) or []

    async def get_vault_snapshot(self, vault_address: str, user: Optional[str] = None) -> dict:
        """Return a parsed vault snapshot for display + the user's position in it.

        ``{name, apr_pct, tvl_usd, allow_deposits, leader_commission_pct, user:{
        equity_usd, pnl_usd, all_time_pnl_usd, lockup_until}}`` (``user`` is None
        when the address isn't a follower).
        """
        d = await self.get_vault_details(vault_address, user)
        if not d:
            return {}

        # TVL = the latest point of the daily accountValueHistory.
        tvl = 0.0
        try:
            for period, series in d.get("portfolio", []):
                if period == "day":
                    hist = series.get("accountValueHistory", [])
                    if hist:
                        tvl = float(hist[-1][1])
                    break
        except (ValueError, TypeError, IndexError):
            pass

        snap = {
            "name": d.get("name", ""),
            "vault_address": d.get("vaultAddress", vault_address),
            "apr_pct": float(d.get("apr", 0) or 0) * 100.0,
            "tvl_usd": tvl,
            "allow_deposits": bool(d.get("allowDeposits", True)),
            "leader_commission_pct": float(d.get("leaderCommission", 0) or 0) * 100.0,
            "user": None,
        }
        if user:
            for f in d.get("followers", []):
                if (f.get("user", "") or "").lower() == user.lower():
                    snap["user"] = {
                        "equity_usd": float(f.get("vaultEquity", 0) or 0),
                        "pnl_usd": float(f.get("pnl", 0) or 0),
                        "all_time_pnl_usd": float(f.get("allTimePnl", 0) or 0),
                        "lockup_until": int(f.get("lockupUntil", 0) or 0),
                    }
                    break
        return snap

    # ------------------------------------------------------------------ #
    # Referrals                                                          #
    # ------------------------------------------------------------------ #

    async def set_referrer(self, api_secret: str, code: str) -> bool:
        """Attach a referral code to the signing account (once, on first trade)."""
        try:
            client = await self._get_client()
            action = {"type": "setReferrer", "code": code}
            nonce = int(time.time() * 1000)
            response = await client.post(
                self.EXCHANGE_URL,
                json={
                    "action": action,
                    "nonce": nonce,
                    "signature": self._sign_action(action, nonce, api_secret),
                    "vaultAddress": None,
                },
            )
            return response.status_code == 200 and response.json().get("status") == "ok"
        except Exception as e:
            logger.error(f"Failed to set referrer: {e}")
            return False

    async def get_referral_state(self, address: str) -> dict:
        """Return referral state: who referred this user, and their referral earnings."""
        return await self._info({"type": "referral", "user": address}) or {}

    # ------------------------------------------------------------------ #
    # HyperCore spot trading                                             #
    # ------------------------------------------------------------------ #

    async def _get_spot_meta(self) -> dict:
        """Return cached spotMeta ({tokens, universe}); refreshed every 5 minutes."""
        now = time.time()
        if self._spot_meta and (now - self._spot_meta_fetched_at) < 300:
            return self._spot_meta
        meta = await self._info({"type": "spotMeta"})
        if meta:
            self._spot_meta = meta
            self._spot_meta_fetched_at = now
        return self._spot_meta or {}

    async def resolve_spot_asset(self, coin: str) -> Optional[dict]:
        """Resolve a spot pair to its order parameters — impostor-safe.

        ``coin`` may be:
          * ``"@N"`` — an explicit spot universe index (power users / any pair),
          * a curated symbol — only USDC-quoted *canonical* tokens, plus HYPE
            (pinned by tokenId, since the real HYPE is non-canonical and shares
            its name with scam tokens).

        Returns ``{asset_id, name, sz_decimals, base_index, symbol}`` or None.
        The order asset id is ``10000 + universe_index`` (HyperLiquid's spot rule).
        """
        meta = await self._get_spot_meta()
        universe = meta.get("universe", [])
        tokens = meta.get("tokens", [])
        if not universe:
            return None

        # Explicit "@N" — take the index from the matched entry itself (never guessed).
        if coin.startswith("@") and coin[1:].isdigit():
            idx = int(coin[1:])
            u = next((x for x in universe if x.get("index") == idx), None)
            if not u:
                return None
            return self._spot_asset_from_universe(u, tokens)

        symbol = coin.upper().replace("/USDC", "")
        # Find the *vetted* base token index for this symbol.
        base_index = None
        if symbol == "HYPE":
            tok = next((t for t in tokens if t.get("tokenId") == self.HYPE_TOKEN_ID), None)
            base_index = tok.get("index") if tok else None
        else:
            tok = next(
                (t for t in tokens if t.get("name") == symbol and t.get("isCanonical")), None
            )
            base_index = tok.get("index") if tok else None
        if base_index is None:
            return None

        # Find the USDC-quoted pair ([base, 0]) for that token.
        u = next(
            (x for x in universe if x.get("tokens", [None, None])[:2] == [base_index, 0]), None
        )
        if not u:
            return None
        return self._spot_asset_from_universe(u, tokens, symbol)

    def _spot_asset_from_universe(self, u: dict, tokens: list, symbol: str = None) -> dict:
        base_index = u.get("tokens", [0])[0]
        base_tok = next((t for t in tokens if t.get("index") == base_index), {})
        return {
            "asset_id": 10000 + int(u.get("index", 0)),
            "name": u.get("name", ""),
            "sz_decimals": int(base_tok.get("szDecimals", 2)),
            "base_index": base_index,
            "symbol": symbol or base_tok.get("name", u.get("name", "")),
        }

    async def get_spot_mid(self, pair_name: str) -> float:
        """Return a spot pair's mid price (matched by ``coin``, which is NOT
        positionally aligned with the universe in spotMetaAndAssetCtxs)."""
        res = await self._info({"type": "spotMetaAndAssetCtxs"})
        try:
            _, ctxs = res
            for c in ctxs:
                if c.get("coin") == pair_name:
                    return float(c.get("midPx", 0) or 0)
        except (TypeError, ValueError):
            pass
        return 0.0

    @staticmethod
    def _round_px(px: float, sz_decimals: int, is_spot: bool) -> float:
        """Round a price to HyperLiquid's tick rules: ≤5 significant figures and
        ≤(MAX_DECIMALS − szDecimals) decimal places, where MAX_DECIMALS is 8 for
        spot and 6 for perps. Integers are always allowed."""
        if px <= 0:
            return 0.0
        max_dec = max(0, (8 if is_spot else 6) - sz_decimals)
        px = float(f"{px:.5g}")  # 5 significant figures
        return round(px, max_dec)

    @staticmethod
    def _round_spot_price(px: float, sz_decimals: int) -> str:
        """Spot price as a wire string (kept for callers/tests)."""
        return float_to_wire(HyperLiquidClient._round_px(px, sz_decimals, is_spot=True))

    @staticmethod
    def _order_wire(
        asset_id: int,
        is_buy: bool,
        px: float,
        sz: float,
        sz_decimals: int,
        is_spot: bool,
        *,
        tif: str = "Ioc",
        reduce_only: bool = False,
        tpsl: Optional[str] = None,
    ) -> dict:
        """Build one order's wire dict exactly as the reference SDK does.

        Single source of truth for order serialization: rounds size to szDecimals
        and price to the tick rules, then ``float_to_wire``s both. Key order
        matches HyperLiquid's struct (a,b,p,s,r,t; trigger = isMarket,triggerPx,
        tpsl) — required for the signature to validate server-side.
        """
        px_r = HyperLiquidClient._round_px(px, sz_decimals, is_spot)
        sz_r = round(sz, sz_decimals)
        if tpsl:
            t = {"trigger": {"isMarket": True, "triggerPx": float_to_wire(px_r), "tpsl": tpsl}}
        else:
            t = {"limit": {"tif": tif}}
        return {
            "a": asset_id,
            "b": is_buy,
            "p": float_to_wire(px_r),
            "s": float_to_wire(sz_r),
            "r": reduce_only,
            "t": t,
        }

    async def get_spot_balances(self, address: str) -> list[dict]:
        """Return the user's spot balances: ``[{coin, token, total, hold}]`` (floats).

        ``token`` is the token *index* — the collision-free key (token *names* are
        not unique: scams reuse real symbols).
        """
        state = await self._info({"type": "spotClearinghouseState", "user": address})
        out = []
        for b in (state or {}).get("balances", []):
            total = float(b.get("total", 0) or 0)
            if total > 0:
                out.append(
                    {
                        "coin": b.get("coin", ""),
                        "token": b.get("token"),
                        "total": total,
                        "hold": float(b.get("hold", 0) or 0),
                    }
                )
        return out

    async def get_spot_value_usd(self, address: str) -> float:
        """Total USD value of the user's spot balances (USDC at $1, others at mid).

        Prices each balance by its token *index* (not name) so duplicate-named
        scam tokens can't be mispriced against a real token's market.
        """
        balances = await self.get_spot_balances(address)
        if not balances:
            return 0.0
        res = await self._info({"type": "spotMetaAndAssetCtxs"})
        try:
            meta, ctxs = res
        except (TypeError, ValueError):
            return 0.0
        mid_by_pair = {c.get("coin"): float(c.get("midPx", 0) or 0) for c in ctxs}
        # token index -> its USDC pair name
        pair_by_token = {}
        for u in meta.get("universe", []):
            toks = u.get("tokens", [None, None])
            if len(toks) == 2 and toks[1] == 0:
                pair_by_token[toks[0]] = u.get("name")
        total = 0.0
        for b in balances:
            if b["coin"] == "USDC" or b.get("token") == 0:
                total += b["total"]
            else:
                pair = pair_by_token.get(b.get("token"))
                if pair:
                    total += b["total"] * mid_by_pair.get(pair, 0.0)
        return total

    async def place_spot_order(
        self,
        address: str,
        api_key: str,
        api_secret: str,
        coin: str,
        is_buy: bool,
        size: float,
        slippage: float = 0.05,
        builder_address: Optional[str] = None,
        builder_fee_tenths_bps: Optional[int] = None,
    ) -> Optional[HLOrderResult]:
        """Place a marketable spot order (IOC limit crossing the spread by ``slippage``).

        ``size`` is in base-token units. Returns an HLOrderResult or None.
        """
        try:
            asset = await self.resolve_spot_asset(coin)
            if not asset:
                logger.error(f"Unknown/unsupported spot pair: {coin}")
                return None

            mid = await self.get_spot_mid(asset["name"])
            if mid <= 0:
                logger.error(f"No mid price for spot pair {asset['name']}")
                return None
            limit_px = mid * (1 + slippage) if is_buy else mid * (1 - slippage)
            order = self._order_wire(
                asset["asset_id"],
                is_buy,
                limit_px,
                size,
                asset["sz_decimals"],
                is_spot=True,
                tif="Ioc",
            )
            action = {"type": "order", "orders": [order], "grouping": "na"}
            if builder_address and builder_fee_tenths_bps and builder_fee_tenths_bps > 0:
                action["builder"] = {
                    "b": builder_address.lower(),
                    "f": int(builder_fee_tenths_bps),
                }

            nonce = int(time.time() * 1000)
            client = await self._get_client()
            response = await client.post(
                self.EXCHANGE_URL,
                json={
                    "action": action,
                    "nonce": nonce,
                    "signature": self._sign_action(action, nonce, api_secret),
                    "vaultAddress": None,
                },
                headers={"Authorization": f"Bearer {api_key}"},
            )
            if response.status_code == 200:
                data = response.json()
                statuses = data.get("response", {}).get("data", {}).get("statuses", [{}])
                st = statuses[0] if statuses else {}
                if "filled" in st:
                    return HLOrderResult(
                        order_id=str(st["filled"]["oid"]),
                        status="filled",
                        fill_price=float(st["filled"].get("avgPx", 0)),
                        filled_size=float(st["filled"].get("totalSz", 0)),
                    )
                if "resting" in st:
                    return HLOrderResult(order_id=str(st["resting"]["oid"]), status="open")
                logger.warning(f"Unexpected spot order response: {data}")
                return None
            logger.error(f"Spot order failed: {response.status_code} {response.text[:200]}")
            return None
        except Exception as e:
            logger.error(f"Failed to place spot order: {e}")
            return None

    async def _info(self, body: dict):
        """POST a request to the /info endpoint and return parsed JSON (or None)."""
        try:
            client = await self._get_client()
            response = await client.post(self.INFO_URL, json=body)
            if response.status_code == 200:
                return response.json()
            logger.error(f"info {body.get('type')} failed: {response.status_code}")
            return None
        except Exception as e:
            logger.error(f"info {body.get('type')} error: {e}")
            return None

    async def _set_leverage(
        self,
        client: httpx.AsyncClient,
        address: str,
        api_key: str,
        api_secret: str,
        asset: str,
        leverage: int,
    ):
        """Set leverage for an asset."""
        try:
            action = {
                "type": "updateLeverage",
                "asset": await self._resolve_asset_index(asset),
                "isCross": True,
                "leverage": leverage,
            }

            nonce = int(time.time() * 1000)

            await client.post(
                self.EXCHANGE_URL,
                json={
                    "action": action,
                    "nonce": nonce,
                    "signature": self._sign_action(action, nonce, api_secret),
                    "vaultAddress": None,
                },
                headers={"Authorization": f"Bearer {api_key}"},
            )
        except Exception as e:
            logger.warning(f"Failed to set leverage: {e}")

    # Fallback indices used only if the /info metadata fetch fails. The
    # authoritative mapping is the position of each asset in meta.universe.
    _FALLBACK_ASSET_INDICES = {
        "BTC": 0,
        "ETH": 1,
        "SOL": 2,
        "ARB": 3,
        "AVAX": 4,
        "DOGE": 5,
        "MATIC": 6,
        "OP": 7,
        "SUI": 8,
        "APT": 9,
    }
    ASSET_INDEX_TTL = 3600.0  # seconds

    async def _resolve_asset_index(self, asset: str) -> int:
        """Resolve a HyperLiquid asset index dynamically from /info metadata.

        The index is the asset's position in ``meta.universe`` and can change as
        assets are listed. We cache the mapping with a TTL and fall back to the
        static map only if the fetch fails. An unknown asset raises rather than
        silently defaulting to index 0 (which would target BTC).
        """
        now = time.time()
        if (
            not self._asset_index_cache
            or (now - self._asset_index_fetched_at) > self.ASSET_INDEX_TTL
        ):
            try:
                client = await self._get_client()
                resp = await client.post(self.INFO_URL, json={"type": "meta"})
                if resp.status_code == 200:
                    universe = resp.json().get("universe", [])
                    mapping = {
                        info.get("name"): i for i, info in enumerate(universe) if info.get("name")
                    }
                    if mapping:
                        for name, fallback_idx in self._FALLBACK_ASSET_INDICES.items():
                            if name in mapping and mapping[name] != fallback_idx:
                                logger.warning(
                                    "HyperLiquid asset index drift for %s: dynamic=%s hardcoded=%s",
                                    name,
                                    mapping[name],
                                    fallback_idx,
                                )
                        self._asset_index_cache = mapping
                        self._asset_sz_decimals = {
                            info.get("name"): int(info.get("szDecimals", 2))
                            for info in universe
                            if info.get("name")
                        }
                        self._asset_index_fetched_at = now
            except Exception as e:
                logger.warning("Failed to fetch HyperLiquid asset metadata, using fallback: %s", e)

        if asset in self._asset_index_cache:
            return self._asset_index_cache[asset]
        if asset in self._FALLBACK_ASSET_INDICES:
            logger.warning("Using fallback asset index for %s (metadata unavailable)", asset)
            return self._FALLBACK_ASSET_INDICES[asset]
        raise ValueError(f"Unknown HyperLiquid asset: {asset!r}")

    def _sign_action(self, action: dict, nonce: int, api_secret: str) -> dict:
        """Sign an L1 action for the HyperLiquid exchange API via EIP-712.

        ``api_secret`` is the account's EVM private key; there is no vault address.
        Network (mainnet/testnet) follows ``self.is_mainnet``.
        """
        return sign_l1_action(api_secret, action, None, nonce, is_mainnet=self.is_mainnet)

    async def close(self):
        """Close HTTP client."""
        if self._client and not self._client.is_closed:
            await self._client.aclose()


# Global instance
hyperliquid_client = HyperLiquidClient()
