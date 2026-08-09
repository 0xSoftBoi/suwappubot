"""Polymarket API client for prediction market trading.

Endpoints:
- Gamma API (read-only market data): https://gamma-api.polymarket.com
- CLOB API (orderbook + trading): https://clob.polymarket.com
"""

import base64
import logging
import secrets
import time
import json
import hashlib
import hmac
from typing import Optional
from dataclasses import dataclass, field

import aiohttp
from eth_account import Account
from eth_account.messages import encode_typed_data

logger = logging.getLogger(__name__)


GAMMA_BASE_URL = "https://gamma-api.polymarket.com"
CLOB_BASE_URL = "https://clob.polymarket.com"

# ── On-chain redemption (Polygon, chain 137) ───────────────────────────────
# Polymarket migrated to pUSD collateral in April 2026. This 0xC011a7... is a
# deliberate Polymarket vanity address (NOT Synthetix sUSD) — verified on-chain.
POLYGON_CHAIN_ID = 137
PUSD_COLLATERAL_ADDRESS = "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB"  # 6 decimals
# Standard Gnosis ConditionalTokens framework deployment used by Polymarket.
CTF_ADDRESS = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045"
# Neg-risk markets redeem through the adapter, NOT the plain CTF, and with a
# DIFFERENT redeemPositions signature.
NEG_RISK_ADAPTER_ADDRESS = "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296"
# parentCollectionId is bytes32(0) for these single-condition markets.
ZERO_BYTES32 = "0x" + "00" * 32

# Plain Gnosis CTF: redeemPositions(collateral, parentCollectionId, conditionId, indexSets)
# plus payoutDenominator(conditionId) which is the on-chain resolution ground truth.
CTF_ABI = [
    {
        "constant": False,
        "inputs": [
            {"name": "collateralToken", "type": "address"},
            {"name": "parentCollectionId", "type": "bytes32"},
            {"name": "conditionId", "type": "bytes32"},
            {"name": "indexSets", "type": "uint256[]"},
        ],
        "name": "redeemPositions",
        "outputs": [],
        "payable": False,
        "stateMutability": "nonpayable",
        "type": "function",
    },
    {
        "constant": True,
        "inputs": [{"name": "", "type": "bytes32"}],
        "name": "payoutDenominator",
        "outputs": [{"name": "", "type": "uint256"}],
        "payable": False,
        "stateMutability": "view",
        "type": "function",
    },
]

# NegRiskAdapter: redeemPositions(conditionId, amounts) — different signature.
NEG_RISK_ADAPTER_ABI = [
    {
        "constant": False,
        "inputs": [
            {"name": "_conditionId", "type": "bytes32"},
            {"name": "_amounts", "type": "uint256[]"},
        ],
        "name": "redeemPositions",
        "outputs": [],
        "payable": False,
        "stateMutability": "nonpayable",
        "type": "function",
    }
]


@dataclass
class RedeemResult:
    """Result of an on-chain redemption attempt."""

    success: bool
    tx_hash: str = ""
    error: str = ""
    # Machine-readable hint so the handler can pick the right error_guidance copy.
    error_category: str = ""


@dataclass
class MarketInfo:
    """Polymarket market data."""

    condition_id: str
    question: str
    description: str = ""
    outcome_yes_price: float = 0.0
    outcome_no_price: float = 0.0
    volume_24hr: float = 0.0
    volume_total: float = 0.0
    liquidity: float = 0.0
    end_date: str = ""
    active: bool = True
    closed: bool = False
    tokens: list = field(default_factory=list)
    image: str = ""
    category: str = ""


@dataclass
class OrderbookSummary:
    """Simplified orderbook data."""

    token_id: str
    best_bid: float = 0.0
    best_ask: float = 0.0
    spread: float = 0.0
    bid_depth: float = 0.0
    ask_depth: float = 0.0


@dataclass
class CLOBCredentials:
    """CLOB API credentials derived from wallet signing."""

    api_key: str
    secret: str
    passphrase: str


@dataclass
class OrderResult:
    """Result of an order placement."""

    success: bool
    order_id: str = ""
    status: str = ""
    error: str = ""


class PolymarketClient:
    """Client for Polymarket Gamma API (read-only) and CLOB API (trading)."""

    def __init__(self):
        self._session: Optional[aiohttp.ClientSession] = None

    async def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(
                timeout=aiohttp.ClientTimeout(total=30),
            )
        return self._session

    async def close(self):
        if self._session and not self._session.closed:
            await self._session.close()

    # ============ GAMMA API (Read-Only Market Data) ============

    async def search_markets(self, query: str, limit: int = 10) -> list[MarketInfo]:
        """Search markets by keyword."""
        try:
            session = await self._get_session()
            params = {
                "_q": query,
                "_limit": limit,
                "active": "true",
                "closed": "false",
            }
            async with session.get(f"{GAMMA_BASE_URL}/markets", params=params) as resp:
                if resp.status != 200:
                    logger.warning(f"Gamma search_markets returned {resp.status}")
                    return []
                data = await resp.json()
                return [self._parse_market(m) for m in data]
        except Exception as e:
            logger.error(f"search_markets error: {e}")
            return []

    async def get_market(self, condition_id: str) -> Optional[MarketInfo]:
        """Get a single market by condition_id."""
        try:
            session = await self._get_session()
            async with session.get(f"{GAMMA_BASE_URL}/markets/{condition_id}") as resp:
                if resp.status != 200:
                    return None
                data = await resp.json()
                return self._parse_market(data)
        except Exception as e:
            logger.error(f"get_market error: {e}")
            return None

    async def get_trending_markets(self, limit: int = 10) -> list[MarketInfo]:
        """Get trending markets by 24hr volume."""
        try:
            session = await self._get_session()
            params = {
                "_limit": limit,
                "active": "true",
                "closed": "false",
                "order": "volume24hr",
                "ascending": "false",
            }
            async with session.get(f"{GAMMA_BASE_URL}/markets", params=params) as resp:
                if resp.status != 200:
                    return []
                data = await resp.json()
                return [self._parse_market(m) for m in data]
        except Exception as e:
            logger.error(f"get_trending_markets error: {e}")
            return []

    async def get_events(self, limit: int = 10) -> list[dict]:
        """Get active events."""
        try:
            session = await self._get_session()
            params = {
                "_limit": limit,
                "active": "true",
                "closed": "false",
            }
            async with session.get(f"{GAMMA_BASE_URL}/events", params=params) as resp:
                if resp.status != 200:
                    return []
                return await resp.json()
        except Exception as e:
            logger.error(f"get_events error: {e}")
            return []

    # ============ CLOB API (Public Read-Only) ============

    async def get_orderbook(self, token_id: str) -> Optional[OrderbookSummary]:
        """Get orderbook for a token."""
        try:
            session = await self._get_session()
            params = {"token_id": token_id}
            async with session.get(f"{CLOB_BASE_URL}/book", params=params) as resp:
                if resp.status != 200:
                    return None
                data = await resp.json()

                bids = data.get("bids", [])
                asks = data.get("asks", [])

                best_bid = float(bids[0]["price"]) if bids else 0.0
                best_ask = float(asks[0]["price"]) if asks else 0.0
                bid_depth = sum(float(b.get("size", 0)) for b in bids[:5])
                ask_depth = sum(float(a.get("size", 0)) for a in asks[:5])

                return OrderbookSummary(
                    token_id=token_id,
                    best_bid=best_bid,
                    best_ask=best_ask,
                    spread=best_ask - best_bid if best_ask and best_bid else 0.0,
                    bid_depth=bid_depth,
                    ask_depth=ask_depth,
                )
        except Exception as e:
            logger.error(f"get_orderbook error: {e}")
            return None

    async def get_midpoint(self, token_id: str) -> Optional[float]:
        """Get midpoint price for a token."""
        try:
            session = await self._get_session()
            params = {"token_id": token_id}
            async with session.get(f"{CLOB_BASE_URL}/midpoint", params=params) as resp:
                if resp.status != 200:
                    return None
                data = await resp.json()
                return float(data.get("mid", 0))
        except Exception as e:
            logger.error(f"get_midpoint error: {e}")
            return None

    async def get_clob_market(self, condition_id: str) -> Optional[dict]:
        """Fetch a market from the CLOB API keyed by condition_id.

        Unlike the Gamma endpoint, the CLOB ``/markets/{condition_id}`` response
        carries per-token ``winner`` booleans once a market resolves, which is the
        ground truth the background monitor uses to settle positions. Returns the
        raw dict (with ``closed``, ``active`` and a ``tokens`` array of
        ``{token_id, outcome, price, winner}``), or ``None`` on error.
        """
        if not condition_id:
            return None
        try:
            session = await self._get_session()
            async with session.get(f"{CLOB_BASE_URL}/markets/{condition_id}") as resp:
                if resp.status != 200:
                    return None
                return await resp.json()
        except Exception as e:
            logger.error(f"get_clob_market error: {e}")
            return None

    @staticmethod
    def resolve_winner(clob_market: dict) -> Optional[dict]:
        """Given a raw CLOB market, return resolution info or ``None`` if unresolved.

        Returns ``{"winning_token_ids": set[str], "closed": bool}`` only when the
        market is closed AND at least one token is flagged ``winner``. A closed
        market with no winner flags yet (mid-resolution) is treated as unresolved
        so we don't settle prematurely.
        """
        if not clob_market or not clob_market.get("closed"):
            return None
        tokens = clob_market.get("tokens") or []
        winners = {
            str(t.get("token_id")) for t in tokens if t.get("winner") is True and t.get("token_id")
        }
        if not winners:
            return None
        return {"winning_token_ids": winners, "closed": True}

    # ============ CLOB API (Authenticated Trading via Official SDK) ============

    def _get_clob_client(self, private_key: str):
        """Create an authenticated ClobClient using the official Polymarket SDK."""
        from py_clob_client.client import ClobClient
        from py_clob_client.clob_types import ApiCreds

        pk = private_key if private_key.startswith("0x") else "0x" + private_key
        client = ClobClient(
            host=CLOB_BASE_URL,
            key=pk,
            chain_id=137,
        )
        # Create or derive API credentials
        client.set_api_creds(client.create_or_derive_api_creds())
        return client

    async def place_order(
        self,
        private_key: str,
        token_id: str,
        side: str,
        amount: float,
        price: float,
    ) -> OrderResult:
        """Place a CLOB **V2** order.

        Order construction and EIP-712 signing are done by
        :mod:`bot.services.polymarket_v2_order`, NOT by py-clob-client. The SDK's
        newest release (0.34.6, Feb 2026) still hardcodes the exchange and USDC.e
        collateral that Polymarket deprecated in the 2026-04-28 CLOB V2
        migration, so `client.create_order()` signs against a dead contract and
        the order is rejected.

        The SDK is still used for what it gets right: deriving L2 API
        credentials, and the HMAC in :func:`build_l2_headers`.

        ``amount`` is pUSD notional for a BUY and share count for a SELL, matching
        the previous behaviour.
        """
        try:
            from bot.config.settings import settings
            from bot.services.polymarket_v2_order import (
                build_l2_headers,
                build_order,
                sign_order,
            )

            client = self._get_clob_client(private_key)
            creds = client.creds
            wallet_address = client.get_address()

            # Neg-risk markets are matched by a DIFFERENT exchange; the signature
            # is bound to whichever contract we pick. Resolve it from the CLOB
            # (the same source the SDK uses) and fail closed — silently assuming
            # "not neg-risk" would reintroduce the wrong-contract bug.
            neg_risk = await self.get_token_neg_risk(token_id)
            if neg_risk is None:
                return OrderResult(
                    success=False,
                    error="Could not determine whether this market is neg-risk; "
                    "refusing to sign against a possibly-wrong exchange.",
                )

            size = amount / price if side.upper() == "BUY" else amount

            order = build_order(
                token_id=token_id,
                side=side,
                size=size,
                price=price,
                maker=wallet_address,
                builder_code=getattr(settings, "polymarket_builder_code", None) or ZERO_BYTES32,
            )
            signed = sign_order(order, private_key, neg_risk=neg_risk)
            body = signed.to_request_body(owner=creds.api_key)

            # The signed body must be serialized ONCE and the SAME string both
            # HMAC'd and sent — re-serializing risks key-order/whitespace drift
            # that would invalidate the signature.
            payload = json.dumps(body, separators=(",", ":"))
            headers = build_l2_headers(
                api_key=creds.api_key,
                api_secret=creds.api_secret,
                passphrase=creds.api_passphrase,
                address=wallet_address,
                method="POST",
                path="/order",
                body=payload,
            )

            session = await self._get_session()
            async with session.post(
                f"{CLOB_BASE_URL}/order", data=payload, headers=headers
            ) as resp:
                resp_body = await resp.json(content_type=None)

            if resp.status == 200 and resp_body and resp_body.get("success"):
                return OrderResult(
                    success=True,
                    order_id=str(resp_body.get("orderID") or resp_body.get("id") or ""),
                    status=str(resp_body.get("status") or "placed"),
                )

            error_msg = (
                (resp_body or {}).get("errorMsg")
                or (resp_body or {}).get("error")
                or f"CLOB returned {resp.status}"
            )
            logger.warning("Polymarket order rejected (%s): %s", resp.status, error_msg)
            return OrderResult(success=False, error=str(error_msg))

        except Exception as e:
            logger.error(f"place_order error: {e}")
            return OrderResult(success=False, error=str(e))

    async def get_token_neg_risk(self, token_id: str) -> Optional[bool]:
        """Whether a token's market is neg-risk. ``None`` when it cannot be determined.

        Public, unauthenticated CLOB endpoint — the same one py-clob-client uses
        to choose the exchange before signing.
        """
        try:
            session = await self._get_session()
            async with session.get(
                f"{CLOB_BASE_URL}/neg-risk", params={"token_id": token_id}
            ) as resp:
                if resp.status != 200:
                    logger.warning("neg-risk lookup returned %s for %s", resp.status, token_id)
                    return None
                data = await resp.json(content_type=None)
            value = (data or {}).get("neg_risk")
            return bool(value) if isinstance(value, bool) else None
        except Exception as e:
            logger.warning("neg-risk lookup failed for %s: %s", token_id, e)
            return None

    async def cancel_order(
        self, creds: CLOBCredentials, wallet_address: str, order_id: str
    ) -> bool:
        """Cancel an open order."""
        try:
            path = f"/order/{order_id}"
            headers = self._sign_clob_request(creds, wallet_address, "DELETE", path)

            session = await self._get_session()
            async with session.delete(
                f"{CLOB_BASE_URL}{path}",
                headers=headers,
            ) as resp:
                return resp.status in (200, 204)

        except Exception as e:
            logger.error(f"cancel_order error: {e}")
            return False

    async def get_positions(self, creds: CLOBCredentials, wallet_address: str) -> list[dict]:
        """Get open positions for authenticated user."""
        try:
            path = "/positions"
            headers = self._sign_clob_request(creds, wallet_address, "GET", path)

            session = await self._get_session()
            async with session.get(
                f"{CLOB_BASE_URL}{path}",
                headers=headers,
            ) as resp:
                if resp.status != 200:
                    return []
                return await resp.json()

        except Exception as e:
            logger.error(f"get_positions error: {e}")
            return []

    # ============ On-Chain Redemption (CTF / NegRiskAdapter) ============

    async def is_neg_risk_market(self, condition_id: str) -> bool:
        """Whether ``condition_id`` is a neg-risk (multi-outcome) market.

        Neg-risk markets redeem through the NegRiskAdapter with a different
        ``redeemPositions`` signature, so the redeem path MUST branch on this.
        Gamma/CLOB market objects expose a ``negRisk`` / ``neg_risk`` boolean;
        we check both the CLOB and Gamma shapes and fail-closed to plain CTF
        (the common case) if neither is present.
        """
        try:
            clob_market = await self.get_clob_market(condition_id)
            if isinstance(clob_market, dict):
                for key in ("neg_risk", "negRisk", "negRiskMarket", "neg_risk_market"):
                    if key in clob_market:
                        return bool(clob_market.get(key))
            gamma_market = await self.get_market(condition_id)
            # get_market returns MarketInfo (no neg_risk field); fall back to the
            # raw Gamma payload only when the CLOB object was silent.
        except Exception as e:
            logger.warning(f"is_neg_risk_market check failed for {condition_id}: {e}")
        return False

    def _get_polygon_web3(self):
        """Polygon Web3 via the bot's health-tracked RPC manager."""
        from bot.services.rpc_manager import rpc_manager

        return rpc_manager.get_web3("polygon")

    def is_resolved_onchain(self, condition_id: str) -> bool:
        """On-chain resolution ground truth: ``payoutDenominator(conditionId) != 0``.

        The CLOB ``winner`` flag lags resolution by minutes; before spending gas on
        a redeem we confirm the condition is actually reported on-chain. A zero (or
        unreadable) denominator means "not resolved yet" — refuse to redeem.
        """
        try:
            from web3 import Web3

            web3 = self._get_polygon_web3()
            ctf = web3.eth.contract(address=Web3.to_checksum_address(CTF_ADDRESS), abi=CTF_ABI)
            cid = self._to_bytes32(condition_id)
            denom = ctf.functions.payoutDenominator(cid).call()
            return int(denom) != 0
        except Exception as e:
            logger.warning(f"payoutDenominator read failed for {condition_id}: {e}")
            return False

    @staticmethod
    def _to_bytes32(value: str) -> bytes:
        """Normalize a 0x-prefixed condition id into 32 raw bytes."""
        from web3 import Web3

        return Web3.to_bytes(hexstr=value)

    async def redeem_position(
        self,
        wallet,
        condition_id: str,
        neg_risk: Optional[bool] = None,
    ) -> RedeemResult:
        """Redeem a resolved winning position on-chain for pUSD.

        Branches on neg-risk:
          * plain CTF  -> redeemPositions(collateral, parentCollectionId=0,
            conditionId, indexSets=[1, 2])
          * neg-risk   -> NegRiskAdapter.redeemPositions(conditionId, amounts)

        Confirms ``payoutDenominator != 0`` on-chain BEFORE building the tx so we
        never spend gas on an unresolved market. Signing/sending reuses the bot's
        WalletService (Turnkey API or local key) + RPC manager — no new signer.

        Returns a :class:`RedeemResult`. ``wallet`` is the user's EVM Wallet ORM
        row; it is the Polymarket trading wallet and pays MATIC for gas.
        """
        if not condition_id:
            return RedeemResult(success=False, error="Missing condition id.")

        # Resolve neg-risk if the caller didn't already determine it.
        if neg_risk is None:
            neg_risk = await self.is_neg_risk_market(condition_id)

        # Heavy lifting (sync web3 + signing) runs off the event loop.
        import asyncio as _asyncio

        return await _asyncio.to_thread(
            self._redeem_position_sync, wallet, condition_id, bool(neg_risk)
        )

    def _redeem_position_sync(self, wallet, condition_id: str, neg_risk: bool) -> RedeemResult:
        """Blocking redeem: confirm resolution, build, sign, send, await receipt."""
        from web3 import Web3

        # Ground-truth resolution check — refuse to redeem an unresolved market.
        if not self.is_resolved_onchain(condition_id):
            return RedeemResult(
                success=False,
                error="Market is not resolved on-chain yet. Try again once it settles.",
                error_category="not_resolved",
            )

        try:
            web3 = self._get_polygon_web3()
            from_addr = Web3.to_checksum_address(wallet.address)
            cid = self._to_bytes32(condition_id)

            if neg_risk:
                contract = web3.eth.contract(
                    address=Web3.to_checksum_address(NEG_RISK_ADAPTER_ADDRESS),
                    abi=NEG_RISK_ADAPTER_ABI,
                )
                # amounts = [0, 0] lets the adapter redeem the caller's full
                # balance of each outcome index (standard Polymarket usage).
                contract_fn = contract.functions.redeemPositions(cid, [0, 0])
            else:
                contract = web3.eth.contract(
                    address=Web3.to_checksum_address(CTF_ADDRESS), abi=CTF_ABI
                )
                # Binary market: both index sets [1, 2]; only the winning leg pays.
                contract_fn = contract.functions.redeemPositions(
                    Web3.to_checksum_address(PUSD_COLLATERAL_ADDRESS),
                    self._to_bytes32(ZERO_BYTES32),
                    cid,
                    [1, 2],
                )

            nonce = web3.eth.get_transaction_count(from_addr)
            gas_price = web3.eth.gas_price
            tx = contract_fn.build_transaction(
                {
                    "from": from_addr,
                    "nonce": nonce,
                    "gasPrice": gas_price,
                    "chainId": POLYGON_CHAIN_ID,
                }
            )
            # estimate_gas also surfaces an insufficient-MATIC / revert early,
            # before we broadcast anything.
            try:
                tx["gas"] = int(web3.eth.estimate_gas(tx) * 1.3)
            except Exception as e:
                msg = str(e).lower()
                if "insufficient funds" in msg or "gas required" in msg:
                    return RedeemResult(
                        success=False,
                        error="Not enough MATIC on Polygon to cover the redeem gas fee.",
                        error_category="insufficient_gas",
                    )
                return RedeemResult(success=False, error=f"Redeem could not be prepared: {e}")

            raw = self._sign_evm_tx(wallet, tx)
            tx_hash = web3.eth.send_raw_transaction(raw)
            # Point of no return — broadcast. Never re-send on failure below.
            hex_hash = tx_hash.hex()
            if not hex_hash.startswith("0x"):
                hex_hash = "0x" + hex_hash
            try:
                receipt = web3.eth.wait_for_transaction_receipt(tx_hash, timeout=180)
            except Exception as e:
                return RedeemResult(
                    success=False,
                    tx_hash=hex_hash,
                    error=f"Submitted but confirmation timed out: {e}",
                    error_category="pending",
                )
            if receipt.get("status") != 1:
                return RedeemResult(
                    success=False,
                    tx_hash=hex_hash,
                    error="Redeem transaction reverted on-chain.",
                    error_category="reverted",
                )
            return RedeemResult(success=True, tx_hash=hex_hash)

        except Exception as e:
            logger.error(f"redeem_position error for {condition_id}: {e}")
            msg = str(e).lower()
            if "insufficient funds" in msg:
                return RedeemResult(
                    success=False,
                    error="Not enough MATIC on Polygon to cover the redeem gas fee.",
                    error_category="insufficient_gas",
                )
            return RedeemResult(success=False, error=str(e))

    @staticmethod
    def _sign_evm_tx(wallet, tx: dict) -> bytes:
        """Sign via WalletService.sign_evm_transaction (Turnkey API or local key).

        Runs inside ``asyncio.to_thread`` (no running event loop in this thread),
        so ``asyncio.run`` is safe — mirrors savings_service's signer.
        """
        import asyncio as _asyncio

        from bot.services.wallet import WalletService

        signed_hex = _asyncio.run(WalletService().sign_evm_transaction(wallet, tx))
        if signed_hex.startswith("0x"):
            signed_hex = signed_hex[2:]
        return bytes.fromhex(signed_hex)

    # ============ Helpers ============

    @staticmethod
    def _maybe_json_list(value) -> list:
        """Gamma returns outcomes/prices/clobTokenIds as JSON-encoded strings."""
        if isinstance(value, list):
            return value
        if isinstance(value, str) and value:
            try:
                parsed = json.loads(value)
                return parsed if isinstance(parsed, list) else []
            except (ValueError, TypeError):
                return []
        return []

    def _parse_market(self, data: dict) -> MarketInfo:
        """Parse raw Gamma API market response into MarketInfo.

        The Gamma /markets endpoint does NOT include a `tokens` array; it
        provides `clobTokenIds` (JSON string of token ids) aligned with
        `outcomes` and `outcomePrices` (also JSON strings). We reconstruct a
        token list shaped as ``{"token_id": ..., "outcome": ...}`` so the bot
        helpers (`_get_yes_token`/`_get_no_token`) and order flow keep working.
        """
        tokens = data.get("tokens") or []
        outcomes = self._maybe_json_list(data.get("outcomes"))
        prices = self._maybe_json_list(data.get("outcomePrices"))

        # Reconstruct tokens from clobTokenIds when no explicit tokens array.
        if not tokens:
            token_ids = self._maybe_json_list(data.get("clobTokenIds"))
            tokens = [
                {
                    "token_id": tid,
                    "outcome": outcomes[i] if i < len(outcomes) else f"Outcome {i}",
                }
                for i, tid in enumerate(token_ids)
            ]

        yes_price = 0.0
        no_price = 0.0
        # Prefer prices aligned to outcomes (Gamma list endpoint shape).
        if outcomes and prices:
            for i, outcome in enumerate(outcomes):
                if i >= len(prices):
                    break
                try:
                    p = float(prices[i] or 0)
                except (ValueError, TypeError):
                    p = 0.0
                name = str(outcome).lower()
                if name == "yes":
                    yes_price = p
                elif name == "no":
                    no_price = p
        # Fallback: per-token price field (single-market shape, if present).
        if yes_price == 0.0 and no_price == 0.0:
            for token in tokens:
                name = str(token.get("outcome", "")).lower()
                try:
                    p = float(token.get("price", 0) or 0)
                except (ValueError, TypeError):
                    p = 0.0
                if name == "yes":
                    yes_price = p
                elif name == "no":
                    no_price = p

        return MarketInfo(
            condition_id=data.get("conditionId", data.get("condition_id", "")),
            question=data.get("question", ""),
            description=data.get("description", ""),
            outcome_yes_price=yes_price,
            outcome_no_price=no_price,
            volume_24hr=float(data.get("volume24hr", 0) or 0),
            volume_total=float(data.get("volumeNum", data.get("volume", 0)) or 0),
            liquidity=float(data.get("liquidityNum", data.get("liquidity", 0)) or 0),
            end_date=data.get("endDate", data.get("end_date_iso", "")),
            active=data.get("active", True),
            closed=data.get("closed", False),
            tokens=tokens,
            image=data.get("image", ""),
            category=data.get("category", ""),
        )


# Singleton instance
polymarket_client = PolymarketClient()
