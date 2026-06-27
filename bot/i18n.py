"""Lightweight i18n for the Suwappu Telegram bot.

No external dependencies — pure dict lookup with English fallback.

Usage:
    from bot.i18n import get_text, get_user_lang

    lang = get_user_lang(update.effective_user)
    text = get_text("welcome", lang)
    # With interpolation:
    text = get_text("wallet_created", lang, chain="EVM", address="0x1234…abcd")
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# Translation dictionary
# Keys  → language codes supported: "en", "es", "fr", "zh"
# Values → format strings; use {named_placeholders} for interpolation.
# ---------------------------------------------------------------------------

_TRANSLATIONS: dict[str, dict[str, str]] = {
    # ------------------------------------------------------------------
    # welcome — shown on /start for new users (Markdown, MarkdownV2-safe
    # version is handled in the template; this is the short greeting line)
    # ------------------------------------------------------------------
    "welcome": {
        "en": (
            "🌸 *suwappu* — fast cross-chain swaps with a native C\\+\\+ core\\!\n\n"
            "🔄 *Welcome to Suwappu Bot*\n\n"
            "Cross-chain swaps made simple\\."
        ),
        "es": (
            "🌸 *suwappu* — intercambios rápidos entre cadenas con un núcleo C\\+\\+ nativo\\!\n\n"
            "🔄 *Bienvenido a Suwappu Bot*\n\n"
            "Intercambios entre cadenas simplificados\\."
        ),
        "fr": (
            "🌸 *suwappu* — échanges cross-chain rapides avec un cœur C\\+\\+ natif\\!\n\n"
            "🔄 *Bienvenue sur Suwappu Bot*\n\n"
            "Les échanges cross-chain simplifiés\\."
        ),
        "zh": (
            "🌸 *suwappu* — 原生 C\\+\\+ 核心驱动的快速跨链交换\\!\n\n"
            "🔄 *欢迎使用 Suwappu Bot*\n\n"
            "跨链交换，简单快捷\\."
        ),
    },
    # ------------------------------------------------------------------
    # wallet_created — success message after wallet creation
    # Supports {chain_name}, {chain_emoji}, {address}, {provider_note}
    # ------------------------------------------------------------------
    "wallet_created": {
        "en": "✅ *{chain_name} Wallet Created!*\n\n{chain_emoji} *Address:*\n`{address}`\n\n{provider_note}",
        "es": "✅ *¡Cartera {chain_name} creada!*\n\n{chain_emoji} *Dirección:*\n`{address}`\n\n{provider_note}",
        "fr": "✅ *Portefeuille {chain_name} créé !*\n\n{chain_emoji} *Adresse :*\n`{address}`\n\n{provider_note}",
        "zh": "✅ *{chain_name} 钱包已创建！*\n\n{chain_emoji} *地址：*\n`{address}`\n\n{provider_note}",
    },
    # ------------------------------------------------------------------
    # balance_header
    # ------------------------------------------------------------------
    "balance_header": {
        "en": "💰 *Your Balance*",
        "es": "💰 *Tu saldo*",
        "fr": "💰 *Votre solde*",
        "zh": "💰 *您的余额*",
    },
    # ------------------------------------------------------------------
    # swap_prompt
    # ------------------------------------------------------------------
    "swap_prompt": {
        "en": "🔄 *Swap*\n\nEnter swap details below.",
        "es": "🔄 *Intercambio*\n\nIngresa los detalles del intercambio a continuación.",
        "fr": "🔄 *Échange*\n\nSaisissez les détails de l'échange ci-dessous.",
        "zh": "🔄 *交换*\n\n请在下方输入交换详情。",
    },
    # ------------------------------------------------------------------
    # error_generic
    # ------------------------------------------------------------------
    "error_generic": {
        "en": "❌ Something went wrong, please try again.",
        "es": "❌ Algo salió mal, por favor inténtalo de nuevo.",
        "fr": "❌ Une erreur s'est produite, veuillez réessayer.",
        "zh": "❌ 出现了一些问题，请重试。",
    },
    # ------------------------------------------------------------------
    # processing
    # ------------------------------------------------------------------
    "processing": {
        "en": "⏳ Processing…",
        "es": "⏳ Procesando…",
        "fr": "⏳ Traitement en cours…",
        "zh": "⏳ 处理中…",
    },
    # ------------------------------------------------------------------
    # no_wallet
    # ------------------------------------------------------------------
    "no_wallet": {
        "en": "👛 You don't have a wallet yet. Use /w to create one.",
        "es": "👛 Aún no tienes una cartera. Usa /w para crear una.",
        "fr": "👛 Vous n'avez pas encore de portefeuille. Utilisez /w pour en créer un.",
        "zh": "👛 您还没有钱包。使用 /w 创建一个。",
    },
    # ------------------------------------------------------------------
    # wallet_creating — shown while wallets are being provisioned
    # ------------------------------------------------------------------
    "wallet_creating": {
        "en": "👛 _Creating your wallets…_",
        "es": "👛 _Creando tus carteras…_",
        "fr": "👛 _Création de vos portefeuilles…_",
        "zh": "👛 _正在创建您的钱包…_",
    },
    # ------------------------------------------------------------------
    # wallet_failed — fallback when creation fails
    # ------------------------------------------------------------------
    "wallet_failed": {
        "en": "⚠️ _Wallet creation failed — use /w to retry._",
        "es": "⚠️ _Error al crear la cartera — usa /w para intentarlo de nuevo._",
        "fr": "⚠️ _Échec de la création du portefeuille — utilisez /w pour réessayer._",
        "zh": "⚠️ _钱包创建失败 — 使用 /w 重试。_",
    },
}

_SUPPORTED_LANGS = frozenset({"en", "es", "fr", "zh"})


def get_user_lang(user) -> str:
    """Derive a supported language code from a Telegram User object.

    Maps language_code prefixes to supported languages; falls back to "en".

    Args:
        user: telegram.User (or any object with a ``language_code`` attribute).

    Returns:
        One of "en", "es", "fr", "zh".
    """
    if user is None:
        return "en"
    lc: str | None = getattr(user, "language_code", None)
    if not lc:
        return "en"
    lc = lc.lower()
    # Exact match first (e.g. "zh-hans", truncated below)
    if lc.startswith("zh"):
        return "zh"
    if lc.startswith("es"):
        return "es"
    if lc.startswith("fr"):
        return "fr"
    return "en"


def get_text(key: str, lang: str, **kwargs) -> str:
    """Return a translated string for ``key`` in ``lang``.

    Falls back to English if ``lang`` or ``key`` is not found.
    Applies ``str.format(**kwargs)`` when kwargs are provided.

    Args:
        key:    Translation key (see _TRANSLATIONS).
        lang:   Language code ("en", "es", "fr", "zh").
        **kwargs: Named placeholders for format-string interpolation.

    Returns:
        Translated (and optionally interpolated) string.
    """
    if lang not in _SUPPORTED_LANGS:
        lang = "en"
    translations_for_key = _TRANSLATIONS.get(key, {})
    text = translations_for_key.get(lang) or translations_for_key.get("en", key)
    if kwargs:
        try:
            text = text.format(**kwargs)
        except (KeyError, ValueError):
            # Interpolation failed — return raw string rather than crash
            pass
    return text
