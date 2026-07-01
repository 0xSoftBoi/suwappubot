"""External P2P liquidity providers (NoOnes, P2P.me).

Each provider normalizes its marketplace into a common ``P2POfferQuote`` shape so
the aggregator in ``p2p_service.py`` can rank offers from every source side by
side — the same way the swap engine races DEX aggregators into one quote list.

Built against the real provider docs (verified Jun 2026):

NoOnes — https://dev.noones.com/documentation/
  • Auth: OAuth2 client-credentials. Token at ``https://auth.noones.com/oauth2/token``
    (grant_type=client_credentials), JWT lives ~10 days, sent as ``Authorization:
    Bearer``. HMAC is deprecated since 2022 — we don't use it.
  • Gateway ``https://api.noones.com/``; requests send ``Accept: application/json;
    version=1``. Responses are ALWAYS HTTP 200 with an envelope
    ``{"status": "success"|"error", "timestamp", "data"|"error"}``.
  • Public market data (NO auth): ``GET https://noones.com/data/average`` (per-pair
    avg/ask/bid) and ``GET https://noones.com/data/trades[/{CCY}]`` (completed
    trades). We use these for a real reference-priced offer even without API keys.

P2P.me — on-chain protocol on Base (EIP-2535 Diamond) + ``@p2pdotme/sdk``.
  • Non-custodial; orders are placed on-chain with the user's own wallet. There is
    no REST offer book — prices come from the on-chain price config / subgraph, and
    execution happens client-side via the SDK (see the webapp integration).
  • This Python client surfaces P2P.me as an SDK-executable quote with the real
    contract config so the webapp can place the order with the connected wallet.

Providers are *optional*: each is gated on its config. A missing/unconfigured
provider contributes zero offers and never raises into the aggregator.
"""

import logging
import time
from dataclasses import dataclass, field
from typing import Optional

from bot.config.settings import settings
from bot.utils.http_client import get_session
from bot.utils.rate_limiter import api_limiter

logger = logging.getLogger(__name__)


@dataclass
class P2POfferQuote:
    """A normalized P2P offer from any source (native or external).

    All amounts are human-readable (fiat units, crypto units), not wei — these
    are listing quotes, not on-chain calldata.
    """

    source: str  # P2PSource value: "native" | "noones" | "p2p_me"
    offer_id: str  # provider-native id (string-normalized)
    offer_type: str  # P2POfferType value: "sell_crypto" | "buy_crypto"
    fiat_currency: str
    crypto_asset: str
    crypto_chain: str
    price_per_unit: float  # fiat per 1 unit of crypto
    min_fiat_amount: float
    max_fiat_amount: float
    payment_methods: list[str] = field(default_factory=list)
    region: Optional[str] = None
    maker_handle: Optional[str] = None
    completion_rate: float = 1.0
    trade_count: int = 0
    # Where to send the user to execute when there is no in-app programmatic path
    # (e.g. NoOnes web). Null => executable in-app (native escrow or P2P.me SDK).
    execution_url: Optional[str] = None
    # Provider-specific execution hints (e.g. P2P.me on-chain contract config,
    # NoOnes offer_hash, indicative-vs-live flags). Consumed by the webapp/bot.
    raw: dict = field(default_factory=dict)


class P2PProvider:
    """Base interface for an external P2P marketplace."""

    source = "external"

    @property
    def is_configured(self) -> bool:
        raise NotImplementedError

    async def list_offers(
        self,
        *,
        offer_type: str,
        fiat_currency: str,
        crypto_asset: str,
        fiat_amount: Optional[float] = None,
        region: Optional[str] = None,
        limit: int = 20,
    ) -> list[P2POfferQuote]:
        raise NotImplementedError


# ── NoOnes ──────────────────────────────────────────────────────────────────

NOONES_AUTH_URL = "https://auth.noones.com/oauth2/token"
NOONES_PUBLIC_AVERAGE_URL = "https://noones.com/data/average"
NOONES_PUBLIC_TRADES_URL = "https://noones.com/data/trades"
# Offer search lives behind the OAuth2 gateway. NoOnes inherits Paxful's
# ``/{brand}/v1/...`` method scheme; offer search is the documented v1 method.
NOONES_OFFER_ALL_PATH = "/noones/v1/offer/all"


class NoOnesClient(P2PProvider):
    """NoOnes marketplace client (dev.noones.com).

    Two modes, both returning real-priced quotes:

    1. **Authenticated** (OAuth2 creds set) — calls the gateway ``offer/all`` to
       return live maker offers with real limits, payment methods and reputation.
    2. **Public** (no creds) — derives an indicative offer per pair from the
       no-auth ``/data/average`` market feed (real prices) and hands the user off
       to noones.com to pick a concrete offer. Works out of the box.
    """

    source = "noones"

    def __init__(self):
        self.base_url = settings.noones_api_base.rstrip("/")
        self.api_key = settings.noones_api_key
        self.api_secret = settings.noones_api_secret
        self._token: Optional[str] = None
        self._token_expiry: float = 0.0

    @property
    def is_configured(self) -> bool:
        # Always available — public market data needs no key; auth unlocks live offers.
        return bool(settings.p2p_enabled)

    @property
    def has_credentials(self) -> bool:
        return bool(self.api_key and self.api_secret)

    async def _get_token(self) -> Optional[str]:
        """OAuth2 client-credentials grant. JWT cached until ~1min before expiry."""
        if self._token and time.time() < self._token_expiry - 60:
            return self._token
        if not self.has_credentials:
            return None
        await api_limiter.wait_and_acquire("noones")
        session = await get_session()
        try:
            async with session.post(
                NOONES_AUTH_URL,
                data={
                    "grant_type": "client_credentials",
                    "client_id": self.api_key,
                    "client_secret": self.api_secret,
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                timeout=15,
            ) as resp:
                if resp.status != 200:
                    logger.warning("NoOnes token request failed: %s", resp.status)
                    return None
                data = await resp.json()
                self._token = data.get("access_token")
                # Default client-credentials lifetime is ~10 days; honor expires_in.
                self._token_expiry = time.time() + float(data.get("expires_in", 864000))
                return self._token
        except Exception as e:  # noqa: BLE001 — provider must never break aggregation
            logger.warning("NoOnes token error: %s", e)
            return None

    async def list_offers(
        self,
        *,
        offer_type: str,
        fiat_currency: str,
        crypto_asset: str,
        fiat_amount: Optional[float] = None,
        region: Optional[str] = None,
        limit: int = 20,
    ) -> list[P2POfferQuote]:
        if self.has_credentials:
            live = await self._authenticated_offers(
                offer_type, fiat_currency, crypto_asset, fiat_amount, region, limit
            )
            if live:
                return live
        # Fallback to the real public market feed (no key required).
        return await self._indicative_offers(offer_type, fiat_currency, crypto_asset)

    async def _authenticated_offers(
        self,
        offer_type: str,
        fiat_currency: str,
        crypto_asset: str,
        fiat_amount: Optional[float],
        region: Optional[str],
        limit: int,
    ) -> list[P2POfferQuote]:
        token = await self._get_token()
        if not token:
            return []
        # NoOnes offer_type is from the advertiser's side. A Suwappu taker wanting
        # to BUY crypto needs maker SELL offers, and vice-versa.
        noones_type = "sell" if offer_type == "sell_crypto" else "buy"
        # Param names verified against the live OpenAPI spec (RequestBodyOfferAll):
        # offer_type∈{sell,buy}, currency_code, crypto_currency_code, fiat_amount_min/
        # fiat_amount_max (ints), user_country_iso, limit/offset/sort.
        body = {
            "offer_type": noones_type,
            "currency_code": fiat_currency,
            "crypto_currency_code": crypto_asset,
            "limit": min(limit, 100),
        }
        if fiat_amount:
            body["fiat_amount_min"] = int(fiat_amount)
            body["fiat_amount_max"] = int(fiat_amount)
        if region:
            body["user_country_iso"] = region
        await api_limiter.wait_and_acquire("noones")
        session = await get_session()
        try:
            async with session.post(
                f"{self.base_url}{NOONES_OFFER_ALL_PATH}",
                data=body,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Accept": "application/json; version=1",
                },
                timeout=15,
            ) as resp:
                payload = await resp.json()
        except Exception as e:  # noqa: BLE001
            logger.warning("NoOnes offer/all error: %s", e)
            return []

        # Envelope: {"status": "...", "timestamp": ..., "data": {...}} (always 200).
        if not isinstance(payload, dict) or payload.get("status") != "success":
            logger.info("NoOnes offer/all non-success: %s", str(payload)[:200])
            return []
        offers = (payload.get("data") or {}).get("offers") or []
        out: list[P2POfferQuote] = []
        for o in offers:
            try:
                out.append(self._normalize_offer(o, offer_type, fiat_currency, crypto_asset))
            except Exception as e:  # noqa: BLE001
                logger.debug("NoOnes offer normalize skipped: %s", e)
        return out

    def _normalize_offer(
        self, o: dict, offer_type: str, fiat_currency: str, crypto_asset: str
    ) -> P2POfferQuote:
        # Field names verified against the OpenAPI ``OfferAllObject`` schema.
        offer_id = str(o.get("offer_id") or o.get("offer_hash") or "")
        username = o.get("offer_owner_username") or o.get("owner_username")
        pm = o.get("payment_method_name") or o.get("payment_method_label") or ""
        group = o.get("payment_method_group")
        methods = [m for m in [pm, group] if m]
        # Real price field is ``fiat_price_per_crypto`` (``fiat_price_per_btc`` legacy).
        price = o.get("fiat_price_per_crypto") or o.get("fiat_price_per_btc") or 0
        # Reputation from feedback counts; trade volume from total_successful_trades.
        pos = float(o.get("offer_owner_feedback_positive") or 0)
        neg = float(o.get("offer_owner_feedback_negative") or 0)
        completion = (pos / (pos + neg)) if (pos + neg) > 0 else 1.0
        return P2POfferQuote(
            source=self.source,
            offer_id=offer_id,
            offer_type=offer_type,
            fiat_currency=(o.get("fiat_currency_code") or fiat_currency).upper(),
            crypto_asset=(o.get("crypto_currency_code") or crypto_asset).upper(),
            crypto_chain="noones",
            price_per_unit=float(price or 0),
            min_fiat_amount=float(o.get("fiat_amount_range_min") or 0),
            max_fiat_amount=float(o.get("fiat_amount_range_max") or 0),
            payment_methods=methods,
            region=o.get("offer_owner_country_iso") or o.get("user_country_iso"),
            maker_handle=username,
            completion_rate=completion,
            trade_count=int(o.get("total_successful_trades") or 0),
            # ``offer_link`` is a ready-made absolute URL to the offer page.
            execution_url=o.get("offer_link") or "https://noones.com/buy-crypto",
            raw={"offer_id": offer_id, "live": True, **o},
        )

    async def _indicative_offers(
        self, offer_type: str, fiat_currency: str, crypto_asset: str
    ) -> list[P2POfferQuote]:
        """Build a real-priced offer from the public ``/data/average`` feed."""
        stats = await self.get_average_prices()
        pair = f"{crypto_asset.upper()}_{fiat_currency.upper()}"
        row = stats.get(pair)
        if not row:
            return []
        buying = offer_type == "sell_crypto"
        # NOTE: the feed's lowestAsk/highestBid fields are unreliable legacy values
        # (often orders of magnitude off), so we anchor on avg_24h / last — the
        # real traded reference — and nudge it by a small spread to reflect side.
        ref = float(row.get("avg_24h") or row.get("last") or 0)
        if ref <= 0:
            return []
        price = round(ref * (1.01 if buying else 0.99), 2)
        return [
            P2POfferQuote(
                source=self.source,
                offer_id=f"noones-{pair.lower()}-{'buy' if buying else 'sell'}",
                offer_type=offer_type,
                fiat_currency=fiat_currency.upper(),
                crypto_asset=crypto_asset.upper(),
                crypto_chain="noones",
                price_per_unit=price,
                min_fiat_amount=0.0,
                max_fiat_amount=float(row.get("highest_24h") or 0),
                payment_methods=["bank_transfer", "gift_cards", "online_wallets"],
                region=None,
                maker_handle="NoOnes marketplace",
                completion_rate=1.0,
                trade_count=int(row.get("base_volume") or 0),
                execution_url="https://noones.com/buy-crypto",
                raw={"indicative": True, "pair": pair, "market": row},
            )
        ]

    async def get_average_prices(self) -> dict:
        """Public, no-auth per-pair price stats. Keys like ``BTC_USD``, ``BTC_NGN``."""
        await api_limiter.wait_and_acquire("noones")
        session = await get_session()
        try:
            async with session.get(NOONES_PUBLIC_AVERAGE_URL, timeout=15) as resp:
                if resp.status != 200:
                    return {}
                return await resp.json()
        except Exception as e:  # noqa: BLE001
            logger.debug("NoOnes /data/average error: %s", e)
            return {}

    async def get_recent_trades(self, fiat_currency: Optional[str] = None) -> list[dict]:
        """Public, no-auth completed-trades feed (optionally per fiat currency)."""
        url = NOONES_PUBLIC_TRADES_URL
        if fiat_currency:
            url = f"{url}/{fiat_currency.upper()}"
        await api_limiter.wait_and_acquire("noones")
        session = await get_session()
        try:
            async with session.get(f"{url}?limit=50", timeout=15) as resp:
                if resp.status != 200:
                    return []
                data = await resp.json()
                return data if isinstance(data, list) else []
        except Exception as e:  # noqa: BLE001
            logger.debug("NoOnes /data/trades error: %s", e)
            return []


# ── P2P.me ──────────────────────────────────────────────────────────────────

# Real on-chain config from the @p2pdotme/sdk builder docs (verified Jun 2026).
P2PME_CONTRACTS = {
    "base": {  # Base mainnet, chain 8453
        "chain_id": 8453,
        "diamond": "0x4cad6eC90e65baBec9335cAd728DDC610c316368",
        "usdc": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        "rpc": "https://mainnet.base.org",
    },
    "base-sepolia": {  # Base Sepolia testnet, chain 84532
        "chain_id": 84532,
        "diamond": "0xce868398FDaDcA368EAc203222874D6888532aE2",
        "usdc": "0xDABa329Ed949f28F64019f22c33c3B253B2Ded60",
        "rpc": "https://sepolia.base.org",
    },
}

# P2P.me order types (on-chain enum) and the fiat currencies the protocol supports.
P2PME_ORDER_TYPES = {"buy_crypto": 0, "sell_crypto": 1, "pay": 2}
P2PME_CURRENCIES = {"INR", "IDR", "BRL", "ARS", "MXN", "VES", "EUR", "NGN", "USD", "COP"}
# Local instant rails the SDK parses (qr-parsers: UPI, QRIS, PIX, MercadoPago, PagoMovil).
P2PME_RAILS = {
    "INR": ["upi"],
    "IDR": ["qris"],
    "BRL": ["pix"],
    "ARS": ["mercadopago"],
    "MXN": ["mercadopago"],
    "VES": ["pago_movil"],
}


class P2PMeClient(P2PProvider):
    """P2P.me on-chain LP-network client.

    P2P.me settles USDC on Base via an EIP-2535 Diamond, non-custodially. There's
    no REST offer book: a user places a BUY/SELL order at the on-chain price and
    merchants match it. So this client surfaces ONE SDK-executable quote per
    supported pair carrying the real contract config + order params; the webapp
    completes it with the user's connected wallet via ``@p2pdotme/sdk``. The
    on-chain price is read client-side (``usePrices().getPriceConfig``), so the
    listing price is left 0 ("live rate at checkout") here.
    """

    source = "p2p_me"

    def __init__(self):
        self.network = "base" if settings.p2p_escrow_chain == "base" else settings.p2p_escrow_chain
        if self.network not in P2PME_CONTRACTS:
            self.network = "base"

    @property
    def is_configured(self) -> bool:
        return bool(settings.p2p_enabled)

    async def list_offers(
        self,
        *,
        offer_type: str,
        fiat_currency: str,
        crypto_asset: str,
        fiat_amount: Optional[float] = None,
        region: Optional[str] = None,
        limit: int = 20,
    ) -> list[P2POfferQuote]:
        # P2P.me only settles USDC, and only for the currencies it supports.
        if crypto_asset.upper() != "USDC":
            return []
        if fiat_currency.upper() not in P2PME_CURRENCIES:
            return []
        if offer_type not in ("buy_crypto", "sell_crypto"):
            return []

        contracts = P2PME_CONTRACTS[self.network]
        order_type = P2PME_ORDER_TYPES[offer_type]
        rails = P2PME_RAILS.get(fiat_currency.upper(), ["bank_transfer"])
        action = "buy" if offer_type == "sell_crypto" else "sell"
        return [
            P2POfferQuote(
                source=self.source,
                offer_id=f"p2pme-{action}-{fiat_currency.lower()}",
                offer_type=offer_type,
                fiat_currency=fiat_currency.upper(),
                crypto_asset="USDC",
                crypto_chain="base",
                price_per_unit=0.0,  # read on-chain at checkout via the SDK
                min_fiat_amount=0.0,
                max_fiat_amount=0.0,
                payment_methods=rails,
                region=region,
                maker_handle="P2P.me LP network",
                completion_rate=0.9999,  # advertised <1-in-25,000 fraud rate
                trade_count=0,
                # Bot path hands off to the web app; webapp executes in-app via SDK.
                execution_url=f"https://www.p2p.me/en?action={action}&fiat={fiat_currency.lower()}",
                raw={
                    "sdk_executable": True,  # webapp can place this order via @p2pdotme/sdk
                    "sdk_package": "@p2pdotme/sdk",
                    "network": self.network,
                    "chain_id": contracts["chain_id"],
                    "diamond_address": contracts["diamond"],
                    "usdc_address": contracts["usdc"],
                    "order_type": order_type,  # 0 buy / 1 sell / 2 pay
                    "currency": fiat_currency.upper(),
                    "rails": rails,
                },
            )
        ]


# Module-level singletons (mirrors jupiter_api / polymarket_api convention).
noones_client = NoOnesClient()
p2p_me_client = P2PMeClient()
