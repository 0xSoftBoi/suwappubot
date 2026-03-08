"""WhatsApp Business Cloud API Service for Suwappu Bot."""

import logging
import aiohttp
from typing import Optional, List, Dict, Any
from dataclasses import dataclass

from bot.config.settings import settings

logger = logging.getLogger(__name__)

WHATSAPP_API_URL = "https://graph.facebook.com/v18.0"


@dataclass
class WhatsAppMessage:
    """Parsed incoming WhatsApp message."""
    from_number: str
    message_id: str
    timestamp: str
    text: Optional[str] = None
    button_payload: Optional[str] = None
    message_type: str = "text"


class WhatsAppService:
    """Service for interacting with WhatsApp Business Cloud API."""
    
    def __init__(self):
        self.phone_number_id = settings.whatsapp_phone_number_id
        self.access_token = settings.whatsapp_access_token
        self.verify_token = settings.whatsapp_verify_token
        self._session: Optional[aiohttp.ClientSession] = None
    
    @property
    def is_configured(self) -> bool:
        """Check if WhatsApp credentials are configured."""
        return bool(self.phone_number_id and self.access_token)
    
    async def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(
                headers={
                    "Authorization": f"Bearer {self.access_token}",
                    "Content-Type": "application/json"
                }
            )
        return self._session
    
    async def close(self):
        if self._session and not self._session.closed:
            await self._session.close()
    
    # === Sending Messages ===
    
    async def send_text_message(self, to: str, text: str) -> Dict[str, Any]:
        """Send a text message to a WhatsApp user."""
        session = await self._get_session()
        url = f"{WHATSAPP_API_URL}/{self.phone_number_id}/messages"
        
        payload = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": to,
            "type": "text",
            "text": {"body": text}
        }
        
        async with session.post(url, json=payload) as resp:
            result = await resp.json()
            if resp.status != 200:
                logger.error(f"WhatsApp send failed: {result}")
            return result
    
    async def send_interactive_buttons(
        self, 
        to: str, 
        body_text: str, 
        buttons: List[Dict[str, str]],
        header: Optional[str] = None,
        footer: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Send interactive button message.
        
        buttons format: [{"id": "btn_1", "title": "Option 1"}, ...]
        Max 3 buttons allowed.
        """
        session = await self._get_session()
        url = f"{WHATSAPP_API_URL}/{self.phone_number_id}/messages"
        
        action_buttons = [
            {"type": "reply", "reply": {"id": btn["id"], "title": btn["title"][:20]}}
            for btn in buttons[:3]  # WhatsApp limit
        ]
        
        interactive = {
            "type": "button",
            "body": {"text": body_text},
            "action": {"buttons": action_buttons}
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
            "interactive": interactive
        }
        
        async with session.post(url, json=payload) as resp:
            result = await resp.json()
            if resp.status != 200:
                logger.error(f"WhatsApp interactive send failed: {result}")
            return result
    
    async def mark_as_read(self, message_id: str) -> Dict[str, Any]:
        """Mark a message as read."""
        session = await self._get_session()
        url = f"{WHATSAPP_API_URL}/{self.phone_number_id}/messages"
        
        payload = {
            "messaging_product": "whatsapp",
            "status": "read",
            "message_id": message_id
        }
        
        async with session.post(url, json=payload) as resp:
            return await resp.json()
    
    # === Parsing Incoming Messages ===
    
    def parse_webhook_message(self, payload: Dict[str, Any]) -> Optional[WhatsAppMessage]:
        """Parse incoming webhook payload into a WhatsAppMessage."""
        try:
            entry = payload.get("entry", [{}])[0]
            changes = entry.get("changes", [{}])[0]
            value = changes.get("value", {})
            messages = value.get("messages", [])
            
            if not messages:
                return None
            
            msg = messages[0]
            from_number = msg.get("from")
            message_id = msg.get("id")
            timestamp = msg.get("timestamp")
            msg_type = msg.get("type", "text")
            
            text = None
            button_payload = None
            
            if msg_type == "text":
                text = msg.get("text", {}).get("body")
            elif msg_type == "interactive":
                interactive = msg.get("interactive", {})
                if interactive.get("type") == "button_reply":
                    button_payload = interactive.get("button_reply", {}).get("id")
                    text = interactive.get("button_reply", {}).get("title")
            
            return WhatsAppMessage(
                from_number=from_number,
                message_id=message_id,
                timestamp=timestamp,
                text=text,
                button_payload=button_payload,
                message_type=msg_type
            )
        except Exception as e:
            logger.error(f"Failed to parse WhatsApp message: {e}")
            return None
    
    def verify_webhook(self, mode: str, token: str, challenge: str) -> Optional[str]:
        """Verify webhook subscription from Meta."""
        if mode == "subscribe" and token == self.verify_token:
            logger.info("WhatsApp webhook verified successfully")
            return challenge
        logger.warning(f"WhatsApp webhook verification failed: mode={mode}")
        return None


# Singleton instance
whatsapp_service = WhatsAppService()
