"""WhatsApp template message service for proactive alerts outside the 24h window.

Meta requires pre-approved templates for outbound messages sent more than 24 hours
after the user's last message.  This service wraps each template with a typed method
so callers never need to manually build component payloads.
"""

import logging
from typing import Any, Dict, List, Optional

from bot.services.whatsapp_service import whatsapp_service

logger = logging.getLogger(__name__)


def _body_params(values: List[str]) -> List[Dict[str, Any]]:
    """Build a ``body`` component with positional text parameters."""
    return [
        {
            "type": "body",
            "parameters": [{"type": "text", "text": v} for v in values],
        }
    ]


def _header_param(value: str) -> Dict[str, Any]:
    """Build a ``header`` component with a single text parameter."""
    return {
        "type": "header",
        "parameters": [{"type": "text", "text": value}],
    }


class WhatsAppTemplateService:
    """Manages pre-approved WhatsApp template messages.

    Each entry in ``TEMPLATES`` maps a logical name to the Meta-registered
    template name and its default language code.  The ``send_*`` helper
    methods build the correct ``components`` payload so callers only pass
    business-level values.
    """

    TEMPLATES: Dict[str, Dict[str, str]] = {
        "price_alert_triggered": {
            "name": "price_alert_triggered",
            "language": "en_US",
        },
        "order_executed": {
            "name": "order_executed",
            "language": "en_US",
        },
        "copy_trade_signal": {
            "name": "copy_trade_signal",
            "language": "en_US",
        },
        "swap_completed": {
            "name": "swap_completed",
            "language": "en_US",
        },
        "security_alert": {
            "name": "security_alert",
            "language": "en_US",
        },
        "daily_portfolio": {
            "name": "daily_portfolio",
            "language": "en_US",
        },
    }

    # ------------------------------------------------------------------
    # Internal helper
    # ------------------------------------------------------------------

    async def _send(
        self,
        to: str,
        template_key: str,
        components: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        """Look up template config and delegate to ``whatsapp_service.send_template``."""
        tpl = self.TEMPLATES.get(template_key)
        if tpl is None:
            logger.error(f"Unknown template key: {template_key}")
            return {"error": f"unknown template: {template_key}"}

        result = await whatsapp_service.send_template(
            to=to,
            template_name=tpl["name"],
            language_code=tpl["language"],
            components=components,
        )
        if "error" in result:
            logger.error(f"Template send failed ({template_key} -> {to}): {result}")
        else:
            logger.info(f"Template sent: {template_key} -> {to}")
        return result

    # ------------------------------------------------------------------
    # Public send methods
    # ------------------------------------------------------------------

    async def send_price_alert(
        self,
        to: str,
        token: str,
        price: str,
        direction: str,
    ) -> Dict[str, Any]:
        """Send a price-alert-triggered template.

        Parameters match the template variables registered with Meta:
          {{1}} = token symbol, {{2}} = price, {{3}} = direction (above/below)
        """
        components = _body_params([token.upper(), str(price), direction])
        return await self._send(to, "price_alert_triggered", components)

    async def send_order_executed(
        self,
        to: str,
        order_type: str,
        token: str,
        amount: str,
        price: str,
    ) -> Dict[str, Any]:
        """Send an order-executed template.

        {{1}} = order type (limit/stop), {{2}} = token,
        {{3}} = amount, {{4}} = execution price
        """
        components = _body_params([order_type, token.upper(), str(amount), str(price)])
        return await self._send(to, "order_executed", components)

    async def send_copy_trade_signal(
        self,
        to: str,
        leader: str,
        action: str,
        token: str,
        amount: str,
    ) -> Dict[str, Any]:
        """Send a copy-trade-signal template.

        {{1}} = leader name/address, {{2}} = buy/sell,
        {{3}} = token, {{4}} = amount
        """
        components = _body_params([leader, action, token.upper(), str(amount)])
        return await self._send(to, "copy_trade_signal", components)

    async def send_swap_completed(
        self,
        to: str,
        from_token: str,
        to_token: str,
        amount: str,
        tx_hash: str,
    ) -> Dict[str, Any]:
        """Send a swap-completed template.

        {{1}} = from token, {{2}} = to token,
        {{3}} = amount, {{4}} = tx hash (truncated)
        """
        short_hash = tx_hash[:10] + "..." if len(tx_hash) > 13 else tx_hash
        components = _body_params(
            [
                from_token.upper(),
                to_token.upper(),
                str(amount),
                short_hash,
            ]
        )
        return await self._send(to, "swap_completed", components)

    async def send_security_alert(
        self,
        to: str,
        alert_type: str,
        details: str,
    ) -> Dict[str, Any]:
        """Send a security-alert template.

        {{1}} = alert type (e.g. 'Suspicious login'),
        {{2}} = detail text
        """
        components = _body_params([alert_type, details[:640]])
        return await self._send(to, "security_alert", components)

    async def send_daily_portfolio(
        self,
        to: str,
        total_value: str,
        change_pct: str,
    ) -> Dict[str, Any]:
        """Send a daily-portfolio-summary template.

        {{1}} = total portfolio value (USD),
        {{2}} = 24h change percentage
        """
        components = _body_params([f"${total_value}", f"{change_pct}%"])
        return await self._send(to, "daily_portfolio", components)


# Singleton
template_service = WhatsAppTemplateService()
