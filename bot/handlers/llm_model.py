"""/model — pick which LLM answers natural-language trading messages.

Only meaningful when settings.LLM_MULTI_PROVIDER_ENABLED; with the flag off
the command still works (preference is stored) but routing stays on the
env-configured provider.
"""

import logging

from telegram import Update
from telegram.ext import ContextTypes

from bot.config.llm_models import (
    MODEL_CATALOG,
    DEFAULT_MODEL_NAME,
    get_model,
    selectable_models,
)
from bot.services import llm_credit_service

logger = logging.getLogger(__name__)


async def llm_model_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """/model             — list available models (tier- and key-aware)
    /model <name>      — set preference
    /model reset       — clear preference (use default)"""
    if not update.effective_user or not update.message:
        return
    telegram_id = update.effective_user.id

    user_ctx = await llm_credit_service.get_llm_user_context(telegram_id)
    if user_ctx is None:
        await update.message.reply_text("Use /start first to set up your account.")
        return

    # Single source of truth for "can this tier actually use this model right
    # now" — same predicate the selection check below relies on.
    usable_names = {spec.friendly_name for spec in selectable_models(user_ctx.tier)}

    if not context.args:
        lines = ["*AI model for natural-language trading*\n"]
        for name, spec in MODEL_CATALOG.items():
            marks = []
            if name == (user_ctx.llm_model_pref or DEFAULT_MODEL_NAME):
                marks.append("current")
            if name not in usable_names:
                if not spec.is_tier_allowed(user_ctx.tier):
                    marks.append(f"requires {spec.min_tier.value}")
                else:
                    marks.append("unavailable")
            suffix = f" _({', '.join(marks)})_" if marks else ""
            lines.append(f"• `{name}`{suffix}")
        lines.append("\nSet with `/model <name>`, reset with `/model reset`.")
        await update.message.reply_text("\n".join(lines), parse_mode="Markdown")
        return

    choice = context.args[0].strip().lower()
    if choice == "reset":
        await llm_credit_service.set_llm_model_pref(telegram_id, None)
        await update.message.reply_text(
            f"✅ Model reset to default (`{DEFAULT_MODEL_NAME}`).", parse_mode="Markdown"
        )
        return

    spec = get_model(choice)
    if spec is None:
        await update.message.reply_text("❌ Unknown model — send /model to see the list.")
        return
    if spec.friendly_name not in usable_names:
        if not spec.is_tier_allowed(user_ctx.tier):
            await update.message.reply_text(
                f"❌ `{choice}` needs the *{spec.min_tier.value}* tier — see /vip to upgrade.",
                parse_mode="Markdown",
            )
        else:
            await update.message.reply_text("❌ That model isn't available right now.")
        return

    await llm_credit_service.set_llm_model_pref(telegram_id, choice)
    await update.message.reply_text(f"✅ Model set to `{choice}`.", parse_mode="Markdown")
