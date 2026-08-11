"""Suwappu Positions — NFT position cards on Robinhood Chain (chain 4663).

A Position is a card bound to one of the ~96 tokenized equities on Robinhood
Chain. The holder's entry price is stamped on-chain at mint; the card renders
live P&L against it. Holding one grants a swap-fee discount.

Trust model
-----------
Token ids come from an indexer (Blockscout), which is convenient but NOT
authoritative. The discount's VALUE is always resolved by an ``eth_call``
against ``discountBpsFor``, which re-checks ownership on-chain and ignores ids
the address does not own. A stale or hostile indexer can therefore only ever
produce a SMALLER discount, never a larger one. The discount is flat per
holder, not per card, so stacking cards cannot compound the giveaway.

Guardrails (money path)
-----------------------
Consulted while pricing a swap. Every entry point is fail-safe: any RPC,
indexer, config or parse error returns "no perk" rather than raising, so a swap
can never be blocked — or mispriced upward — by a Positions lookup. The sync
fee path reads an in-memory cache only and never does I/O.
"""

import logging
import time
from typing import Optional

from bot.config.settings import settings

logger = logging.getLogger(__name__)

CHAIN = "robinhood"
CHAIN_ID = 4663

# Hard backstop on the discount this module can return, independent of whatever
# the deployed contract reports. Mirrors MAX_HOLD_DISCOUNT_BPS in
# SuwappuPositions.sol. A larger value means a wrong contract or a bad read, and
# we clamp rather than hand out an unbounded fee cut.
MAX_CARD_DISCOUNT_BPS = 100

_CACHE_TTL = 300  # seconds
_MAX_TOKEN_IDS = 200  # cap the eth_call payload for whales / spam wallets

GRADES = ["Underwater", "Flat", "In Profit", "Runner", "Multiple", "Moonshot"]

# Earned-allowlist thresholds. These MUST match classify() in
# nft/position-cards/build_allowlist.py, which builds the Merkle roots the
# contract actually enforces — otherwise the bot promises a spot the mint denies.
FOUNDER_LEVELS = ("gold", "platinum", "diamond")
FOUNDER_VOLUME_USD = 50_000
FOUNDER_REFERRALS = 5
ALLOWLIST_SWAPS = 5
ALLOWLIST_VOLUME_USD = 1_000
ALLOWLIST_REFERRALS = 1

# Canonical ticker order for the collection — the PRICED subset of
# ROBINHOOD_EQUITIES (those with a live Chainlink feed on chain 4663), sorted by
# symbol. This is the same order the contract's ticker arrays were built from;
# see nft/position-cards/deploy_args.json. Do not reorder.
PRICED_TICKERS = [
    "AAPL",
    "AMD",
    "AMZN",
    "ASML",
    "BABA",
    "CLSK",
    "COIN",
    "CRCL",
    "CRWV",
    "DELL",
    "EWY",
    "GME",
    "GOOGL",
    "INTC",
    "IONQ",
    "META",
    "MSFT",
    "MSTR",
    "MU",
    "NBIS",
    "NVDA",
    "ORCL",
    "PLTR",
    "QQQ",
    "RGTI",
    "RKLB",
    "SGOV",
    "SLV",
    "SNDK",
    "SPCX",
    "SPY",
    "TSLA",
    "TSM",
    "USAR",
    "USO",
]

_ABI = [
    {
        "name": "discountBpsFor",
        "type": "function",
        "stateMutability": "view",
        "inputs": [
            {"name": "owner", "type": "address"},
            {"name": "tokenIds", "type": "uint256[]"},
        ],
        "outputs": [{"name": "", "type": "uint16"}],
    },
    {
        "name": "holdsTicker",
        "type": "function",
        "stateMutability": "view",
        "inputs": [
            {"name": "owner", "type": "address"},
            {"name": "tokenIds", "type": "uint256[]"},
            {"name": "tickerIndex", "type": "uint8"},
        ],
        "outputs": [{"name": "", "type": "bool"}],
    },
    {
        "name": "returnBps",
        "type": "function",
        "stateMutability": "view",
        "inputs": [{"name": "tokenId", "type": "uint256"}],
        "outputs": [
            {"name": "bps", "type": "int256"},
            {"name": "priced", "type": "bool"},
        ],
    },
    {
        "name": "grade",
        "type": "function",
        "stateMutability": "view",
        "inputs": [{"name": "tokenId", "type": "uint256"}],
        "outputs": [{"name": "", "type": "uint8"}],
    },
    {
        "name": "remaining",
        "type": "function",
        "stateMutability": "view",
        "inputs": [{"name": "tickerIndex", "type": "uint8"}],
        "outputs": [{"name": "", "type": "uint256"}],
    },
]


class PositionCardsService:
    """Read-only resolver for Suwappu Positions perks and live card state."""

    def __init__(self) -> None:
        self._holdings: dict[str, tuple[float, list[int]]] = {}
        self._discount: dict[str, tuple[float, int]] = {}
        self._user_discount: dict[int, tuple[float, int]] = {}

    # ── config ────────────────────────────────────────────────────────────────

    @property
    def contract_address(self) -> Optional[str]:
        addr = getattr(settings, "suwappu_position_cards_contract", None)
        if not addr or not isinstance(addr, str) or not addr.startswith("0x"):
            return None
        return addr

    @property
    def enabled(self) -> bool:
        return self.contract_address is not None

    def ticker_index(self, symbol: str) -> Optional[int]:
        """Index of `symbol` in the collection's canonical ticker order.

        MUST match the on-chain array order in SuwappuPositions, which is built
        from nft/position-cards/deploy_args.json. Note this is the PRICED subset
        (35 tickers with a Chainlink feed), NOT all ~96 tokenized equities in
        ROBINHOOD_EQUITIES — deriving it from the full registry would shift every
        index and point each card at the wrong company.

        The list is inlined rather than read from nft/ because that directory is
        not part of the deployed bot image. tests/test_position_cards.py asserts
        it matches deploy_args.json exactly.
        """
        try:
            return PRICED_TICKERS.index(symbol.upper())
        except ValueError:
            return None

    # ── holdings (indexer, non-authoritative) ─────────────────────────────────

    async def _token_ids(self, address: str) -> list[int]:
        """Token ids the indexer believes `address` holds. Never raises."""
        key = address.lower()
        hit = self._holdings.get(key)
        if hit and time.time() - hit[0] < _CACHE_TTL:
            return hit[1]

        contract = self.contract_address
        if not contract:
            return []
        ids: list[int] = []
        try:
            import aiohttp

            from bot.config.chains import CHAINS

            base = CHAINS[CHAIN].explorer_url.rstrip("/")
            url = f"{base}/api/v2/addresses/{address}/nft"
            timeout = aiohttp.ClientTimeout(total=6)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.get(url, params={"type": "ERC-721"}) as resp:
                    if resp.status != 200:
                        logger.debug("Positions: indexer HTTP %s for %s", resp.status, address)
                        return []
                    data = await resp.json()
            for item in (data or {}).get("items", []) or []:
                token = item.get("token") or {}
                if (token.get("address") or "").lower() != contract.lower():
                    continue
                raw = item.get("id")
                if raw is None:
                    continue
                ids.append(int(raw))
                if len(ids) >= _MAX_TOKEN_IDS:
                    break
        except Exception as e:  # pragma: no cover - defensive
            logger.debug("Positions: holdings lookup failed for %s: %s", address, e)
            return []

        self._holdings[key] = (time.time(), ids)
        return ids

    # ── perks (contract-verified) ─────────────────────────────────────────────

    def _contract(self):
        from bot.services.rpc_manager import rpc_manager

        w3 = rpc_manager.get_web3(CHAIN)
        return w3.eth.contract(address=w3.to_checksum_address(self.contract_address), abi=_ABI)

    async def get_discount_bps(self, address: Optional[str]) -> int:
        """Swap-fee discount in bps for an address. 0 on any failure."""
        if not address or not self.enabled:
            return 0
        key = address.lower()
        hit = self._discount.get(key)
        if hit and time.time() - hit[0] < _CACHE_TTL:
            return hit[1]
        try:
            ids = await self._token_ids(address)
            if not ids:
                self._discount[key] = (time.time(), 0)
                return 0
            contract = self._contract()
            raw = contract.functions.discountBpsFor(
                contract.w3.to_checksum_address(address), ids
            ).call()
            bps = max(0, min(int(raw), MAX_CARD_DISCOUNT_BPS))
        except Exception as e:  # pragma: no cover - defensive
            logger.debug("Positions: discount lookup failed for %s: %s", address, e)
            return 0
        self._discount[key] = (time.time(), bps)
        return bps

    async def get_positions(self, address: Optional[str]) -> list[dict]:
        """Live state for each card an address holds. Empty on any failure."""
        if not address or not self.enabled:
            return []
        try:
            ids = await self._token_ids(address)
            if not ids:
                return []
            contract = self._contract()
            out = []
            for tid in ids[:50]:
                try:
                    bps, priced = contract.functions.returnBps(tid).call()
                    grade_idx = contract.functions.grade(tid).call()
                except Exception:
                    continue
                out.append(
                    {
                        "token_id": tid,
                        "return_bps": int(bps) if priced else None,
                        "priced": bool(priced),
                        "grade": GRADES[grade_idx] if 0 <= grade_idx < len(GRADES) else "Flat",
                    }
                )
            return out
        except Exception as e:  # pragma: no cover - defensive
            logger.debug("Positions: state lookup failed for %s: %s", address, e)
            return []

    async def get_ticker_xp_boost_bps(self, address: Optional[str], symbol: str) -> int:
        """XP boost in bps for swapping a ticker the address holds a position on."""
        if not address or not self.enabled or not symbol:
            return 0
        idx = self.ticker_index(symbol)
        if idx is None:
            return 0
        try:
            ids = await self._token_ids(address)
            if not ids:
                return 0
            contract = self._contract()
            owner = contract.w3.to_checksum_address(address)
            if not contract.functions.holdsTicker(owner, ids, idx).call():
                return 0
            return 2500  # +25% XP on a ticker you hold a position on
        except Exception as e:  # pragma: no cover - defensive
            logger.debug("Positions: ticker boost lookup failed for %s: %s", address, e)
            return 0

    async def remaining_for_ticker(self, symbol: str) -> Optional[int]:
        """Unminted supply left on a ticker — drives the mint-urgency UI."""
        idx = self.ticker_index(symbol)
        if idx is None or not self.enabled:
            return None
        try:
            return int(self._contract().functions.remaining(idx).call())
        except Exception:
            return None

    # ── sync cache surface (used by the fee path) ─────────────────────────────

    # ── allowlist eligibility (mirrors nft/position-cards/build_allowlist.py) ──

    def allowlist_status(self, user_id: Optional[int]) -> dict:
        """Which mint phase this user has EARNED, and why.

        Deliberately mirrors classify() in build_allowlist.py — the snapshot that
        actually produces the Merkle roots. If the two drift, users are told they
        qualify and then revert at mint, so tests pin the thresholds in both.

        Never raises: on any error returns the "public" fallback, which understates
        rather than overstates eligibility.
        """
        out = {
            "phase": "Public",
            "reasons": [],
            "volume_usd": 0.0,
            "swaps": 0,
            "level": None,
            "referrals": 0,
        }
        if user_id is None:
            return out
        try:
            from bot.models.points import UserPoints
            from database.db import get_session

            with get_session() as session:
                pts = session.query(UserPoints).filter(UserPoints.user_id == user_id).first()
                level = (getattr(pts, "level", None) or "").lower() if pts else ""
                volume = float(getattr(pts, "total_volume_usd", 0) or 0) if pts else 0.0
                swaps = int(getattr(pts, "total_swaps", 0) or 0) if pts else 0
                referrals = 0
                try:
                    from bot.models.referral import Referral

                    referrals = (
                        session.query(Referral).filter(Referral.referrer_id == user_id).count()
                    )
                except Exception:
                    pass

            out.update(volume_usd=volume, swaps=swaps, level=level or None, referrals=referrals)
            reasons = []
            if level in FOUNDER_LEVELS:
                reasons.append(f"{level} XP level")
            if volume >= FOUNDER_VOLUME_USD:
                reasons.append(f"${volume:,.0f} lifetime volume")
            if referrals >= FOUNDER_REFERRALS:
                reasons.append(f"{referrals} referrals")
            if reasons:
                out.update(phase="Founder", reasons=reasons)
                return out

            reasons = []
            if swaps >= ALLOWLIST_SWAPS:
                reasons.append(f"{swaps} swaps")
            if volume >= ALLOWLIST_VOLUME_USD:
                reasons.append(f"${volume:,.0f} lifetime volume")
            if referrals >= ALLOWLIST_REFERRALS:
                reasons.append(f"{referrals} referral(s)")
            if reasons:
                out.update(phase="Allowlist", reasons=reasons)
        except Exception as e:  # pragma: no cover - defensive
            logger.debug("Positions: allowlist status failed for %s: %s", user_id, e)
        return out

    def evm_address_for_user(self, user_id: Optional[int]) -> Optional[str]:
        """First EVM wallet address for a user, or None. Never raises."""
        if user_id is None:
            return None
        try:
            from bot.services.wallet import wallet_service

            wallets = wallet_service.get_user_wallets(user_id, chain_type="evm")
            return next((w.address for w in wallets if w.address), None)
        except Exception as e:  # pragma: no cover - defensive
            logger.debug("Positions: wallet lookup failed for user %s: %s", user_id, e)
            return None

    async def warm_for_user(self, user_id: Optional[int]) -> int:
        """Resolve the user's EVM address, refresh its perk, cache it by user_id.

        Call from an ASYNC swap path shortly before pricing. The fee path is
        sync and must never do I/O, so it reads only the cache this populates.
        """
        if user_id is None or not self.enabled:
            return 0
        try:
            address = self.evm_address_for_user(user_id)
            if not address:
                self._user_discount[user_id] = (time.time(), 0)
                return 0
            bps = await self.get_discount_bps(address)
        except Exception as e:  # pragma: no cover - defensive
            logger.debug("Positions: warm failed for user %s: %s", user_id, e)
            return 0
        self._user_discount[user_id] = (time.time(), bps)
        return bps

    def get_cached_discount_bps_for_user(self, user_id: Optional[int]) -> int:
        """Cached discount for a user. NEVER does I/O — cold cache means 0 bps.

        A cold read costs the user a discount on that one quote rather than
        adding a network round-trip to pricing. It can never overstate.
        """
        if user_id is None or not self.enabled:
            return 0
        hit = self._user_discount.get(user_id)
        if not hit or time.time() - hit[0] >= _CACHE_TTL:
            return 0
        return max(0, min(hit[1], MAX_CARD_DISCOUNT_BPS))

    def invalidate(self, address: str) -> None:
        key = (address or "").lower()
        self._holdings.pop(key, None)
        self._discount.pop(key, None)


position_cards_service = PositionCardsService()
