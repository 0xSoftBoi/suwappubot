"""Polymarket prediction markets flow for WhatsApp."""

import logging
from decimal import Decimal

from bot.services.whatsapp_flows.base import BaseWhatsAppFlow, FlowResponse
from bot.services.whatsapp_flows import register_flow
from bot.services.whatsapp_conversation import ConversationState

logger = logging.getLogger(__name__)

# ── helpers (mirror predict.py) ───────────────────────────────────────────────


def _truncate(text: str, max_len: int = 100) -> str:
    if len(text) <= max_len:
        return text
    return text[: max_len - 3] + "..."


def _fmt_vol(vol: float) -> str:
    if vol >= 1_000_000:
        return f"${vol / 1_000_000:.1f}M"
    if vol >= 1_000:
        return f"${vol / 1_000:.1f}K"
    return f"${vol:.0f}"


def _fmt_usdc(amount) -> str:
    if amount is None:
        return "$0.00"
    return f"${float(amount):,.2f}"


def _get_yes_token(market) -> dict | None:
    for t in market.tokens:
        if t.get("outcome", "").lower() == "yes":
            return t
    return None


def _get_no_token(market) -> dict | None:
    for t in market.tokens:
        if t.get("outcome", "").lower() == "no":
            return t
    return None


def _market_row(market, idx: int) -> dict:
    """Build a list_sections row for one market."""
    yes_pct = market.outcome_yes_price * 100
    no_pct = market.outcome_no_price * 100
    vol = _fmt_vol(market.volume_24hr)
    desc = f"YES {yes_pct:.0f}% / NO {no_pct:.0f}%  |  Vol: {vol}"
    return {
        "id": f"pred_detail_{idx}",
        "title": _truncate(market.question, 24),
        "description": desc,
    }


# ── flow ──────────────────────────────────────────────────────────────────────


class PredictFlow(BaseWhatsAppFlow):
    flow_name = "predict"
    trigger_commands = ["predict", "predictions", "/predict"]
    steps = {
        "show_menu": "_step_show_menu",
        "browse_markets": "_step_browse_markets",
        "market_detail": "_step_market_detail",
        "select_side": "_step_select_side",
        "enter_amount": "_step_enter_amount",
        "confirm_order": "_step_confirm_order",
        "show_positions": "_step_show_positions",
        "sell_confirm": "_step_sell_confirm",
        "show_history": "_step_show_history",
    }

    # ── entry point ───────────────────────────────────────────────────────────

    async def start(self, user_id: str, user_db_id: int, text: str = "") -> FlowResponse:
        await self._set_state(user_id, "show_menu", {"user_db_id": user_db_id})
        return FlowResponse(
            text=(
                "*Prediction Markets*\n\n"
                "Trade on real-world events via Polymarket.\n\n"
                "Choose an option:"
            ),
            header="Polymarket",
            footer="Powered by Polymarket on Polygon",
            buttons=[
                {"id": "pred_trending", "title": "Trending"},
                {"id": "pred_positions", "title": "My Positions"},
                {"id": "pred_search", "title": "Search"},
            ],
        )

    # ── step: show_menu ───────────────────────────────────────────────────────

    async def _step_show_menu(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        db_id = state.data.get("user_db_id") or user_db_id

        if text == "pred_trending":
            return await self._load_trending(user_id, db_id)

        if text == "pred_search":
            await self._update(
                user_id, "browse_markets", {"mode": "await_search", "user_db_id": db_id}
            )
            return FlowResponse(
                text="*Search Markets*\n\nType your search query (e.g. _bitcoin_, _election_, _AI_):",
                footer="Send a keyword to search",
            )

        if text == "pred_positions":
            return await self._build_positions(user_id, db_id)

        if text == "pred_history":
            return await self._build_history(user_id, db_id)

        # Unrecognised — re-show menu
        return FlowResponse(
            text="Choose an option:",
            buttons=[
                {"id": "pred_trending", "title": "Trending"},
                {"id": "pred_positions", "title": "My Positions"},
                {"id": "pred_search", "title": "Search"},
            ],
        )

    # ── step: browse_markets ──────────────────────────────────────────────────

    async def _step_browse_markets(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        db_id = state.data.get("user_db_id") or user_db_id
        mode = state.data.get("mode")

        # Market selected from list
        if text.startswith("pred_detail_"):
            try:
                idx = int(text.replace("pred_detail_", ""))
            except ValueError:
                idx = -1
            markets = state.data.get("markets", [])
            if idx < 0 or idx >= len(markets):
                return FlowResponse("Market not found. Try browsing again.")
            market = markets[idx]
            # Fetch orderbook for YES token
            orderbook_text = await self._orderbook_text(market)
            await self._update(
                user_id,
                "market_detail",
                {
                    "selected_market_idx": idx,
                    "selected_market": self._serialise_market(market),
                },
            )
            return self._build_market_detail(market, orderbook_text)

        # Pagination
        if text.startswith("pred_page_"):
            try:
                page = int(text.replace("pred_page_", ""))
            except ValueError:
                page = 0
            markets = state.data.get("markets", [])
            if not markets:
                return await self._load_trending(user_id, db_id)
            await self._update(user_id, "browse_markets", {"page": page})
            title = state.data.get("title", "Markets")
            return self._build_market_list(markets, page, title)

        # Back to main menu
        if text == "pred_menu":
            await self._update(user_id, "show_menu", {"user_db_id": db_id})
            return FlowResponse(
                text="Choose an option:",
                buttons=[
                    {"id": "pred_trending", "title": "Trending"},
                    {"id": "pred_positions", "title": "My Positions"},
                    {"id": "pred_search", "title": "Search"},
                ],
            )

        # Awaiting search query text-input
        if mode == "await_search":
            query = text.strip()
            if not query:
                return FlowResponse("Please type a keyword to search:")
            from bot.services.polymarket_api import polymarket_client

            markets = await polymarket_client.search_markets(query, limit=20)
            title = f'Search: "{_truncate(query, 20)}"'
            if not markets:
                return FlowResponse(
                    text=f"*{title}*\n\nNo markets found. Try a different keyword.",
                    buttons=[
                        {"id": "pred_search", "title": "Try Again"},
                        {"id": "pred_trending", "title": "Trending"},
                    ],
                )
            await self._update(
                user_id,
                "browse_markets",
                {
                    "mode": "list",
                    "markets": [self._serialise_market(m) for m in markets],
                    "title": title,
                    "page": 0,
                },
            )
            return self._build_market_list(markets, 0, title)

        # Fallback
        return await self._load_trending(user_id, db_id)

    # ── step: market_detail ───────────────────────────────────────────────────

    async def _step_market_detail(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        db_id = state.data.get("user_db_id") or user_db_id

        if text in ("pred_buy_yes", "pred_buy_no"):
            outcome = "Yes" if text == "pred_buy_yes" else "No"
            market_data = state.data.get("selected_market", {})
            from bot.services.polymarket_api import MarketInfo

            market = self._deserialise_market(market_data)
            price = market.outcome_yes_price if outcome == "Yes" else market.outcome_no_price
            await self._update(user_id, "select_side", {"outcome": outcome})
            return FlowResponse(
                text=(
                    f"*Buy {outcome}*\n\n"
                    f"Market: {_truncate(market.question)}\n"
                    f"Price: {price:.4f} USDC/share\n"
                    f"Payout: $1.00/share if {outcome} wins\n\n"
                    f"Select amount of USDC to spend:"
                ),
                list_button_text="Choose Amount",
                list_sections=[
                    {
                        "title": "Quick amounts",
                        "rows": [
                            {"id": "pred_amt_5", "title": "$5", "description": "Spend $5 USDC"},
                            {"id": "pred_amt_10", "title": "$10", "description": "Spend $10 USDC"},
                            {"id": "pred_amt_25", "title": "$25", "description": "Spend $25 USDC"},
                            {"id": "pred_amt_50", "title": "$50", "description": "Spend $50 USDC"},
                            {
                                "id": "pred_amt_custom",
                                "title": "Custom amount",
                                "description": "Type your own amount",
                            },
                        ],
                    }
                ],
            )

        if text == "pred_back_list":
            markets_raw = state.data.get("markets", [])
            page = state.data.get("page", 0)
            title = state.data.get("title", "Markets")
            if not markets_raw:
                return await self._load_trending(user_id, db_id)
            markets = [self._deserialise_market(m) for m in markets_raw]
            await self._update(user_id, "browse_markets", {})
            return self._build_market_list(markets, page, title)

        # Re-show detail
        market_data = state.data.get("selected_market", {})
        market = self._deserialise_market(market_data)
        orderbook_text = await self._orderbook_text(market)
        return self._build_market_detail(market, orderbook_text)

    # ── step: select_side (amount selection) ─────────────────────────────────

    async def _step_select_side(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        outcome = state.data.get("outcome", "Yes")
        market = self._deserialise_market(state.data.get("selected_market", {}))
        price = market.outcome_yes_price if outcome == "Yes" else market.outcome_no_price

        # Quick-select amounts
        quick_map = {
            "pred_amt_5": 5.0,
            "pred_amt_10": 10.0,
            "pred_amt_25": 25.0,
            "pred_amt_50": 50.0,
        }
        if text in quick_map:
            amount = quick_map[text]
            await self._update(user_id, "enter_amount", {"amount": amount})
            return self._build_confirmation(market, outcome, amount, price)

        if text == "pred_amt_custom":
            await self._update(user_id, "enter_amount", {"awaiting_custom": True})
            return FlowResponse(
                text=(
                    f"*Custom Amount*\n\n"
                    f"Buy {outcome} on: {_truncate(market.question, 60)}\n\n"
                    f"Enter the USDC amount (e.g. _15_ or _100.50_):"
                ),
            )

        # Fallback — re-show amounts
        return FlowResponse(
            text=f"Select USDC amount for Buy {outcome}:",
            list_button_text="Choose Amount",
            list_sections=[
                {
                    "title": "Quick amounts",
                    "rows": [
                        {"id": "pred_amt_5", "title": "$5", "description": "Spend $5 USDC"},
                        {"id": "pred_amt_10", "title": "$10", "description": "Spend $10 USDC"},
                        {"id": "pred_amt_25", "title": "$25", "description": "Spend $25 USDC"},
                        {"id": "pred_amt_50", "title": "$50", "description": "Spend $50 USDC"},
                        {
                            "id": "pred_amt_custom",
                            "title": "Custom amount",
                            "description": "Type your own amount",
                        },
                    ],
                }
            ],
        )

    # ── step: enter_amount (custom text input) ────────────────────────────────

    async def _step_enter_amount(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        outcome = state.data.get("outcome", "Yes")
        market = self._deserialise_market(state.data.get("selected_market", {}))
        price = market.outcome_yes_price if outcome == "Yes" else market.outcome_no_price

        # If a quick-amount button comes through at this step too
        quick_map = {
            "pred_amt_5": 5.0,
            "pred_amt_10": 10.0,
            "pred_amt_25": 25.0,
            "pred_amt_50": 50.0,
        }
        if text in quick_map:
            amount = quick_map[text]
            await self._update(user_id, "confirm_order", {"amount": amount})
            return self._build_confirmation(market, outcome, amount, price)

        # Parse custom amount from text
        awaiting = state.data.get("awaiting_custom", False)
        if awaiting or True:  # always attempt parse
            try:
                amount = float(text.replace("$", "").replace(",", "").strip())
                if amount <= 0:
                    raise ValueError("non-positive")
                if amount > 10_000:
                    return FlowResponse(
                        "Maximum order amount is $10,000 USDC. Please enter a smaller amount:"
                    )
            except ValueError:
                return FlowResponse(f"Invalid amount. Please enter a valid number (e.g. _25.00_):")
            await self._update(
                user_id, "confirm_order", {"amount": amount, "awaiting_custom": False}
            )
            return self._build_confirmation(market, outcome, amount, price)

    # ── step: confirm_order ───────────────────────────────────────────────────

    async def _step_confirm_order(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        if text in ("pred_cancel_order", "cancel", "no"):
            await self._clear(user_id)
            return FlowResponse("Order cancelled. Type *predict* to start over.")

        if text not in ("pred_confirm", "confirm", "yes"):
            outcome = state.data.get("outcome", "Yes")
            market = self._deserialise_market(state.data.get("selected_market", {}))
            amount = state.data.get("amount", 0)
            price = market.outcome_yes_price if outcome == "Yes" else market.outcome_no_price
            return self._build_confirmation(market, outcome, amount, price)

        # Execute order
        db_id = state.data.get("user_db_id") or user_db_id
        outcome = state.data.get("outcome", "Yes")
        market = self._deserialise_market(state.data.get("selected_market", {}))
        amount = float(state.data.get("amount", 0))
        price = market.outcome_yes_price if outcome == "Yes" else market.outcome_no_price

        token_data = _get_yes_token(market) if outcome == "Yes" else _get_no_token(market)
        token_id = token_data.get("token_id", "") if token_data else ""

        await self._clear(user_id)
        return await self._execute_buy(
            user_db_id=db_id,
            market=market,
            outcome=outcome,
            amount=amount,
            price=price,
            token_id=token_id,
        )

    # ── step: show_positions ──────────────────────────────────────────────────

    async def _step_show_positions(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        db_id = state.data.get("user_db_id") or user_db_id

        if text.startswith("pred_sell_"):
            try:
                pos_id = int(text.replace("pred_sell_", ""))
            except ValueError:
                return await self._build_positions(user_id, db_id)
            return await self._build_sell_prompt(user_id, db_id, pos_id)

        if text == "pred_history":
            return await self._build_history(user_id, db_id)

        if text == "pred_menu":
            await self._update(user_id, "show_menu", {"user_db_id": db_id})
            return FlowResponse(
                text="Choose an option:",
                buttons=[
                    {"id": "pred_trending", "title": "Trending"},
                    {"id": "pred_positions", "title": "My Positions"},
                    {"id": "pred_search", "title": "Search"},
                ],
            )

        # Refresh
        return await self._build_positions(user_id, db_id)

    # ── step: sell_confirm ────────────────────────────────────────────────────

    async def _step_sell_confirm(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        db_id = state.data.get("user_db_id") or user_db_id

        if text in ("pred_cancel_sell", "cancel"):
            return await self._build_positions(user_id, db_id)

        if text not in ("pred_confirm_sell", "confirm", "yes"):
            # Re-show sell confirmation
            pos_id = state.data.get("sell_position_id")
            if pos_id:
                return await self._build_sell_prompt(user_id, db_id, pos_id, reuse_state=state)
            return await self._build_positions(user_id, db_id)

        # Execute sell
        pos_id = state.data.get("sell_position_id")
        token_id = state.data.get("sell_token_id", "")
        shares = state.data.get("sell_shares", 0.0)
        sell_outcome = state.data.get("sell_outcome", "")
        sell_question = state.data.get("sell_market_question", "")
        wallet_id = state.data.get("wallet_id")

        await self._clear(user_id)
        return await self._execute_sell(
            user_db_id=db_id,
            pos_id=pos_id,
            token_id=token_id,
            shares=float(shares),
            sell_outcome=sell_outcome,
            sell_question=sell_question,
            wallet_id=wallet_id,
        )

    # ── step: show_history ────────────────────────────────────────────────────

    async def _step_show_history(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        db_id = state.data.get("user_db_id") or user_db_id

        if text == "pred_menu":
            await self._update(user_id, "show_menu", {"user_db_id": db_id})
            return FlowResponse(
                text="Choose an option:",
                buttons=[
                    {"id": "pred_trending", "title": "Trending"},
                    {"id": "pred_positions", "title": "My Positions"},
                    {"id": "pred_search", "title": "Search"},
                ],
            )

        return await self._build_history(user_id, db_id)

    # ── private helpers ───────────────────────────────────────────────────────

    async def _load_trending(self, user_id: str, db_id: int) -> FlowResponse:
        from bot.services.polymarket_api import polymarket_client

        markets = await polymarket_client.get_trending_markets(limit=20)
        if not markets:
            return FlowResponse(
                text="*Trending Markets*\n\nNo markets available right now. Try again later.",
                buttons=[
                    {"id": "pred_trending", "title": "Refresh"},
                    {"id": "pred_search", "title": "Search"},
                ],
            )
        await self._set_state(
            user_id,
            "browse_markets",
            {
                "user_db_id": db_id,
                "mode": "list",
                "markets": [self._serialise_market(m) for m in markets],
                "title": "Trending Markets",
                "page": 0,
            },
        )
        return self._build_market_list(markets, 0, "Trending Markets")

    def _build_market_list(self, markets, page: int, title: str) -> FlowResponse:
        per_page = 10  # WhatsApp list supports up to 10 rows per section
        start = page * per_page
        end = start + per_page
        page_markets = markets[start:end]

        rows = [_market_row(m, start + i) for i, m in enumerate(page_markets)]

        nav_rows = []
        if page > 0:
            nav_rows.append(
                {"id": f"pred_page_{page - 1}", "title": "Previous page", "description": ""}
            )
        if end < len(markets):
            nav_rows.append(
                {"id": f"pred_page_{page + 1}", "title": "Next page", "description": ""}
            )
        nav_rows.append({"id": "pred_menu", "title": "Back to menu", "description": ""})

        sections = [{"title": f"{title} (page {page + 1})", "rows": rows}]
        if nav_rows:
            sections.append({"title": "Navigation", "rows": nav_rows})

        total_pages = max(1, (len(markets) - 1) // per_page + 1)
        return FlowResponse(
            text=f"*{title}*\n\nShowing {len(page_markets)} of {len(markets)} markets. Tap to view details.",
            list_button_text="Browse Markets",
            list_sections=sections,
            footer=f"Page {page + 1} of {total_pages}",
        )

    async def _orderbook_text(self, market) -> str:
        from bot.services.polymarket_api import polymarket_client

        yes_token = _get_yes_token(market)
        if not yes_token:
            return ""
        token_id = yes_token.get("token_id", "")
        if not token_id:
            return ""
        ob = await polymarket_client.get_orderbook(token_id)
        if not ob:
            return ""
        return (
            f"\nOrderbook (YES): Bid {ob.best_bid:.4f} / Ask {ob.best_ask:.4f}"
            f" | Spread {ob.spread:.4f}"
        )

    def _build_market_detail(self, market, orderbook_text: str = "") -> FlowResponse:
        yes_pct = market.outcome_yes_price * 100
        no_pct = market.outcome_no_price * 100

        text = (
            f"*{_truncate(market.question, 200)}*\n\n"
            f"YES {yes_pct:.1f}%  |  NO {no_pct:.1f}%\n\n"
            f"Vol (24h): {_fmt_vol(market.volume_24hr)}\n"
            f"Total Vol: {_fmt_vol(market.volume_total)}\n"
            f"Liquidity: {_fmt_vol(market.liquidity)}\n"
        )
        if market.end_date:
            text += f"Ends: {market.end_date[:10]}\n"
        if market.category:
            text += f"Category: {market.category}\n"
        if orderbook_text:
            text += orderbook_text
        text += "\n\nSelect an action:"

        return FlowResponse(
            text=text,
            buttons=[
                {"id": "pred_buy_yes", "title": "Buy YES"},
                {"id": "pred_buy_no", "title": "Buy NO"},
                {"id": "pred_back_list", "title": "Back to List"},
            ],
        )

    def _build_confirmation(
        self, market, outcome: str, amount: float, price: float
    ) -> FlowResponse:
        shares = amount / price if price > 0 else 0
        potential_payout = shares * 1.0
        profit = potential_payout - amount
        profit_pct = (profit / amount * 100) if amount > 0 else 0

        return FlowResponse(
            text=(
                f"*Confirm Order*\n\n"
                f"Market: {_truncate(market.question)}\n"
                f"Side: BUY {outcome.upper()}\n"
                f"Amount: {_fmt_usdc(amount)}\n"
                f"Price: {price:.4f} USDC/share\n"
                f"Est. Shares: {shares:.2f}\n\n"
                f"Potential Payout: {_fmt_usdc(potential_payout)}\n"
                f"Potential Profit: {_fmt_usdc(profit)} ({profit_pct:.0f}%)\n\n"
                f"_Order will be placed on Polymarket via Polygon._"
            ),
            header="Confirm Order",
            buttons=[
                {"id": "pred_confirm", "title": "Confirm"},
                {"id": "pred_cancel_order", "title": "Cancel"},
            ],
        )

    async def _execute_buy(
        self,
        user_db_id: int,
        market,
        outcome: str,
        amount: float,
        price: float,
        token_id: str,
    ) -> FlowResponse:
        from bot.services.polymarket_api import polymarket_client
        from bot.services.wallet import WalletService
        from bot.models.user import Wallet
        from bot.models.predict import PredictionOrder, PredictionPosition
        from database.db import get_session

        wallet_service = WalletService()

        # Find default EVM wallet
        with get_session() as session:
            wallet = (
                session.query(Wallet)
                .filter(
                    Wallet.user_id == user_db_id,
                    Wallet.chain_type == "evm",
                    Wallet.is_default == True,
                )
                .first()
            )
            if not wallet:
                return FlowResponse(
                    "You need an EVM wallet to trade on prediction markets.\n"
                    "Use *wallet* to create one."
                )
            wallet_id = wallet.id
            is_turnkey = wallet.is_turnkey_wallet

            # Create pending order
            order = PredictionOrder(
                user_id=user_db_id,
                wallet_id=wallet_id,
                market_id=market.condition_id,
                market_question=market.question,
                token_id=token_id,
                outcome=outcome,
                side="BUY",
                amount_usdc=Decimal(str(amount)),
                price=Decimal(str(price)),
                status="pending",
            )
            session.add(order)
            session.commit()
            order_id = order.id

        try:
            with get_session() as session:
                w = session.query(Wallet).filter(Wallet.id == wallet_id).first()
                if not w:
                    raise Exception("Wallet not found")
                private_key = (
                    wallet_service.get_backup_private_key(w)
                    if is_turnkey
                    else wallet_service.get_private_key(w)
                )

            result = await polymarket_client.place_order(
                private_key=private_key,
                token_id=token_id,
                side="BUY",
                amount=amount,
                price=price,
            )

            shares = amount / price if price > 0 else 0

            with get_session() as session:
                db_order = (
                    session.query(PredictionOrder).filter(PredictionOrder.id == order_id).first()
                )
                if db_order:
                    if result.success:
                        db_order.status = "placed"
                        db_order.clob_order_id = result.order_id
                        db_order.shares = Decimal(str(shares))

                        # Upsert position
                        pos = (
                            session.query(PredictionPosition)
                            .filter(
                                PredictionPosition.user_id == user_db_id,
                                PredictionPosition.market_id == market.condition_id,
                                PredictionPosition.token_id == token_id,
                            )
                            .first()
                        )
                        if pos:
                            old_total = float(pos.total_cost_usdc or 0)
                            old_shares = float(pos.total_shares or 0)
                            new_total = old_total + amount
                            new_shares = old_shares + shares
                            pos.total_shares = Decimal(str(new_shares))
                            pos.total_cost_usdc = Decimal(str(new_total))
                            pos.avg_entry_price = (
                                Decimal(str(new_total / new_shares))
                                if new_shares > 0
                                else Decimal("0")
                            )
                            pos.current_price = Decimal(str(price))
                        else:
                            pos = PredictionPosition(
                                user_id=user_db_id,
                                market_id=market.condition_id,
                                market_question=market.question,
                                token_id=token_id,
                                outcome=outcome,
                                total_shares=Decimal(str(shares)),
                                avg_entry_price=Decimal(str(price)),
                                total_cost_usdc=Decimal(str(amount)),
                                current_price=Decimal(str(price)),
                            )
                            session.add(pos)
                    else:
                        db_order.status = "failed"
                        db_order.error_message = result.error
                    session.commit()

            if result.success:
                return FlowResponse(
                    text=(
                        f"*Order Placed!*\n\n"
                        f"Market: {_truncate(market.question)}\n"
                        f"Side: BUY {outcome.upper()}\n"
                        f"Amount: {_fmt_usdc(amount)}\n"
                        f"Shares: {shares:.2f}\n"
                        f"Potential Payout: {_fmt_usdc(shares)}\n\n"
                        f"Order ID: {result.order_id[:16]}...\n\n"
                        f"Type *predict* to view your positions."
                    ),
                )
            else:
                return FlowResponse(
                    text=(
                        f"*Order Failed*\n\n"
                        f"Error: {result.error}\n\n"
                        f"Your funds have not been spent. Type *predict* to try again."
                    ),
                )

        except Exception as exc:
            logger.error(f"PredictFlow _execute_buy error: {exc}")
            with get_session() as session:
                db_order = (
                    session.query(PredictionOrder).filter(PredictionOrder.id == order_id).first()
                )
                if db_order:
                    db_order.status = "failed"
                    db_order.error_message = str(exc)
                    session.commit()
            return FlowResponse(
                "Order failed due to an unexpected error. Type *predict* to try again."
            )

    async def _build_positions(self, user_id: str, db_id: int) -> FlowResponse:
        from bot.models.predict import PredictionPosition
        from database.db import get_session

        with get_session() as session:
            positions = (
                session.query(PredictionPosition)
                .filter(
                    PredictionPosition.user_id == db_id,
                    PredictionPosition.total_shares > 0,
                    PredictionPosition.is_resolved == False,
                )
                .order_by(PredictionPosition.created_at.desc())
                .limit(10)
                .all()
            )

            if not positions:
                await self._set_state(user_id, "show_positions", {"user_db_id": db_id})
                return FlowResponse(
                    text="*My Positions*\n\nNo open positions. Browse markets to place your first prediction!",
                    buttons=[
                        {"id": "pred_trending", "title": "Trending"},
                        {"id": "pred_menu", "title": "Main Menu"},
                    ],
                )

            text = "*My Positions*\n\n"
            total_value = 0.0
            total_pnl = 0.0
            rows = []

            for pos in positions:
                shares = float(pos.total_shares or 0)
                cost = float(pos.total_cost_usdc or 0)
                current = float(pos.current_price or 0)
                value = shares * current
                pnl = value - cost
                pnl_pct = (pnl / cost * 100) if cost > 0 else 0
                total_value += value
                total_pnl += pnl

                direction = "+" if pnl >= 0 else ""
                rows.append(
                    {
                        "id": f"pred_sell_{pos.id}",
                        "title": _truncate(pos.market_question or "Unknown", 24),
                        "description": (
                            f"{pos.outcome} | {shares:.2f} shares | "
                            f"{_fmt_usdc(value)} ({direction}{pnl_pct:.1f}%)"
                        ),
                    }
                )

            text += (
                f"Total Value: {_fmt_usdc(total_value)}\n"
                f"Unrealized PnL: {_fmt_usdc(total_pnl)}\n\n"
                f"Tap a position to sell:"
            )

            await self._set_state(user_id, "show_positions", {"user_db_id": db_id})
            return FlowResponse(
                text=text,
                list_button_text="My Positions",
                list_sections=[
                    {"title": "Open Positions", "rows": rows},
                    {
                        "title": "Actions",
                        "rows": [
                            {"id": "pred_history", "title": "View History", "description": ""},
                            {"id": "pred_menu", "title": "Main Menu", "description": ""},
                        ],
                    },
                ],
            )

    async def _build_sell_prompt(
        self, user_id: str, db_id: int, pos_id: int, reuse_state: ConversationState = None
    ) -> FlowResponse:
        from bot.models.predict import PredictionPosition
        from database.db import get_session

        if reuse_state and reuse_state.data.get("sell_position_id") == pos_id:
            # Use cached values
            shares = float(reuse_state.data.get("sell_shares", 0))
            current_price = 0.5
            token_id = reuse_state.data.get("sell_token_id", "")
            sell_outcome = reuse_state.data.get("sell_outcome", "")
            sell_question = reuse_state.data.get("sell_market_question", "")
            wallet_id = reuse_state.data.get("wallet_id")
        else:
            with get_session() as session:
                pos = (
                    session.query(PredictionPosition)
                    .filter(
                        PredictionPosition.id == pos_id,
                        PredictionPosition.user_id == db_id,
                    )
                    .first()
                )
                if not pos:
                    return FlowResponse(
                        "Position not found. Type *predict* to view your positions."
                    )
                shares = float(pos.total_shares or 0)
                current_price = float(pos.current_price or 0)
                token_id = pos.token_id
                sell_outcome = pos.outcome
                sell_question = pos.market_question or ""
                wallet_id = None

            await self._set_state(
                user_id,
                "sell_confirm",
                {
                    "user_db_id": db_id,
                    "sell_position_id": pos_id,
                    "sell_shares": shares,
                    "sell_token_id": token_id,
                    "sell_outcome": sell_outcome,
                    "sell_market_question": sell_question,
                    "wallet_id": wallet_id,
                },
            )

        value = shares * (current_price if current_price else 0.5)
        return FlowResponse(
            text=(
                f"*Sell Position*\n\n"
                f"Market: {_truncate(sell_question, 100)}\n"
                f"Outcome: {sell_outcome}\n"
                f"Shares: {shares:.2f}\n"
                f"Current Price: {current_price:.4f}\n"
                f"Est. Proceeds: {_fmt_usdc(value)}\n\n"
                f"Confirm to sell all shares at market price."
            ),
            buttons=[
                {"id": "pred_confirm_sell", "title": "Sell"},
                {"id": "pred_cancel_sell", "title": "Cancel"},
            ],
        )

    async def _execute_sell(
        self,
        user_db_id: int,
        pos_id: int,
        token_id: str,
        shares: float,
        sell_outcome: str,
        sell_question: str,
        wallet_id,
    ) -> FlowResponse:
        from bot.services.polymarket_api import polymarket_client
        from bot.services.wallet import WalletService
        from bot.models.user import Wallet
        from bot.models.predict import PredictionOrder, PredictionPosition
        from database.db import get_session

        wallet_service = WalletService()

        try:
            # Resolve wallet
            with get_session() as session:
                if wallet_id:
                    w = (
                        session.query(Wallet)
                        .filter(
                            Wallet.id == wallet_id,
                            Wallet.user_id == user_db_id,
                        )
                        .first()
                    )
                else:
                    w = (
                        session.query(Wallet)
                        .filter(
                            Wallet.user_id == user_db_id,
                            Wallet.chain_type == "evm",
                            Wallet.is_default == True,
                        )
                        .first()
                    )
                if not w:
                    raise Exception("Wallet not found")
                private_key = (
                    wallet_service.get_backup_private_key(w)
                    if w.is_turnkey_wallet
                    else wallet_service.get_private_key(w)
                )
                wid = w.id

            midpoint = await polymarket_client.get_midpoint(token_id)
            price = midpoint if midpoint else 0.5

            result = await polymarket_client.place_order(
                private_key=private_key,
                token_id=token_id,
                side="SELL",
                amount=shares,
                price=price,
            )

            if result.success:
                with get_session() as session:
                    sell_order = PredictionOrder(
                        user_id=user_db_id,
                        wallet_id=wid,
                        market_id="",
                        token_id=token_id,
                        outcome=sell_outcome,
                        side="SELL",
                        shares=Decimal(str(shares)),
                        price=Decimal(str(price)),
                        amount_usdc=Decimal(str(shares * price)),
                        status="placed",
                        clob_order_id=result.order_id,
                        market_question=sell_question,
                    )
                    session.add(sell_order)
                    pos = (
                        session.query(PredictionPosition)
                        .filter(PredictionPosition.id == pos_id)
                        .first()
                    )
                    if pos:
                        pos.total_shares = Decimal("0")
                    session.commit()

                return FlowResponse(
                    text=(
                        f"*Position Sold!*\n\n"
                        f"Sold {shares:.2f} shares at ~{price:.4f}\n"
                        f"Est. Proceeds: {_fmt_usdc(shares * price)}\n\n"
                        f"Type *predict* to continue trading."
                    ),
                )
            else:
                return FlowResponse(
                    text=f"*Sell Failed*\n\nError: {result.error}\n\nType *predict* to try again."
                )

        except Exception as exc:
            logger.error(f"PredictFlow _execute_sell error: {exc}")
            return FlowResponse(
                "Sell failed due to an unexpected error. Type *predict* to try again."
            )

    async def _build_history(self, user_id: str, db_id: int) -> FlowResponse:
        from bot.models.predict import PredictionOrder
        from database.db import get_session

        with get_session() as session:
            orders = (
                session.query(PredictionOrder)
                .filter(PredictionOrder.user_id == db_id)
                .order_by(PredictionOrder.created_at.desc())
                .limit(15)
                .all()
            )

            if not orders:
                await self._set_state(user_id, "show_history", {"user_db_id": db_id})
                return FlowResponse(
                    text="*Order History*\n\nNo orders yet. Place your first prediction!",
                    buttons=[
                        {"id": "pred_trending", "title": "Trending"},
                        {"id": "pred_menu", "title": "Main Menu"},
                    ],
                )

            STATUS_ICON = {
                "pending": "[~]",
                "placed": "[o]",
                "filled": "[v]",
                "cancelled": "[-]",
                "failed": "[x]",
            }

            lines = []
            for order in orders:
                icon = STATUS_ICON.get(order.status, "[?]")
                amount_str = _fmt_usdc(order.amount_usdc) if order.amount_usdc else "N/A"
                date_str = order.created_at.strftime("%m/%d %H:%M") if order.created_at else ""
                lines.append(
                    f"{icon} {order.side} {order.outcome} | {amount_str} | {order.status}\n"
                    f"  {_truncate(order.market_question or '', 50)} | {date_str}"
                )

            await self._set_state(user_id, "show_history", {"user_db_id": db_id})
            return FlowResponse(
                text="*Order History*\n\n" + "\n\n".join(lines),
                buttons=[
                    {"id": "pred_trending", "title": "Trending"},
                    {"id": "pred_menu", "title": "Main Menu"},
                ],
            )

    # ── market serialisation helpers ──────────────────────────────────────────
    # ConversationState.data only holds plain dicts/lists; MarketInfo dataclasses
    # must be converted to/from dicts for storage.

    @staticmethod
    def _serialise_market(market) -> dict:
        return {
            "condition_id": market.condition_id,
            "question": market.question,
            "description": market.description,
            "outcome_yes_price": market.outcome_yes_price,
            "outcome_no_price": market.outcome_no_price,
            "volume_24hr": market.volume_24hr,
            "volume_total": market.volume_total,
            "liquidity": market.liquidity,
            "end_date": market.end_date,
            "active": market.active,
            "closed": market.closed,
            "tokens": market.tokens,
            "image": market.image,
            "category": market.category,
        }

    @staticmethod
    def _deserialise_market(data: dict):
        from bot.services.polymarket_api import MarketInfo

        return MarketInfo(
            condition_id=data.get("condition_id", ""),
            question=data.get("question", ""),
            description=data.get("description", ""),
            outcome_yes_price=float(data.get("outcome_yes_price", 0)),
            outcome_no_price=float(data.get("outcome_no_price", 0)),
            volume_24hr=float(data.get("volume_24hr", 0)),
            volume_total=float(data.get("volume_total", 0)),
            liquidity=float(data.get("liquidity", 0)),
            end_date=data.get("end_date", ""),
            active=data.get("active", True),
            closed=data.get("closed", False),
            tokens=data.get("tokens", []),
            image=data.get("image", ""),
            category=data.get("category", ""),
        )


# ── self-register ─────────────────────────────────────────────────────────────
_flow = PredictFlow()
register_flow("predict", _flow)
