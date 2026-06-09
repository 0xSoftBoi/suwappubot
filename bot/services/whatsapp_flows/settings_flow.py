"""Settings management flow for WhatsApp.

Covers:
  - Slippage (existing, preserved)
  - Notifications toggle (existing, preserved)
  - Panic Sell toggle (existing, preserved)
  - MEV Protection toggle (Pro-gated)
  - Transaction speed preset (slow / normal / fast)
  - Default chain
  - Default output token
  - Per-swap limit, daily limit, 2FA threshold
"""

import logging
import re

from bot.services.whatsapp_flows.base import BaseWhatsAppFlow, FlowResponse
from bot.services.whatsapp_flows import register_flow
from bot.services.whatsapp_conversation import ConversationState

logger = logging.getLogger(__name__)

# ---- constants mirrored from bot/handlers/settings.py ----------------------

_SPEED_PRESETS = ("slow", "normal", "fast")

_SUPPORTED_CHAINS = (
    "ethereum",
    "bsc",
    "polygon",
    "arbitrum",
    "optimism",
    "base",
    "solana",
    "avalanche",
    "tron",
)

_OUTPUT_TOKEN_CHOICES = ("USDC", "USDT", "ETH", "BNB", "SOL")

_PRO_TIERS = None  # resolved lazily to avoid circular import at module load


def _pro_tiers():
    """Return the set of Pro+ SubscriptionTier values (lazy import)."""
    global _PRO_TIERS
    if _PRO_TIERS is None:
        from bot.models.subscription import SubscriptionTier

        _PRO_TIERS = {SubscriptionTier.PRO, SubscriptionTier.PREMIUM, SubscriptionTier.ENTERPRISE}
    return _PRO_TIERS


# ---- helpers ----------------------------------------------------------------


def _get_or_create_settings(session, user_db_id: int):
    """Return UserSettings row for user_db_id, creating it if absent."""
    from bot.models.favorites import UserSettings

    us = session.query(UserSettings).filter(UserSettings.user_id == user_db_id).first()
    if not us:
        us = UserSettings(user_id=user_db_id)
        session.add(us)
        session.flush()
    return us


def _load_full_settings(user_db_id: int) -> dict:
    """Load combined display values from User + UserSettings."""
    try:
        from database.db import get_session
        from bot.models.user import User

        with get_session() as session:
            user = session.query(User).filter(User.id == user_db_id).first()
            if not user:
                return {}
            us = _get_or_create_settings(session, user_db_id)
            session.commit()
            return {
                # slippage: prefer UserSettings; fall back to User for legacy compat
                "slippage_bps": us.default_slippage_bps or user.default_slippage or 50,
                "notify": us.notify_on_complete,
                "panic": us.panic_sell_enabled,
                "mev": getattr(us, "mev_protection_enabled", True),
                "speed": getattr(us, "tx_speed_preset", "normal") or "normal",
                "chain": us.default_chain or "any",
                "output_token": getattr(us, "default_output_token", None) or "USDC",
                "per_swap": us.per_swap_limit_usd or 5000.0,
                "daily": us.daily_limit_usd or 50000.0,
                "twofa": us.require_2fa_above_usd or 1000.0,
            }
    except Exception as e:
        logger.error(f"_load_full_settings error: {e}")
        return {}


# ---- flow -------------------------------------------------------------------


class SettingsFlow(BaseWhatsAppFlow):
    flow_name = "settings"
    trigger_commands = ["settings", "config", "/settings", "/set"]
    steps = {
        # main menu
        "main_menu": "_step_main_menu",
        # existing
        "set_slippage": "_step_slippage",
        # new advanced
        "set_speed": "_step_set_speed",
        "set_chain": "_step_set_chain",
        "set_output_token": "_step_set_output_token",
        "set_limits": "_step_set_limits",
        "set_2fa_threshold": "_step_set_2fa_threshold",
    }

    # ---- entry point --------------------------------------------------------

    async def start(self, user_id: str, user_db_id: int, text: str = "") -> FlowResponse:
        await self._set_state(user_id, "main_menu", {"user_db_id": user_db_id})
        return self._show_main_menu(user_db_id)

    # ---- menu builder -------------------------------------------------------

    def _show_main_menu(self, user_db_id: int) -> FlowResponse:
        d = _load_full_settings(user_db_id)
        if not d:
            return FlowResponse("Could not load settings. Please try again.")

        slippage_pct = d["slippage_bps"] / 100
        notif_icon = "On" if d["notify"] else "Off"
        panic_icon = "On" if d["panic"] else "Off"
        mev_icon = "On" if d["mev"] else "Off"
        speed = d["speed"].capitalize()
        chain = d["chain"].capitalize()
        output_tok = d["output_token"]
        per_swap = d["per_swap"]
        daily = d["daily"]
        twofa = d["twofa"]

        return FlowResponse(
            text=(
                "*Settings*\n\n"
                f"Slippage: {slippage_pct}%\n"
                f"Notifications: {notif_icon}\n"
                f"Panic Sell: {panic_icon}\n"
                f"MEV Protection: {mev_icon} (Pro)\n"
                f"Speed: {speed}\n"
                f"Chain: {chain}\n"
                f"Output token: {output_tok}\n"
                f"Per-swap limit: ${per_swap:,.0f}\n"
                f"Daily limit: ${daily:,.0f}\n"
                f"2FA above: ${twofa:,.0f}\n\n"
                "Select a setting to change:"
            ),
            list_button_text="Change Setting",
            list_sections=[
                {
                    "title": "Trading",
                    "rows": [
                        {
                            "id": "set_slippage",
                            "title": "Slippage",
                            "description": f"Currently {slippage_pct}%",
                        },
                        {
                            "id": "set_speed",
                            "title": "Transaction Speed",
                            "description": f"Currently {speed}",
                        },
                        {
                            "id": "set_chain",
                            "title": "Default Chain",
                            "description": f"Currently {chain}",
                        },
                        {
                            "id": "set_output_token",
                            "title": "Default Output Token",
                            "description": f"Currently {output_tok}",
                        },
                    ],
                },
                {
                    "title": "Security",
                    "rows": [
                        {
                            "id": "toggle_notif",
                            "title": "Notifications",
                            "description": f"Currently {notif_icon}",
                        },
                        {
                            "id": "toggle_panic",
                            "title": "Panic Sell",
                            "description": f"Currently {panic_icon}",
                        },
                        {
                            "id": "toggle_mev",
                            "title": "MEV Protection (Pro)",
                            "description": f"Currently {mev_icon}",
                        },
                    ],
                },
                {
                    "title": "Limits",
                    "rows": [
                        {
                            "id": "set_limits",
                            "title": "Swap & Daily Limits",
                            "description": f"${per_swap:,.0f} / ${daily:,.0f}",
                        },
                        {
                            "id": "set_2fa_threshold",
                            "title": "2FA Threshold",
                            "description": f"Currently ${twofa:,.0f}",
                        },
                    ],
                },
            ],
        )

    # ---- main menu dispatcher -----------------------------------------------

    async def _step_main_menu(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        db_uid = state.data.get("user_db_id") or user_db_id

        if text == "set_slippage":
            await self._update(user_id, "set_slippage")
            return FlowResponse(
                text="Enter your desired slippage percentage (e.g. `0.5` or `1`):",
            )

        elif text == "toggle_notif":
            return await self._toggle_user_settings(
                user_id, db_uid, "notify_on_complete", also_user_field="notifications_enabled"
            )

        elif text == "toggle_panic":
            return await self._toggle_user_settings(
                user_id, db_uid, "panic_sell_enabled", also_user_field="panic_sell_enabled"
            )

        elif text == "toggle_mev":
            return await self._toggle_mev(user_id, db_uid)

        elif text == "set_speed":
            await self._update(user_id, "set_speed")
            return self._speed_picker()

        elif text == "set_chain":
            await self._update(user_id, "set_chain")
            return self._chain_picker()

        elif text == "set_output_token":
            await self._update(user_id, "set_output_token")
            return self._output_token_picker()

        elif text == "set_limits":
            await self._update(user_id, "set_limits")
            d = _load_full_settings(db_uid)
            per_swap = d.get("per_swap", 5000)
            daily = d.get("daily", 50000)
            return FlowResponse(
                text=(
                    "*Set Spending Limits*\n\n"
                    f"Current: ${per_swap:,.0f} per swap / ${daily:,.0f} daily\n\n"
                    "Enter new limits as two numbers separated by a space:\n"
                    "`per_swap daily`\n\n"
                    "Example: `5000 50000`"
                ),
            )

        elif text == "set_2fa_threshold":
            await self._update(user_id, "set_2fa_threshold")
            d = _load_full_settings(db_uid)
            twofa = d.get("twofa", 1000)
            return FlowResponse(
                text=(
                    "*2FA Threshold*\n\n"
                    f"Current: ${twofa:,.0f}\n\n"
                    "Enter the minimum USD amount above which 2FA is required\n"
                    "(e.g. `1000`):"
                ),
            )

        else:
            return self._show_main_menu(db_uid)

    # ---- step: slippage (existing, now writes to UserSettings too) ----------

    async def _step_slippage(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        db_uid = state.data.get("user_db_id") or user_db_id
        try:
            val = float(text.replace("%", "").strip())
            if val < 0.01 or val > 50:
                return FlowResponse("Slippage must be between 0.01% and 50%. Try again:")
            bps = int(val * 100)
        except ValueError:
            return FlowResponse("Please enter a valid number (e.g. `0.5`):")

        try:
            from database.db import get_session
            from bot.models.user import User

            with get_session() as session:
                user = session.query(User).filter(User.id == db_uid).first()
                if user:
                    user.default_slippage = bps  # keep User column in sync (swap engine reads it)
                us = _get_or_create_settings(session, db_uid)
                us.default_slippage_bps = bps
                session.commit()
        except Exception as e:
            logger.error(f"Slippage update error: {e}")
            await self._clear(user_id)
            return FlowResponse("Failed to update slippage. Try again later.")

        await self._clear(user_id)
        return FlowResponse(f"Slippage updated to *{val}%*")

    # ---- step: transaction speed --------------------------------------------

    def _speed_picker(self) -> FlowResponse:
        rows = [
            {
                "id": f"speed_{s}",
                "title": s.capitalize(),
                "description": {
                    "slow": "Lower fee, may be slower",
                    "normal": "Balanced fee and speed",
                    "fast": "Higher fee for quick inclusion",
                }[s],
            }
            for s in _SPEED_PRESETS
        ]
        return FlowResponse(
            text="*Transaction Speed*\n\nPick a priority-fee preset:",
            list_button_text="Select Speed",
            list_sections=[{"title": "Speed Presets", "rows": rows}],
        )

    async def _step_set_speed(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        db_uid = state.data.get("user_db_id") or user_db_id
        preset = text.replace("speed_", "").lower()
        if preset not in _SPEED_PRESETS:
            return self._speed_picker()

        try:
            from database.db import get_session

            with get_session() as session:
                us = _get_or_create_settings(session, db_uid)
                us.tx_speed_preset = preset
                session.commit()
        except Exception as e:
            logger.error(f"Speed update error: {e}")
            await self._clear(user_id)
            return FlowResponse("Failed to update speed. Try again later.")

        await self._clear(user_id)
        return FlowResponse(f"Transaction speed set to *{preset.capitalize()}*")

    # ---- step: default chain ------------------------------------------------

    def _chain_picker(self) -> FlowResponse:
        rows = [
            {
                "id": f"chain_{c}",
                "title": c.capitalize(),
                "description": f"Set {c} as default chain",
            }
            for c in _SUPPORTED_CHAINS
        ]
        rows.append(
            {
                "id": "chain_any",
                "title": "Any (no preference)",
                "description": "Use any available chain",
            }
        )
        return FlowResponse(
            text="*Default Chain*\n\nSwaps will default to this chain when no chain is specified:",
            list_button_text="Select Chain",
            list_sections=[{"title": "Chains", "rows": rows}],
        )

    async def _step_set_chain(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        db_uid = state.data.get("user_db_id") or user_db_id
        raw = text.replace("chain_", "").lower()
        chain = None if raw == "any" else raw
        if chain is not None and chain not in _SUPPORTED_CHAINS:
            return self._chain_picker()

        try:
            from database.db import get_session

            with get_session() as session:
                us = _get_or_create_settings(session, db_uid)
                us.default_chain = chain
                session.commit()
        except Exception as e:
            logger.error(f"Chain update error: {e}")
            await self._clear(user_id)
            return FlowResponse("Failed to update default chain. Try again later.")

        await self._clear(user_id)
        label = chain.capitalize() if chain else "Any"
        return FlowResponse(f"Default chain set to *{label}*")

    # ---- step: default output token -----------------------------------------

    def _output_token_picker(self) -> FlowResponse:
        rows = [
            {"id": f"outtok_{t}", "title": t, "description": f"Set {t} as default output token"}
            for t in _OUTPUT_TOKEN_CHOICES
        ]
        rows.append(
            {"id": "outtok_custom", "title": "Custom...", "description": "Type any token symbol"}
        )
        return FlowResponse(
            text="*Default Output Token*\n\nSelect a common token or choose Custom to type any symbol:",
            list_button_text="Select Token",
            list_sections=[{"title": "Output Tokens", "rows": rows}],
        )

    async def _step_set_output_token(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        db_uid = state.data.get("user_db_id") or user_db_id

        if text == "outtok_custom":
            # Re-use same step — next message will be the raw symbol
            await self._update(user_id, "set_output_token", {"awaiting_custom": True})
            return FlowResponse("Enter the token symbol (e.g. `WBTC`):")

        awaiting_custom = state.data.get("awaiting_custom", False)

        if text.startswith("outtok_"):
            token = text.replace("outtok_", "").upper()
        elif awaiting_custom:
            token = text.strip().upper()
            if not re.match(r"^[A-Z0-9]{1,20}$", token):
                return FlowResponse(
                    "Invalid symbol. Use letters and digits only (max 20 chars). Try again:"
                )
        else:
            return self._output_token_picker()

        try:
            from database.db import get_session

            with get_session() as session:
                us = _get_or_create_settings(session, db_uid)
                us.default_output_token = token
                session.commit()
        except Exception as e:
            logger.error(f"Output token update error: {e}")
            await self._clear(user_id)
            return FlowResponse("Failed to update output token. Try again later.")

        await self._clear(user_id)
        return FlowResponse(f"Default output token set to *{token}*")

    # ---- step: spending limits ----------------------------------------------

    async def _step_set_limits(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        db_uid = state.data.get("user_db_id") or user_db_id

        parts = text.strip().split()
        if len(parts) != 2:
            return FlowResponse(
                "Please enter two numbers separated by a space: `per_swap daily`\n"
                "Example: `5000 50000`"
            )

        try:
            per_swap = float(parts[0].replace(",", ""))
            daily = float(parts[1].replace(",", ""))
        except ValueError:
            return FlowResponse(
                "Invalid numbers. Please enter two positive values.\nExample: `5000 50000`"
            )

        if per_swap <= 0 or daily <= 0:
            return FlowResponse("Both limits must be positive numbers. Try again:")

        if per_swap > daily:
            return FlowResponse("Per-swap limit cannot exceed the daily limit. Try again:")

        try:
            from database.db import get_session

            with get_session() as session:
                us = _get_or_create_settings(session, db_uid)
                us.per_swap_limit_usd = per_swap
                us.daily_limit_usd = daily
                session.commit()
        except Exception as e:
            logger.error(f"Limits update error: {e}")
            await self._clear(user_id)
            return FlowResponse("Failed to update limits. Try again later.")

        # Sync to Turnkey infrastructure (mirrors TG handler behaviour)
        try:
            from bot.services.security import sync_limits_to_turnkey

            await sync_limits_to_turnkey(db_uid)
        except Exception as e:
            logger.warning(f"sync_limits_to_turnkey failed (non-fatal): {e}")

        await self._clear(user_id)
        return FlowResponse(
            f"Spending limits updated:\n"
            f"  Per swap: *${per_swap:,.0f}*\n"
            f"  Daily: *${daily:,.0f}*"
        )

    # ---- step: 2FA threshold ------------------------------------------------

    async def _step_set_2fa_threshold(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        db_uid = state.data.get("user_db_id") or user_db_id

        try:
            val = float(text.replace("$", "").replace(",", "").strip())
            if val < 0:
                raise ValueError
        except ValueError:
            return FlowResponse("Please enter a valid non-negative USD amount (e.g. `1000`):")

        try:
            from database.db import get_session
            from bot.models.user import User

            with get_session() as session:
                user = session.query(User).filter(User.id == db_uid).first()
                if user:
                    user.two_fa_threshold = int(val)  # enforcement reads User.two_fa_threshold
                us = _get_or_create_settings(session, db_uid)
                us.require_2fa_above_usd = val  # display/TG parity reads UserSettings
                session.commit()
        except Exception as e:
            logger.error(f"2FA threshold update error: {e}")
            await self._clear(user_id)
            return FlowResponse("Failed to update 2FA threshold. Try again later.")

        await self._clear(user_id)
        return FlowResponse(f"2FA required above *${val:,.0f}*")

    # ---- toggles ------------------------------------------------------------

    async def _toggle_user_settings(
        self,
        user_id: str,
        user_db_id: int,
        us_field: str,
        also_user_field: str | None = None,
    ) -> FlowResponse:
        """Toggle a boolean on UserSettings (and optionally the User model)."""
        await self._clear(user_id)
        try:
            from database.db import get_session
            from bot.models.user import User

            with get_session() as session:
                user = session.query(User).filter(User.id == user_db_id).first()
                us = _get_or_create_settings(session, user_db_id)

                current = getattr(us, us_field, False)
                setattr(us, us_field, not current)

                # Keep User table in sync for fields that other services read
                if also_user_field and user and hasattr(user, also_user_field):
                    setattr(user, also_user_field, not current)

                session.commit()
                label = us_field.replace("_", " ").title()
                state_word = "enabled" if not current else "disabled"
                return FlowResponse(f"{label} {state_word}")
        except Exception as e:
            logger.error(f"Toggle {us_field} error: {e}")
        return FlowResponse("Failed to update setting. Try again later.")

    async def _toggle_mev(self, user_id: str, user_db_id: int) -> FlowResponse:
        """Toggle MEV protection — Pro tier required."""
        await self._clear(user_id)
        try:
            from bot.services.x402_service import x402_service

            tier = await x402_service.get_tier(user_db_id)
            if tier not in _pro_tiers():
                return FlowResponse(
                    "MEV Protection is a *Pro* feature.\n\n"
                    "Upgrade to Pro to enable hardware-level MEV protection on your swaps."
                )
        except Exception as e:
            logger.error(f"Tier check error: {e}")
            return FlowResponse("Could not verify subscription tier. Try again later.")

        try:
            from database.db import get_session

            with get_session() as session:
                us = _get_or_create_settings(session, user_db_id)
                current = getattr(us, "mev_protection_enabled", True)
                us.mev_protection_enabled = not current
                session.commit()
                state_word = "enabled" if not current else "disabled"
                return FlowResponse(f"MEV Protection {state_word}")
        except Exception as e:
            logger.error(f"MEV toggle error: {e}")
        return FlowResponse("Failed to update MEV protection. Try again later.")


_flow = SettingsFlow()
register_flow("settings", _flow)
