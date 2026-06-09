"""Favorites swap pairs flow for WhatsApp."""

import logging
from datetime import datetime, timezone

from bot.services.whatsapp_flows.base import BaseWhatsAppFlow, FlowResponse
from bot.services.whatsapp_flows import register_flow
from bot.services.whatsapp_conversation import ConversationState
from bot.models.favorites import FavoriteSwapPair
from database.db import get_session

logger = logging.getLogger(__name__)

# Maximum favorites to display
_MAX_FAVORITES = 10


class FavoritesFlow(BaseWhatsAppFlow):
    flow_name = "favorites"
    trigger_commands = ["favorites", "fav", "/f"]
    steps = {
        "show_menu": "_step_show_menu",
        "select_action": "_step_select_action",
        "confirm_delete": "_step_confirm_delete",
        "enter_amount": "_step_enter_amount",
        "add_from_chain": "_step_add_from_chain",
        "add_from_token": "_step_add_from_token",
        "add_to_chain": "_step_add_to_chain",
        "add_to_token": "_step_add_to_token",
        "add_name": "_step_add_name",
    }

    # -------------------------------------------------------------------------
    # Entry point
    # -------------------------------------------------------------------------

    async def start(self, user_id: str, user_db_id: int, text: str = "") -> FlowResponse:
        favorites = self._load_favorites(user_db_id)

        if not favorites:
            await self._set_state(
                user_id, "show_menu", {"user_db_id": user_db_id, "has_favorites": False}
            )
            return FlowResponse(
                text=(
                    "*Favorite Pairs*\n\n"
                    "You have no saved favorites yet.\n\n"
                    "Save a swap pair as a favorite after completing a swap, "
                    "or add one manually now."
                ),
                header="Favorites",
                buttons=[
                    {"id": "fav_add", "title": "Add Favorite"},
                ],
            )

        await self._set_state(
            user_id, "show_menu", {"user_db_id": user_db_id, "has_favorites": True}
        )
        return self._build_favorites_list(favorites)

    # -------------------------------------------------------------------------
    # Step: show_menu — top-level dispatch after list is shown
    # -------------------------------------------------------------------------

    async def _step_show_menu(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        db_id = state.data.get("user_db_id") or user_db_id

        if text == "fav_add":
            # Start add flow — pick from_chain
            await self._update(user_id, "add_from_chain", {"user_db_id": db_id})
            return self._build_chain_list("From which chain?", "fc")

        if text.startswith("fav_use_"):
            fav_id = self._parse_id(text, "fav_use_")
            if fav_id is None:
                return self._build_favorites_list(self._load_favorites(db_id))
            return await self._handle_use(user_id, db_id, fav_id)

        if text.startswith("fav_del_"):
            fav_id = self._parse_id(text, "fav_del_")
            if fav_id is None:
                return self._build_favorites_list(self._load_favorites(db_id))
            await self._update(user_id, "confirm_delete", {"user_db_id": db_id, "fav_id": fav_id})
            fav = self._get_favorite(db_id, fav_id)
            name = fav["display_name"] if fav else f"#{fav_id}"
            return FlowResponse(
                text=f"Delete *{name}*?\n\nThis cannot be undone.",
                buttons=[
                    {"id": "del_confirm", "title": "Delete"},
                    {"id": "del_cancel", "title": "Keep it"},
                ],
            )

        if text == "fav_more":
            # Show full list via list_sections
            favorites = self._load_favorites(db_id)
            return self._build_favorites_list_full(favorites)

        # Fallback: re-render list
        favorites = self._load_favorites(db_id)
        if not favorites:
            return FlowResponse(
                text="No favorites yet. Add one to get started.",
                buttons=[{"id": "fav_add", "title": "Add Favorite"}],
            )
        return self._build_favorites_list(favorites)

    # -------------------------------------------------------------------------
    # Step: select_action — used when arriving from the full list (list_sections)
    # -------------------------------------------------------------------------

    async def _step_select_action(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        db_id = state.data.get("user_db_id") or user_db_id

        if text.startswith("fav_use_"):
            fav_id = self._parse_id(text, "fav_use_")
            if fav_id is None:
                return self._build_favorites_list(self._load_favorites(db_id))
            return await self._handle_use(user_id, db_id, fav_id)

        if text.startswith("fav_del_"):
            fav_id = self._parse_id(text, "fav_del_")
            if fav_id is None:
                return self._build_favorites_list(self._load_favorites(db_id))
            await self._update(user_id, "confirm_delete", {"user_db_id": db_id, "fav_id": fav_id})
            fav = self._get_favorite(db_id, fav_id)
            name = fav["display_name"] if fav else f"#{fav_id}"
            return FlowResponse(
                text=f"Delete *{name}*?\n\nThis cannot be undone.",
                buttons=[
                    {"id": "del_confirm", "title": "Delete"},
                    {"id": "del_cancel", "title": "Keep it"},
                ],
            )

        # Unknown selection — re-render
        return self._build_favorites_list(self._load_favorites(db_id))

    # -------------------------------------------------------------------------
    # Step: confirm_delete
    # -------------------------------------------------------------------------

    async def _step_confirm_delete(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        db_id = state.data.get("user_db_id") or user_db_id

        if text == "del_cancel":
            favorites = self._load_favorites(db_id)
            await self._update(user_id, "show_menu", {"user_db_id": db_id})
            return self._build_favorites_list(favorites)

        if text == "del_confirm":
            fav_id = state.data.get("fav_id")
            deleted_name = self._delete_favorite(db_id, fav_id)
            favorites = self._load_favorites(db_id)
            await self._update(user_id, "show_menu", {"user_db_id": db_id})
            if favorites:
                return FlowResponse(
                    text=f"*{deleted_name}* removed.\n\n" + self._format_list_text(favorites),
                    list_button_text="Actions",
                    list_sections=self._build_list_sections(favorites),
                )
            return FlowResponse(
                text=f"*{deleted_name}* removed.\n\nNo favorites left.",
                buttons=[{"id": "fav_add", "title": "Add Favorite"}],
            )

        return FlowResponse(
            text="Delete this favorite?",
            buttons=[
                {"id": "del_confirm", "title": "Delete"},
                {"id": "del_cancel", "title": "Keep it"},
            ],
        )

    # -------------------------------------------------------------------------
    # Step: enter_amount — after user picks "use" and presses proceed
    # -------------------------------------------------------------------------

    async def _step_enter_amount(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        data = state.data
        db_id = data.get("user_db_id") or user_db_id
        fav = data.get("fav")

        if text == "amt_skip":
            # Use default_amount if available
            amount = fav.get("default_amount") if fav else None
            if amount:
                await self._clear(user_id)
                return self._build_use_result(fav, amount)
            # No default — ask for amount
            return FlowResponse(text=f"Enter the amount of *{fav.get('from_token', '?')}* to swap:")

        try:
            amount = float(text.replace(",", "").strip())
            if amount <= 0:
                raise ValueError
        except ValueError:
            return FlowResponse(
                text=f"Please enter a valid positive amount of *{fav.get('from_token', '?')}*:"
            )

        await self._clear(user_id)
        # Increment use_count in DB
        if fav and fav.get("id"):
            self._increment_use_count(db_id, fav["id"])
        return self._build_use_result(fav, amount)

    # -------------------------------------------------------------------------
    # Add flow: chain / token selection steps
    # -------------------------------------------------------------------------

    async def _step_add_from_chain(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        db_id = state.data.get("user_db_id") or user_db_id
        chain = text.replace("fc_", "").upper()
        if not chain or chain == text.upper():
            return self._build_chain_list("From which chain?", "fc")

        await self._update(user_id, "add_from_token", {"user_db_id": db_id, "from_chain": chain})
        return FlowResponse(
            text=f"From chain: *{chain}*\n\nEnter the token symbol to swap FROM (e.g. `SOL`, `ETH`, `USDC`):"
        )

    async def _step_add_from_token(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        db_id = state.data.get("user_db_id") or user_db_id
        token = text.strip().upper()
        if not token:
            return FlowResponse("Enter the token symbol to swap FROM (e.g. `SOL`):")

        await self._update(user_id, "add_to_chain", {"user_db_id": db_id, "from_token": token})
        return self._build_chain_list(f"From *{token}* — to which chain?", "tc")

    async def _step_add_to_chain(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        db_id = state.data.get("user_db_id") or user_db_id
        chain = text.replace("tc_", "").upper()
        if not chain or chain == text.upper():
            return self._build_chain_list("To which chain?", "tc")

        await self._update(user_id, "add_to_token", {"user_db_id": db_id, "to_chain": chain})
        from_token = state.data.get("from_token", "?")
        return FlowResponse(
            text=(
                f"To chain: *{chain}*\n\n"
                f"Enter the token symbol to swap TO (e.g. `USDC`, `BTC`):"
            )
        )

    async def _step_add_to_token(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        db_id = state.data.get("user_db_id") or user_db_id
        token = text.strip().upper()
        if not token:
            return FlowResponse("Enter the token symbol to swap TO (e.g. `USDC`):")

        await self._update(user_id, "add_name", {"user_db_id": db_id, "to_token": token})
        data = state.data
        pair = f"{data.get('from_token', '?')}→{token}"
        return FlowResponse(
            text=(
                f"Pair: *{data.get('from_chain','?')}/{data.get('from_token','?')}* "
                f"→ *{data.get('to_chain','?')}/{token}*\n\n"
                f"Give this favorite a name, or tap *Skip* to use `{pair}`:"
            ),
            buttons=[{"id": "name_skip", "title": "Skip"}],
        )

    async def _step_add_name(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        db_id = state.data.get("user_db_id") or user_db_id
        data = state.data

        if text == "name_skip":
            name = None
        else:
            name = text.strip()[:100] or None

        # Save to DB
        saved = self._save_favorite(
            user_db_id=db_id,
            from_chain=data.get("from_chain", ""),
            from_token=data.get("from_token", ""),
            to_chain=data.get("to_chain", ""),
            to_token=data.get("to_token", ""),
            name=name,
        )
        await self._clear(user_id)

        display = name or f"{data.get('from_token','?')}→{data.get('to_token','?')}"
        return FlowResponse(
            text=(
                f"*{display}* saved to favorites!\n\n"
                f"{data.get('from_chain','?')}/{data.get('from_token','?')} "
                f"→ {data.get('to_chain','?')}/{data.get('to_token','?')}\n\n"
                f"Type *favorites* to view your saved pairs."
            )
        )

    # -------------------------------------------------------------------------
    # Internal helpers
    # -------------------------------------------------------------------------

    def _load_favorites(self, user_db_id: int) -> list:
        """Load favorites from DB and return as plain dicts."""
        try:
            with get_session() as session:
                rows = (
                    session.query(FavoriteSwapPair)
                    .filter(FavoriteSwapPair.user_id == user_db_id)
                    .order_by(FavoriteSwapPair.use_count.desc())
                    .limit(_MAX_FAVORITES)
                    .all()
                )
                return [
                    {
                        "id": r.id,
                        "display_name": r.display_name,
                        "from_chain": r.from_chain,
                        "from_token": r.from_token,
                        "to_chain": r.to_chain,
                        "to_token": r.to_token,
                        "default_amount": r.default_amount,
                        "use_count": r.use_count,
                    }
                    for r in rows
                ]
        except Exception:
            logger.exception("Failed to load favorites for user %s", user_db_id)
            return []

    def _get_favorite(self, user_db_id: int, fav_id: int) -> dict | None:
        try:
            with get_session() as session:
                r = (
                    session.query(FavoriteSwapPair)
                    .filter(
                        FavoriteSwapPair.id == fav_id,
                        FavoriteSwapPair.user_id == user_db_id,
                    )
                    .first()
                )
                if r is None:
                    return None
                return {
                    "id": r.id,
                    "display_name": r.display_name,
                    "from_chain": r.from_chain,
                    "from_token": r.from_token,
                    "to_chain": r.to_chain,
                    "to_token": r.to_token,
                    "default_amount": r.default_amount,
                    "use_count": r.use_count,
                }
        except Exception:
            logger.exception("Failed to get favorite %s for user %s", fav_id, user_db_id)
            return None

    def _delete_favorite(self, user_db_id: int, fav_id: int) -> str:
        """Delete a favorite and return its display name."""
        name = f"#{fav_id}"
        try:
            with get_session() as session:
                r = (
                    session.query(FavoriteSwapPair)
                    .filter(
                        FavoriteSwapPair.id == fav_id,
                        FavoriteSwapPair.user_id == user_db_id,
                    )
                    .first()
                )
                if r:
                    name = r.display_name
                    session.delete(r)
        except Exception:
            logger.exception("Failed to delete favorite %s for user %s", fav_id, user_db_id)
        return name

    def _save_favorite(
        self,
        user_db_id: int,
        from_chain: str,
        from_token: str,
        to_chain: str,
        to_token: str,
        name: str | None = None,
    ) -> dict | None:
        try:
            with get_session() as session:
                fav = FavoriteSwapPair(
                    user_id=user_db_id,
                    from_chain=from_chain,
                    from_token=from_token,
                    to_chain=to_chain,
                    to_token=to_token,
                    name=name,
                    use_count=0,
                )
                session.add(fav)
                session.flush()
                return {
                    "id": fav.id,
                    "display_name": fav.display_name,
                }
        except Exception:
            logger.exception("Failed to save favorite for user %s", user_db_id)
            return None

    def _increment_use_count(self, user_db_id: int, fav_id: int) -> None:
        try:
            with get_session() as session:
                r = (
                    session.query(FavoriteSwapPair)
                    .filter(
                        FavoriteSwapPair.id == fav_id,
                        FavoriteSwapPair.user_id == user_db_id,
                    )
                    .first()
                )
                if r:
                    r.use_count = (r.use_count or 0) + 1
                    r.last_used_at = datetime.now(timezone.utc)
        except Exception:
            logger.exception("Failed to increment use_count for favorite %s", fav_id)

    # ---- "use" a favorite ----

    async def _handle_use(self, user_id: str, user_db_id: int, fav_id: int) -> FlowResponse:
        fav = self._get_favorite(user_db_id, fav_id)
        if not fav:
            return FlowResponse(
                text="Favorite not found. It may have been deleted.",
                buttons=[{"id": "fav_add", "title": "Add Favorite"}],
            )

        if fav.get("default_amount"):
            # Has a default amount — confirm immediately
            await self._set_state(
                user_id,
                "enter_amount",
                {"user_db_id": user_db_id, "fav": fav},
            )
            return FlowResponse(
                text=(
                    f"*{fav['display_name']}*\n\n"
                    f"From: {fav['from_chain']} / {fav['from_token']}\n"
                    f"To: {fav['to_chain']} / {fav['to_token']}\n"
                    f"Default amount: {fav['default_amount']} {fav['from_token']}\n\n"
                    f"Use default amount or enter a custom one:"
                ),
                buttons=[
                    {"id": "amt_skip", "title": f"Use {fav['default_amount']}"},
                ],
            )

        # No default — ask for amount directly
        await self._set_state(
            user_id,
            "enter_amount",
            {"user_db_id": user_db_id, "fav": fav},
        )
        return FlowResponse(
            text=(
                f"*{fav['display_name']}*\n\n"
                f"From: {fav['from_chain']} / {fav['from_token']}\n"
                f"To: {fav['to_chain']} / {fav['to_token']}\n\n"
                f"Enter the amount of *{fav['from_token']}* to swap:"
            )
        )

    @staticmethod
    def _build_use_result(fav: dict, amount: float) -> FlowResponse:
        return FlowResponse(
            text=(
                f"*Ready to swap*\n\n"
                f"Pair: {fav['from_chain']}/{fav['from_token']} "
                f"→ {fav['to_chain']}/{fav['to_token']}\n"
                f"Amount: *{amount} {fav['from_token']}*\n\n"
                f"Type */s {fav['from_token']} {fav['to_token']} {amount}* to execute, "
                f"or type *swap* to open the swap flow."
            )
        )

    # ---- list builders ----

    def _build_favorites_list(self, favorites: list) -> FlowResponse:
        """Show up to 3 favorites as buttons; use list if more exist."""
        if len(favorites) <= 3:
            # Fit in buttons — use → Delete pattern with list_sections for actions
            return FlowResponse(
                text=self._format_list_text(favorites),
                header="Favorites",
                list_button_text="Manage",
                list_sections=self._build_list_sections(favorites),
            )
        # >3 — always use list_sections
        return FlowResponse(
            text=self._format_list_text(favorites),
            header="Favorites",
            list_button_text="Select action",
            list_sections=self._build_list_sections(favorites),
        )

    def _build_favorites_list_full(self, favorites: list) -> FlowResponse:
        return FlowResponse(
            text=self._format_list_text(favorites),
            header="All Favorites",
            list_button_text="Select",
            list_sections=self._build_list_sections(favorites),
        )

    @staticmethod
    def _format_list_text(favorites: list) -> str:
        lines = ["*Favorite Pairs*\n"]
        for fav in favorites:
            uses = fav["use_count"] or 0
            lines.append(
                f"• *{fav['display_name']}*: "
                f"{fav['from_chain']}/{fav['from_token']} → "
                f"{fav['to_chain']}/{fav['to_token']}" + (f" ({uses} uses)" if uses else "")
            )
        return "\n".join(lines)

    @staticmethod
    def _build_list_sections(favorites: list) -> list:
        use_rows = []
        del_rows = []
        for fav in favorites:
            uses_str = f"{fav['use_count']} uses" if fav.get("use_count") else ""
            desc = (
                f"{fav['from_chain']}/{fav['from_token']} → "
                f"{fav['to_chain']}/{fav['to_token']}" + (f" | {uses_str}" if uses_str else "")
            )
            use_rows.append(
                {
                    "id": f"fav_use_{fav['id']}",
                    "title": fav["display_name"],
                    "description": desc,
                }
            )
            del_rows.append(
                {
                    "id": f"fav_del_{fav['id']}",
                    "title": fav["display_name"],
                    "description": "Tap to remove",
                }
            )

        sections = [{"title": "Use a Favorite", "rows": use_rows}]
        sections.append({"title": "Delete a Favorite", "rows": del_rows})
        sections.append(
            {
                "title": "Add New",
                "rows": [
                    {
                        "id": "fav_add",
                        "title": "Add Favorite",
                        "description": "Save a new swap pair",
                    }
                ],
            }
        )
        return sections

    @staticmethod
    def _build_chain_list(prompt: str, prefix: str) -> FlowResponse:
        chains = [
            ("SOL", "Solana"),
            ("ETH", "Ethereum"),
            ("BASE", "Base"),
            ("ARB", "Arbitrum"),
            ("OP", "Optimism"),
            ("AVAX", "Avalanche"),
            ("BNB", "BNB Chain"),
        ]
        rows = [
            {"id": f"{prefix}_{chain}", "title": label, "description": chain}
            for chain, label in chains
        ]
        return FlowResponse(
            text=prompt,
            list_button_text="Select Chain",
            list_sections=[{"title": "Supported Chains", "rows": rows}],
        )

    @staticmethod
    def _parse_id(text: str, prefix: str) -> int | None:
        try:
            return int(text[len(prefix) :])
        except (ValueError, IndexError):
            return None


_flow = FavoritesFlow()
register_flow("favorites", _flow)
