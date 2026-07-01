"""P2P marketplace service — aggregation + native on-chain escrow.

Mirrors the swap engine: one entry point (``list_offers``) races every liquidity
source (native escrow book, NoOnes, P2P.me) concurrently and returns a single
ranked list. Trade execution then forks by source:

  - ``native``  → lock USDC in on-chain escrow, run the fiat-payment handshake,
                  release to the taker. Fully non-custodial.
  - ``noones``  → custodial escrow on NoOnes' side; we record an external trade
                  and hand the user off to complete it.
  - ``p2p_me``  → self-custody LP handoff (deeplink) until their API ships.

The on-chain escrow leg is isolated behind :class:`P2PEscrow` so the lock/release
mechanism (escrow contract vs. managed address) can evolve without touching the
state machine. ``P2PEscrow`` fails loudly when no executor is configured rather
than silently pretending a trade settled.
"""

import asyncio
import json
import logging
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Optional

from bot.config.settings import settings
from bot.models.p2p import (
    P2POffer,
    P2PTrade,
    P2PSource,
    P2POfferType,
    P2POfferStatus,
    P2PTradeStatus,
)
from bot.services.p2p_providers import (
    P2POfferQuote,
    noones_client,
    p2p_me_client,
)
from database.db import get_session, run_in_db

logger = logging.getLogger(__name__)


class P2PError(Exception):
    """Base error for P2P operations (safe to surface to the user)."""


class EscrowNotConfiguredError(P2PError):
    """Raised when a native escrow lock/release is attempted with no executor."""


def _restricted_regions() -> set[str]:
    raw = settings.p2p_restricted_regions or ""
    return {r.strip().upper() for r in raw.split(",") if r.strip()}


class P2PEscrow:
    """Non-custodial USDC escrow for native trades.

    Locking moves the seller's USDC into a Suwappu escrow address for the trade
    window; releasing forwards it to the buyer once fiat is confirmed; a refund
    returns it to the seller on cancel/timeout.

    The actual on-chain transfer is delegated to ``_executor`` — an injectable
    callable wired to the wallet signing path. Until that executor + escrow
    address are configured (``settings.p2p_escrow_*`` + a deployed escrow), every
    lock/release raises :class:`EscrowNotConfiguredError` so we never mark a trade
    settled without a real transaction.
    """

    def __init__(self):
        self.chain = settings.p2p_escrow_chain
        self.token = settings.p2p_escrow_token
        # Injected at startup once the on-chain send path is wired. Signature:
        #   async def executor(action, *, from_wallet_id, to_address, amount, chain, token) -> str  # tx hash
        self._executor = None

    def set_executor(self, executor) -> None:
        self._executor = executor

    @property
    def is_ready(self) -> bool:
        return self._executor is not None

    @staticmethod
    def _allowed_chains() -> set[str]:
        raw = settings.p2p_escrow_allowed_chains or ""
        return {c.strip().lower() for c in raw.split(",") if c.strip()}

    def _guard_chain(self, chain: Optional[str]) -> None:
        """Reject escrow settlement on chains outside the allowlist.

        Central guard so an armed executor cannot move funds on an unintended
        chain (e.g. base mainnet) while native P2P is still testnet-only. An empty
        allowlist permits all chains.
        """
        target = (chain or self.chain).lower()
        allowed = self._allowed_chains()
        if allowed and target not in allowed:
            raise P2PError(f"Native P2P escrow is not enabled on chain '{target}'.")

    async def lock(self, *, seller_wallet_id: int, amount: str, chain: Optional[str] = None) -> str:
        if not self._executor:
            raise EscrowNotConfiguredError(
                "Native P2P escrow is not yet wired to the on-chain signer. "
                "Configure the escrow executor before enabling native trades."
            )
        self._guard_chain(chain)
        return await self._executor(
            "lock",
            from_wallet_id=seller_wallet_id,
            to_address=None,
            amount=amount,
            chain=chain or self.chain,
            token=self.token,
        )

    async def release(self, *, buyer_address: str, amount: str, chain: Optional[str] = None) -> str:
        if not self._executor:
            raise EscrowNotConfiguredError(
                "Native P2P escrow is not yet wired to the on-chain signer."
            )
        self._guard_chain(chain)
        return await self._executor(
            "release",
            from_wallet_id=None,
            to_address=buyer_address,
            amount=amount,
            chain=chain or self.chain,
            token=self.token,
        )

    async def refund(self, *, seller_address: str, amount: str, chain: Optional[str] = None) -> str:
        if not self._executor:
            raise EscrowNotConfiguredError(
                "Native P2P escrow is not yet wired to the on-chain signer."
            )
        self._guard_chain(chain)
        return await self._executor(
            "refund",
            from_wallet_id=None,
            to_address=seller_address,
            amount=amount,
            chain=chain or self.chain,
            token=self.token,
        )


class P2PService:
    """Aggregates P2P liquidity and runs the native trade lifecycle."""

    def __init__(self):
        self.escrow = P2PEscrow()
        self._providers = [noones_client, p2p_me_client]

    # ── Discovery / aggregation ──────────────────────────────────────────────

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
        """Race the native book + every external provider, return ranked offers.

        ``offer_type`` is the *maker* side the taker is looking for: a taker who
        wants to BUY crypto searches ``sell_crypto`` offers, and vice-versa.
        """
        if not settings.p2p_enabled:
            return []

        tasks = [
            self._native_offers(
                offer_type=offer_type,
                fiat_currency=fiat_currency,
                crypto_asset=crypto_asset,
                fiat_amount=fiat_amount,
                region=region,
                limit=limit,
            )
        ]
        for provider in self._providers:
            if provider.is_configured:
                tasks.append(
                    provider.list_offers(
                        offer_type=offer_type,
                        fiat_currency=fiat_currency,
                        crypto_asset=crypto_asset,
                        fiat_amount=fiat_amount,
                        region=region,
                        limit=limit,
                    )
                )

        results = await asyncio.gather(*tasks, return_exceptions=True)
        offers: list[P2POfferQuote] = []
        for r in results:
            if isinstance(r, Exception):
                logger.warning("P2P source failed during aggregation: %s", r)
                continue
            offers.extend(r)

        return self._rank(offers, offer_type)[:limit]

    @staticmethod
    def _rank(offers: list[P2POfferQuote], offer_type: str) -> list[P2POfferQuote]:
        """Best price first; handoff/zero-price offers (no live quote) go last."""
        # Taker buying crypto wants the LOWEST price; taker selling wants HIGHEST.
        buying = offer_type == "sell_crypto"

        def key(o: P2POfferQuote):
            has_price = o.price_per_unit > 0
            # Sort: priced offers first, then by price direction, then reputation.
            price_key = o.price_per_unit if buying else -o.price_per_unit
            return (0 if has_price else 1, price_key, -o.completion_rate, -o.trade_count)

        return sorted(offers, key=key)

    async def _native_offers(
        self,
        *,
        offer_type: str,
        fiat_currency: str,
        crypto_asset: str,
        fiat_amount: Optional[float],
        region: Optional[str],
        limit: int,
    ) -> list[P2POfferQuote]:
        def _query() -> list[P2POfferQuote]:
            with get_session() as session:
                q = session.query(P2POffer).filter(
                    P2POffer.status == P2POfferStatus.ACTIVE.value,
                    P2POffer.offer_type == offer_type,
                    P2POffer.fiat_currency == fiat_currency.upper(),
                    P2POffer.crypto_asset == crypto_asset.upper(),
                )
                if fiat_amount:
                    q = q.filter(
                        P2POffer.min_fiat_amount <= fiat_amount,
                        P2POffer.max_fiat_amount >= fiat_amount,
                    )
                rows = q.limit(limit).all()
                return [self._offer_to_quote(o) for o in rows]

        return await run_in_db(_query)

    @staticmethod
    def _offer_to_quote(o: P2POffer) -> P2POfferQuote:
        try:
            methods = json.loads(o.payment_methods or "[]")
        except (ValueError, TypeError):
            methods = []
        return P2POfferQuote(
            source=P2PSource.NATIVE.value,
            offer_id=str(o.id),
            offer_type=o.offer_type,
            fiat_currency=o.fiat_currency,
            crypto_asset=o.crypto_asset,
            crypto_chain=o.crypto_chain,
            price_per_unit=float(o.price_per_unit or 0),
            min_fiat_amount=float(o.min_fiat_amount or 0),
            max_fiat_amount=float(o.max_fiat_amount or 0),
            payment_methods=methods,
            region=o.region,
            maker_handle=f"user:{o.maker_user_id}",
            completion_rate=float(o.completion_rate or 1.0),
            trade_count=int(o.trade_count or 0),
            execution_url=None,  # executable in-app
            raw={"offer_id": o.id},
        )

    # ── Native offer book ────────────────────────────────────────────────────

    async def create_offer(
        self,
        *,
        maker_user_id: int,
        maker_wallet_id: Optional[int],
        offer_type: str,
        fiat_currency: str,
        crypto_asset: str,
        crypto_chain: str,
        price_per_unit: float,
        min_fiat_amount: float,
        max_fiat_amount: float,
        payment_methods: list[str],
        region: Optional[str] = None,
        terms: Optional[str] = None,
        payment_window_minutes: int = 30,
        available_crypto: Optional[str] = None,
    ) -> int:
        if offer_type not in (P2POfferType.SELL_CRYPTO.value, P2POfferType.BUY_CRYPTO.value):
            raise P2PError(f"Invalid offer_type: {offer_type}")
        if max_fiat_amount < min_fiat_amount:
            raise P2PError("max_fiat_amount must be >= min_fiat_amount")
        if price_per_unit <= 0:
            raise P2PError("price_per_unit must be positive")

        def _create() -> int:
            with get_session() as session:
                offer = P2POffer(
                    maker_user_id=maker_user_id,
                    maker_wallet_id=maker_wallet_id,
                    source=P2PSource.NATIVE.value,
                    offer_type=offer_type,
                    status=P2POfferStatus.ACTIVE.value,
                    fiat_currency=fiat_currency.upper(),
                    crypto_asset=crypto_asset.upper(),
                    crypto_chain=crypto_chain,
                    price_per_unit=Decimal(str(price_per_unit)),
                    min_fiat_amount=Decimal(str(min_fiat_amount)),
                    max_fiat_amount=Decimal(str(max_fiat_amount)),
                    available_crypto=available_crypto,
                    payment_methods=json.dumps(payment_methods),
                    region=region.upper() if region else None,
                    terms=terms,
                    payment_window_minutes=payment_window_minutes,
                )
                session.add(offer)
                session.commit()
                session.refresh(offer)
                return offer.id

        return await run_in_db(_create)

    async def set_offer_status(self, *, offer_id: int, maker_user_id: int, status: str) -> bool:
        def _update() -> bool:
            with get_session() as session:
                offer = (
                    session.query(P2POffer)
                    .filter(P2POffer.id == offer_id, P2POffer.maker_user_id == maker_user_id)
                    .first()
                )
                if not offer:
                    return False
                offer.status = status
                session.commit()
                return True

        return await run_in_db(_update)

    # ── Trade lifecycle ──────────────────────────────────────────────────────

    async def start_trade(
        self,
        *,
        taker_user_id: int,
        taker_wallet_address: Optional[str],
        offer: P2POfferQuote,
        fiat_amount: float,
        payment_method: str,
        region: Optional[str] = None,
    ) -> P2PTrade:
        """Open a trade against an offer. Forks by source.

        For native offers this records the trade as INITIATED and locks escrow
        when the taker is the buyer of crypto (seller's funds get escrowed). For
        external sources it records an external trade and returns the handoff URL
        on the trade object's ``error_message``-free path (via execution_url).
        """
        if region and region.upper() in _restricted_regions():
            raise P2PError(f"P2P is not available in your region ({region.upper()}).")
        if fiat_amount <= 0:
            raise P2PError("Amount must be positive.")
        if offer.price_per_unit > 0 and (
            fiat_amount < offer.min_fiat_amount or fiat_amount > offer.max_fiat_amount
        ):
            raise P2PError(
                f"Amount must be between {offer.min_fiat_amount} and "
                f"{offer.max_fiat_amount} {offer.fiat_currency}."
            )

        crypto_amount = str(fiat_amount / offer.price_per_unit) if offer.price_per_unit > 0 else "0"
        expires_at = datetime.utcnow() + timedelta(minutes=30)

        # For native trades, capture the maker id + both parties' payout addresses
        # now, so settlement (release→buyer, refund→seller) never trusts free-text
        # operator input. offer_type is from the MAKER's perspective: SELL_CRYPTO
        # means the maker sells crypto (maker=seller, taker=buyer); BUY_CRYPTO means
        # the maker buys crypto (maker=buyer, taker=seller).
        maker_user_id: Optional[int] = None
        buyer_address: Optional[str] = None
        seller_address: Optional[str] = None
        if offer.source == P2PSource.NATIVE.value:

            def _load_maker() -> tuple[Optional[int], Optional[str]]:
                from bot.models.user import Wallet

                with get_session() as session:
                    row = session.query(P2POffer).filter(P2POffer.id == int(offer.offer_id)).first()
                    if not row:
                        return (None, None)
                    addr = None
                    if row.maker_wallet_id:
                        w = session.query(Wallet).filter(Wallet.id == row.maker_wallet_id).first()
                        addr = w.address if w else None
                    return (row.maker_user_id, addr)

            maker_user_id, maker_address = await run_in_db(_load_maker)

            from web3 import Web3

            def _checksum(a: Optional[str]) -> Optional[str]:
                return Web3.to_checksum_address(a) if a and Web3.is_address(a) else None

            taker_norm = _checksum(taker_wallet_address)
            maker_norm = _checksum(maker_address)
            if offer.offer_type == P2POfferType.SELL_CRYPTO.value:
                buyer_address = taker_norm
                seller_address = maker_norm
            else:
                buyer_address = maker_norm
                seller_address = taker_norm
            # Fail closed: a native trade must have a verified buyer payout address
            # (the normal completion path) recorded up front, never deferred to
            # free-text operator input at release time.
            if not buyer_address:
                raise P2PError(
                    "Cannot start native trade: no verified payout address for the "
                    "crypto buyer. Both parties need a valid wallet on file."
                )

        def _persist() -> int:
            with get_session() as session:
                trade = P2PTrade(
                    source=offer.source,
                    offer_id=(
                        int(offer.offer_id) if offer.source == P2PSource.NATIVE.value else None
                    ),
                    external_offer_id=(
                        offer.offer_id if offer.source != P2PSource.NATIVE.value else None
                    ),
                    taker_user_id=taker_user_id,
                    maker_user_id=maker_user_id,
                    counterparty_handle=offer.maker_handle,
                    status=P2PTradeStatus.INITIATED.value,
                    offer_type=offer.offer_type,
                    fiat_currency=offer.fiat_currency,
                    crypto_asset=offer.crypto_asset,
                    crypto_chain=offer.crypto_chain,
                    fiat_amount=Decimal(str(fiat_amount)),
                    crypto_amount=crypto_amount,
                    price_per_unit=Decimal(str(offer.price_per_unit)),
                    payment_method=payment_method,
                    expires_at=expires_at,
                    buyer_address=buyer_address,
                    seller_address=seller_address,
                )
                session.add(trade)
                session.commit()
                session.refresh(trade)
                session.expunge(trade)
                return trade.id

        trade_id = await run_in_db(_persist)
        return await self.get_trade(trade_id)

    async def _resolve_seller_wallet_id(self, trade: P2PTrade) -> int:
        """Resolve which Suwappu wallet holds the crypto leg to escrow.

        The seller is determined by offer_type, NOT by whoever drives the trade:
        on a SELL_CRYPTO offer the maker is the seller (escrow the offer's maker
        wallet); on a BUY_CRYPTO offer the taker is the seller (escrow the taker's
        default EVM wallet). Resolving this server-side prevents escrowing the wrong
        party's funds (e.g. the taker's wallet on a SELL_CRYPTO offer).
        """

        def _resolve() -> Optional[int]:
            if trade.offer_type == P2POfferType.SELL_CRYPTO.value:
                with get_session() as session:
                    offer = session.query(P2POffer).filter(P2POffer.id == trade.offer_id).first()
                    return offer.maker_wallet_id if offer else None
            # BUY_CRYPTO: the taker is the seller of crypto.
            from bot.services.wallet import WalletService

            w = WalletService().get_default_wallet(trade.taker_user_id, "evm")
            return w.id if w else None

        wallet_id = await run_in_db(_resolve)
        if not wallet_id:
            raise P2PError("Could not resolve the seller's escrow wallet for this trade.")
        return int(wallet_id)

    async def lock_escrow(
        self, *, trade_id: int, seller_wallet_id: Optional[int] = None
    ) -> P2PTrade:
        """Lock the seller's crypto into native escrow (native trades only).

        The seller wallet is resolved from the trade (by offer_type), so a caller
        cannot escrow the wrong party. An explicitly-passed ``seller_wallet_id`` is
        accepted only as a guard that must match the resolved wallet.
        """
        trade = await self.get_trade(trade_id)
        if trade.source != P2PSource.NATIVE.value:
            raise P2PError("Escrow lock only applies to native trades.")
        resolved_wallet_id = await self._resolve_seller_wallet_id(trade)
        if seller_wallet_id is not None and int(seller_wallet_id) != resolved_wallet_id:
            raise P2PError("Provided seller wallet does not match the trade's seller wallet.")
        tx_hash = await self.escrow.lock(
            seller_wallet_id=resolved_wallet_id,
            amount=trade.crypto_amount,
            chain=trade.crypto_chain,
        )
        return await self._update_trade(
            trade_id,
            status=P2PTradeStatus.ESCROW_LOCKED.value,
            escrow_lock_tx=tx_hash,
        )

    async def mark_fiat_sent(self, *, trade_id: int, payment_ref: Optional[str] = None) -> P2PTrade:
        return await self._update_trade(
            trade_id,
            status=P2PTradeStatus.FIAT_SENT.value,
            fiat_payment_ref=payment_ref,
        )

    @staticmethod
    def _resolve_payout(recorded: Optional[str], override: Optional[str], label: str) -> str:
        """Resolve a settlement address from the trade — never free-text operator input.

        The server-recorded address (captured at trade creation) is authoritative and
        mandatory: settlement fails closed if it is missing, so funds can never go to
        an unvalidated operator-supplied address. An operator override is permitted
        ONLY as a confirmation that must checksum-match the recorded address (guards
        typos / swapped args / a compromised admin redirecting funds).
        """
        from web3 import Web3

        def _norm(a: Optional[str]) -> Optional[str]:
            return Web3.to_checksum_address(a) if a and Web3.is_address(a) else None

        rec = _norm(recorded)
        if not rec:
            raise P2PError(
                f"No verified {label} address on record for this trade — cannot settle "
                f"automatically; resolve via dispute."
            )
        if override:
            ovr = _norm(override)
            if not ovr:
                raise P2PError(f"Invalid {label} address.")
            if ovr != rec:
                raise P2PError(
                    f"Provided {label} address does not match the recorded {label} "
                    f"address for this trade."
                )
        return rec

    async def release_escrow(
        self, *, trade_id: int, buyer_address: Optional[str] = None
    ) -> P2PTrade:
        trade = await self.get_trade(trade_id)
        if trade.source != P2PSource.NATIVE.value:
            raise P2PError("Escrow release only applies to native trades.")
        if not trade.escrow_lock_tx:
            raise P2PError("Escrow was never locked for this trade — nothing to release.")
        buyer_address = self._resolve_payout(trade.buyer_address, buyer_address, "buyer")
        # Atomic compare-and-set: only one caller can reserve the trade for release.
        # Guards against double-release (admin retry / two operators) draining the
        # omnibus escrow wallet. Reservation is keyed on escrow_release_tx being NULL,
        # so a recorded release can never be repeated; a transient on-chain failure
        # leaves the trade RELEASED-but-unrecorded and is safely retryable.
        if not await self._reserve_for_release(trade_id):
            raise P2PError(
                "Trade is not in a releasable state (already released, cancelled, "
                "or not yet escrowed)."
            )
        tx_hash = await self.escrow.release(
            buyer_address=buyer_address,
            amount=trade.crypto_amount,
            chain=trade.crypto_chain,
        )
        completed = await self._update_trade(
            trade_id,
            status=P2PTradeStatus.COMPLETED.value,
            escrow_release_tx=tx_hash,
            completed_at=datetime.utcnow(),
        )

        # Whole-product points: reward both legs of a completed native P2P trade.
        # Idempotent — release_escrow runs once per trade (status transitions to
        # COMPLETED). Trade value proxy = fiat_amount; this is exact when
        # fiat_currency == USD and an approximation otherwise (no FX conversion
        # here). No Suwappu platform fee is charged on native P2P, so fee_usd is
        # None and season accrual uses the volume-derived base. Points failures
        # must never break the on-chain escrow release.
        try:
            self._award_p2p_points(completed)
        except Exception as e:
            logger.debug("p2p_trade award skipped: %s", e)

        return completed

    @staticmethod
    def _award_p2p_points(trade: "P2PTrade") -> None:
        """Award p2p_trade points to both legs of a completed trade (best-effort)."""
        from bot.services.points_service import points_service

        try:
            value_usd = float(trade.fiat_amount or 0)
        except (TypeError, ValueError):
            value_usd = 0.0
        amount = max(1, int(value_usd / 10))
        metadata = {"amount_usd": value_usd, "fee_usd": None}

        for uid in {trade.taker_user_id, trade.maker_user_id}:
            if not uid:
                continue
            try:
                points_service.award_points(
                    user_id=int(uid),
                    action="p2p_trade",
                    amount=amount,
                    description=f"P2P trade completed (${value_usd:,.2f})",
                    metadata=metadata,
                )
            except Exception as e:
                logger.debug("p2p_trade award skipped for user %s: %s", uid, e)

    async def cancel_trade(
        self, *, trade_id: int, seller_address: Optional[str] = None
    ) -> P2PTrade:
        trade = await self.get_trade(trade_id)
        # A fiat-paid trade must not be unilaterally refunded — that would let a
        # buyer pay and a seller reclaim the crypto. Force the dispute path instead
        # of silently cancelling without a refund (and falsely reporting success).
        if (
            trade.source == P2PSource.NATIVE.value
            and trade.status == P2PTradeStatus.FIAT_SENT.value
        ):
            raise P2PError(
                "Buyer has marked fiat sent — resolve via dispute, not a unilateral refund."
            )
        # If crypto is still escrowed, atomically reserve the trade for cancellation
        # before refunding, so two concurrent refund attempts can't double-spend.
        if (
            trade.source == P2PSource.NATIVE.value
            and trade.status == P2PTradeStatus.ESCROW_LOCKED.value
        ):
            seller_address = self._resolve_payout(trade.seller_address, seller_address, "seller")
            if not await self._reserve_for_cancel(trade_id):
                raise P2PError("Trade is not in a refundable state (already settled or cancelled).")
            await self.escrow.refund(
                seller_address=seller_address,
                amount=trade.crypto_amount,
                chain=trade.crypto_chain,
            )
            return await self.get_trade(trade_id)
        return await self._update_trade(trade_id, status=P2PTradeStatus.CANCELLED.value)

    async def open_dispute(self, *, trade_id: int, reason: str) -> P2PTrade:
        return await self._update_trade(
            trade_id,
            status=P2PTradeStatus.DISPUTED.value,
            dispute_reason=reason,
            disputed_at=datetime.utcnow(),
        )

    # ── Reads ────────────────────────────────────────────────────────────────

    async def get_trade(self, trade_id: int) -> P2PTrade:
        def _get() -> Optional[P2PTrade]:
            with get_session() as session:
                trade = session.query(P2PTrade).filter(P2PTrade.id == trade_id).first()
                if trade:
                    session.expunge(trade)
                return trade

        trade = await run_in_db(_get)
        if not trade:
            raise P2PError(f"Trade {trade_id} not found.")
        return trade

    async def get_user_trades(self, *, user_id: int, limit: int = 20) -> list[P2PTrade]:
        def _list() -> list[P2PTrade]:
            with get_session() as session:
                rows = (
                    session.query(P2PTrade)
                    .filter(P2PTrade.taker_user_id == user_id)
                    .order_by(P2PTrade.created_at.desc())
                    .limit(limit)
                    .all()
                )
                for r in rows:
                    session.expunge(r)
                return rows

        return await run_in_db(_list)

    async def get_user_offers(self, *, user_id: int, limit: int = 20) -> list[P2POffer]:
        def _list() -> list[P2POffer]:
            with get_session() as session:
                rows = (
                    session.query(P2POffer)
                    .filter(P2POffer.maker_user_id == user_id)
                    .order_by(P2POffer.created_at.desc())
                    .limit(limit)
                    .all()
                )
                for r in rows:
                    session.expunge(r)
                return rows

        return await run_in_db(_list)

    async def _update_trade(self, trade_id: int, **fields) -> P2PTrade:
        def _update() -> Optional[P2PTrade]:
            with get_session() as session:
                trade = session.query(P2PTrade).filter(P2PTrade.id == trade_id).first()
                if not trade:
                    return None
                for k, v in fields.items():
                    setattr(trade, k, v)
                session.commit()
                session.refresh(trade)
                session.expunge(trade)
                return trade

        trade = await run_in_db(_update)
        if not trade:
            raise P2PError(f"Trade {trade_id} not found.")
        return trade

    async def _reserve_for_release(self, trade_id: int) -> bool:
        """Atomically move a native trade to RELEASED iff it is releasable.

        Single guarded UPDATE (compare-and-set) so concurrent/duplicate release
        attempts cannot each fire an on-chain transfer. Reservation requires the
        escrow to be locked and not already released; status RELEASED is included
        in the source set so a transiently-failed release (no tx recorded) stays
        retryable. Returns True iff this caller won the reservation.
        """

        def _reserve() -> bool:
            with get_session() as session:
                rows = (
                    session.query(P2PTrade)
                    .filter(
                        P2PTrade.id == trade_id,
                        P2PTrade.source == P2PSource.NATIVE.value,
                        P2PTrade.escrow_lock_tx.isnot(None),
                        P2PTrade.escrow_release_tx.is_(None),
                        P2PTrade.status.in_(
                            [
                                P2PTradeStatus.ESCROW_LOCKED.value,
                                P2PTradeStatus.FIAT_SENT.value,
                                P2PTradeStatus.RELEASED.value,
                            ]
                        ),
                    )
                    .update(
                        {P2PTrade.status: P2PTradeStatus.RELEASED.value},
                        synchronize_session=False,
                    )
                )
                session.commit()
                return rows > 0

        return await run_in_db(_reserve)

    async def _reserve_for_cancel(self, trade_id: int) -> bool:
        """Atomically move a locked native trade to CANCELLED iff still ESCROW_LOCKED.

        Compare-and-set guard so two concurrent refund attempts cannot both fire an
        on-chain refund. Returns True iff this caller won the reservation.
        """

        def _reserve() -> bool:
            with get_session() as session:
                rows = (
                    session.query(P2PTrade)
                    .filter(
                        P2PTrade.id == trade_id,
                        P2PTrade.source == P2PSource.NATIVE.value,
                        P2PTrade.status == P2PTradeStatus.ESCROW_LOCKED.value,
                    )
                    .update(
                        {P2PTrade.status: P2PTradeStatus.CANCELLED.value},
                        synchronize_session=False,
                    )
                )
                session.commit()
                return rows > 0

        return await run_in_db(_reserve)


# Module-level singleton (mirrors order_service / swap_engine convention).
p2p_service = P2PService()
