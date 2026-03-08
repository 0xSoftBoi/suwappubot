"""WhatsApp conversation flow registry."""

from typing import Dict, Type
from bot.services.whatsapp_flows.base import BaseWhatsAppFlow

# Flow name -> Flow class mapping
_registry: Dict[str, BaseWhatsAppFlow] = {}


def register_flow(name: str, flow: BaseWhatsAppFlow) -> None:
    """Register a flow instance by name."""
    _registry[name] = flow


def get_flow(name: str) -> BaseWhatsAppFlow | None:
    """Look up a registered flow by name."""
    return _registry.get(name)


def get_all_flows() -> Dict[str, BaseWhatsAppFlow]:
    """Return all registered flows."""
    return dict(_registry)


def _bootstrap() -> None:
    """Import and register all flow modules.  Called once at import time."""
    # Each module registers itself via register_flow() at import
    from bot.services.whatsapp_flows import swap_flow  # noqa: F401
    from bot.services.whatsapp_flows import wallet_flow  # noqa: F401
    from bot.services.whatsapp_flows import settings_flow  # noqa: F401
    from bot.services.whatsapp_flows import alerts_flow  # noqa: F401
    from bot.services.whatsapp_flows import orders_flow  # noqa: F401
    from bot.services.whatsapp_flows import custodial_flow  # noqa: F401
    from bot.services.whatsapp_flows import snipe_flow  # noqa: F401
    from bot.services.whatsapp_flows import tax_flow  # noqa: F401


_bootstrap()
