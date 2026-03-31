"""Meta's native WhatsApp Flows — structured form inputs.

WhatsApp Flows let the bot send rich multi-field forms that the user fills in
natively in the WhatsApp client.  One form replaces 6+ conversation steps.

Flow JSON schemas are registered with Meta via the WhatsApp Manager or API.
This module stores the local schema definitions (for reference / creation)
and provides helpers for sending flows and parsing ``nfm_reply`` submissions.
"""

import json
import logging
from typing import Any, Dict, List, Optional

from bot.services.whatsapp_service import whatsapp_service
from bot.config.settings import settings

logger = logging.getLogger(__name__)

WHATSAPP_API_URL = "https://graph.facebook.com/v18.0"

# ------------------------------------------------------------------
# Flow JSON schemas (canonical reference — must match what's registered
# in Meta's WhatsApp Manager for the phone number).
# ------------------------------------------------------------------

FLOW_SCHEMAS: Dict[str, Dict[str, Any]] = {
    "swap_form": {
        "version": "3.1",
        "screens": [
            {
                "id": "SWAP_SCREEN",
                "title": "Swap Tokens",
                "data": {},
                "layout": {
                    "type": "SingleColumnLayout",
                    "children": [
                        {
                            "type": "Dropdown",
                            "label": "From Token",
                            "name": "from_token",
                            "required": True,
                            "data-source": [
                                {"id": "ETH", "title": "ETH"},
                                {"id": "USDC", "title": "USDC"},
                                {"id": "USDT", "title": "USDT"},
                                {"id": "WBTC", "title": "WBTC"},
                                {"id": "DAI", "title": "DAI"},
                            ],
                        },
                        {
                            "type": "Dropdown",
                            "label": "To Token",
                            "name": "to_token",
                            "required": True,
                            "data-source": [
                                {"id": "ETH", "title": "ETH"},
                                {"id": "USDC", "title": "USDC"},
                                {"id": "USDT", "title": "USDT"},
                                {"id": "WBTC", "title": "WBTC"},
                                {"id": "DAI", "title": "DAI"},
                            ],
                        },
                        {
                            "type": "TextInput",
                            "label": "Amount",
                            "name": "amount",
                            "required": True,
                            "input-type": "number",
                            "helper-text": "Amount of source token to swap",
                        },
                        {
                            "type": "Dropdown",
                            "label": "Chain",
                            "name": "chain",
                            "required": True,
                            "data-source": [
                                {"id": "ethereum", "title": "Ethereum"},
                                {"id": "arbitrum", "title": "Arbitrum"},
                                {"id": "base", "title": "Base"},
                                {"id": "polygon", "title": "Polygon"},
                                {"id": "optimism", "title": "Optimism"},
                                {"id": "bsc", "title": "BSC"},
                                {"id": "solana", "title": "Solana"},
                            ],
                        },
                        {
                            "type": "TextInput",
                            "label": "Slippage %",
                            "name": "slippage",
                            "required": False,
                            "input-type": "number",
                            "helper-text": "Default: 1%",
                        },
                        {
                            "type": "Footer",
                            "label": "Submit Swap",
                            "on-click-action": {
                                "name": "complete",
                                "payload": {
                                    "from_token": "${form.from_token}",
                                    "to_token": "${form.to_token}",
                                    "amount": "${form.amount}",
                                    "chain": "${form.chain}",
                                    "slippage": "${form.slippage}",
                                },
                            },
                        },
                    ],
                },
            }
        ],
    },
    "perps_form": {
        "version": "3.1",
        "screens": [
            {
                "id": "PERPS_SCREEN",
                "title": "Open Perps Position",
                "data": {},
                "layout": {
                    "type": "SingleColumnLayout",
                    "children": [
                        {
                            "type": "Dropdown",
                            "label": "Market",
                            "name": "market",
                            "required": True,
                            "data-source": [
                                {"id": "BTC-USD", "title": "BTC-USD"},
                                {"id": "ETH-USD", "title": "ETH-USD"},
                                {"id": "SOL-USD", "title": "SOL-USD"},
                                {"id": "ARB-USD", "title": "ARB-USD"},
                            ],
                        },
                        {
                            "type": "Dropdown",
                            "label": "Direction",
                            "name": "direction",
                            "required": True,
                            "data-source": [
                                {"id": "long", "title": "Long"},
                                {"id": "short", "title": "Short"},
                            ],
                        },
                        {
                            "type": "TextInput",
                            "label": "Size (USD)",
                            "name": "size_usd",
                            "required": True,
                            "input-type": "number",
                            "helper-text": "Position size in USD",
                        },
                        {
                            "type": "TextInput",
                            "label": "Leverage",
                            "name": "leverage",
                            "required": True,
                            "input-type": "number",
                            "helper-text": "1x - 50x",
                        },
                        {
                            "type": "TextInput",
                            "label": "Stop Loss Price",
                            "name": "stop_loss",
                            "required": False,
                            "input-type": "number",
                            "helper-text": "Optional stop loss",
                        },
                        {
                            "type": "TextInput",
                            "label": "Take Profit Price",
                            "name": "take_profit",
                            "required": False,
                            "input-type": "number",
                            "helper-text": "Optional take profit",
                        },
                        {
                            "type": "Footer",
                            "label": "Open Position",
                            "on-click-action": {
                                "name": "complete",
                                "payload": {
                                    "market": "${form.market}",
                                    "direction": "${form.direction}",
                                    "size_usd": "${form.size_usd}",
                                    "leverage": "${form.leverage}",
                                    "stop_loss": "${form.stop_loss}",
                                    "take_profit": "${form.take_profit}",
                                },
                            },
                        },
                    ],
                },
            }
        ],
    },
    "settings_form": {
        "version": "3.1",
        "screens": [
            {
                "id": "SETTINGS_SCREEN",
                "title": "Bot Settings",
                "data": {},
                "layout": {
                    "type": "SingleColumnLayout",
                    "children": [
                        {
                            "type": "Dropdown",
                            "label": "Default Chain",
                            "name": "default_chain",
                            "required": False,
                            "data-source": [
                                {"id": "ethereum", "title": "Ethereum"},
                                {"id": "arbitrum", "title": "Arbitrum"},
                                {"id": "base", "title": "Base"},
                                {"id": "polygon", "title": "Polygon"},
                                {"id": "optimism", "title": "Optimism"},
                                {"id": "bsc", "title": "BSC"},
                                {"id": "solana", "title": "Solana"},
                            ],
                        },
                        {
                            "type": "TextInput",
                            "label": "Default Slippage %",
                            "name": "default_slippage",
                            "required": False,
                            "input-type": "number",
                            "helper-text": "e.g. 1.0",
                        },
                        {
                            "type": "Dropdown",
                            "label": "Gas Speed",
                            "name": "gas_speed",
                            "required": False,
                            "data-source": [
                                {"id": "slow", "title": "Slow (cheaper)"},
                                {"id": "standard", "title": "Standard"},
                                {"id": "fast", "title": "Fast"},
                            ],
                        },
                        {
                            "type": "Dropdown",
                            "label": "Price Alerts",
                            "name": "alerts_enabled",
                            "required": False,
                            "data-source": [
                                {"id": "on", "title": "Enabled"},
                                {"id": "off", "title": "Disabled"},
                            ],
                        },
                        {
                            "type": "Footer",
                            "label": "Save Settings",
                            "on-click-action": {
                                "name": "complete",
                                "payload": {
                                    "default_chain": "${form.default_chain}",
                                    "default_slippage": "${form.default_slippage}",
                                    "gas_speed": "${form.gas_speed}",
                                    "alerts_enabled": "${form.alerts_enabled}",
                                },
                            },
                        },
                    ],
                },
            }
        ],
    },
}


class WhatsAppMetaFlows:
    """Manages Meta's native WhatsApp Flows for complex form inputs.

    Flows are created/updated via the Graph API and referenced by their
    ``flow_id``.  Once deployed, the bot sends a flow message and the user
    fills the form natively in WhatsApp.  The reply arrives as an
    ``nfm_reply`` interactive message which ``handle_nfm_reply`` parses.
    """

    async def send_flow(
        self,
        to: str,
        flow_id: str,
        flow_token: str,
        data: Optional[Dict[str, Any]] = None,
        header: Optional[str] = None,
        body: Optional[str] = None,
        footer: Optional[str] = None,
        flow_cta: str = "Open Form",
    ) -> Dict[str, Any]:
        """Send a WhatsApp Flow interactive message.

        ``flow_id``:    The ID assigned by Meta when the flow was created.
        ``flow_token``: A unique token for this invocation (used to correlate replies).
        ``data``:       Optional pre-fill data dict for the flow's initial screen.
        """
        url = f"{WHATSAPP_API_URL}/{settings.whatsapp_phone_number_id}/messages"

        interactive: Dict[str, Any] = {
            "type": "flow",
            "body": {"text": body or "Please fill in the form below."},
            "action": {
                "name": "flow",
                "parameters": {
                    "flow_message_version": "3",
                    "flow_id": flow_id,
                    "flow_token": flow_token,
                    "flow_cta": flow_cta,
                    "mode": "published",
                },
            },
        }

        if data:
            interactive["action"]["parameters"]["flow_action_payload"] = {
                "screen": list(FLOW_SCHEMAS.values())[0]["screens"][0]["id"]
                if FLOW_SCHEMAS else "MAIN_SCREEN",
                "data": data,
            }

        if header:
            interactive["header"] = {"type": "text", "text": header}
        if footer:
            interactive["footer"] = {"text": footer}

        payload = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": to,
            "type": "interactive",
            "interactive": interactive,
        }

        session = await whatsapp_service._get_session()
        try:
            async with session.post(url, json=payload) as resp:
                result = await resp.json()
                if resp.status != 200:
                    logger.error(f"Flow send error ({flow_id} -> {to}): {result}")
                else:
                    logger.info(f"Flow sent: {flow_id} -> {to}")
                return result
        except Exception as e:
            logger.error(f"Flow send failed ({flow_id} -> {to}): {e}")
            return {"error": str(e)}

    def handle_nfm_reply(self, nfm_data: Any) -> Dict[str, Any]:
        """Parse a form submission from an ``nfm_reply`` interactive message.

        The ``nfm_data`` can be a raw JSON string or an already-parsed dict.
        Returns a normalised dict of field -> value pairs submitted by the user.
        """
        if nfm_data is None:
            return {}

        if isinstance(nfm_data, str):
            try:
                nfm_data = json.loads(nfm_data)
            except (json.JSONDecodeError, TypeError):
                logger.error(f"Could not parse nfm_reply data: {nfm_data!r}")
                return {}

        if not isinstance(nfm_data, dict):
            logger.warning(f"Unexpected nfm_reply type: {type(nfm_data)}")
            return {}

        # Strip internal Meta keys (prefixed with ``_``) and empty values
        parsed: Dict[str, Any] = {}
        for key, value in nfm_data.items():
            if key.startswith("_"):
                continue
            if value is None or value == "":
                continue
            # Attempt numeric coercion for fields that look numeric
            if isinstance(value, str):
                try:
                    value = float(value)
                    if value == int(value):
                        value = int(value)
                except ValueError:
                    pass
            parsed[key] = value

        logger.debug(f"Parsed nfm_reply: {parsed}")
        return parsed

    def get_schema(self, flow_key: str) -> Optional[Dict[str, Any]]:
        """Return the local schema definition for a flow key.

        Useful for programmatic flow creation via the Graph API.
        """
        return FLOW_SCHEMAS.get(flow_key)

    def list_schemas(self) -> List[str]:
        """Return available flow schema keys."""
        return list(FLOW_SCHEMAS.keys())


# Singleton
meta_flows = WhatsAppMetaFlows()
