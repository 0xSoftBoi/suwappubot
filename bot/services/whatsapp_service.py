"""WhatsApp Business Cloud API Service for Suwappu Bot."""

import asyncio
import logging
import aiohttp
from typing import Optional, List, Dict, Any
from dataclasses import dataclass

from bot.config.settings import settings

logger = logging.getLogger(__name__)

WHATSAPP_API_URL = "https://graph.facebook.com/v18.0"

# Retry config
_MAX_RETRIES = 3
_RETRY_BACKOFF = 1.0  # seconds, doubles each retry


@dataclass
class WhatsAppMessage:
    """Parsed incoming WhatsApp message."""
    from_number: str
    message_id: str
    timestamp: str
    text: Optional[str] = None
    button_payload: Optional[str] = None
    list_reply_id: Optional[str] = None
    message_type: str = "text"
    audio_id: Optional[str] = None
    image_id: Optional[str] = None
    nfm_reply_data: Optional[Dict[str, Any]] = None


class WhatsAppService:
    """Service for interacting with WhatsApp Business Cloud API."""

    def __init__(self):
        self.phone_number_id = settings.whatsapp_phone_number_id
        self.access_token = settings.whatsapp_access_token
        self.verify_token = settings.whatsapp_verify_token
        self._session: Optional[aiohttp.ClientSession] = None

    @property
    def is_configured(self) -> bool:
        return bool(self.phone_number_id and self.access_token)

    async def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            connector = aiohttp.TCPConnector(limit=20, ttl_dns_cache=300)
            timeout = aiohttp.ClientTimeout(total=30)
            self._session = aiohttp.ClientSession(
                connector=connector,
                timeout=timeout,
                headers={
                    "Authorization": f"Bearer {self.access_token}",
                    "Content-Type": "application/json"
                }
            )
        return self._session

    async def close(self):
        if self._session and not self._session.closed:
            await self._session.close()

    async def _post_with_retry(self, url: str, payload: dict) -> Dict[str, Any]:
        """POST with exponential backoff retry for 429/5xx."""
        session = await self._get_session()
        last_error = None
        for attempt in range(_MAX_RETRIES):
            try:
                async with session.post(url, json=payload) as resp:
                    result = await resp.json()
                    if resp.status == 200:
                        return result
                    if resp.status == 429 or resp.status >= 500:
                        wait = _RETRY_BACKOFF * (2 ** attempt)
                        logger.warning(f"WhatsApp API {resp.status}, retry {attempt+1} in {wait}s")
                        await asyncio.sleep(wait)
                        last_error = result
                        continue
                    logger.error(f"WhatsApp API error {resp.status}: {result}")
                    return result
            except (aiohttp.ClientError, asyncio.TimeoutError) as e:
                wait = _RETRY_BACKOFF * (2 ** attempt)
                logger.warning(f"WhatsApp request error: {e}, retry {attempt+1} in {wait}s")
                await asyncio.sleep(wait)
                last_error = {"error": str(e)}
        logger.error(f"WhatsApp API failed after {_MAX_RETRIES} retries: {last_error}")
        return last_error or {"error": "max retries exceeded"}

    # === Sending Messages ===

    async def send_text_message(self, to: str, text: str) -> Dict[str, Any]:
        """Send a text message to a WhatsApp user."""
        url = f"{WHATSAPP_API_URL}/{self.phone_number_id}/messages"
        payload = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": to,
            "type": "text",
            "text": {"body": text}
        }
        return await self._post_with_retry(url, payload)

    async def send_interactive_buttons(
        self,
        to: str,
        body_text: str,
        buttons: List[Dict[str, str]],
        header: Optional[str] = None,
        footer: Optional[str] = None
    ) -> Dict[str, Any]:
        """Send interactive button message (max 3 buttons)."""
        url = f"{WHATSAPP_API_URL}/{self.phone_number_id}/messages"

        action_buttons = [
            {"type": "reply", "reply": {"id": btn["id"], "title": btn["title"][:20]}}
            for btn in buttons[:3]
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
        return await self._post_with_retry(url, payload)

    async def send_interactive_list(
        self,
        to: str,
        body_text: str,
        button_text: str,
        sections: List[Dict[str, Any]],
        header: Optional[str] = None,
        footer: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Send interactive list message (up to 10 rows per section, 10 sections max)."""
        url = f"{WHATSAPP_API_URL}/{self.phone_number_id}/messages"

        interactive = {
            "type": "list",
            "body": {"text": body_text},
            "action": {
                "button": button_text[:20],
                "sections": sections[:10],
            },
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
        return await self._post_with_retry(url, payload)

    async def send_document(
        self,
        to: str,
        media_url: str,
        filename: str,
        caption: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Send a document (PDF, CSV, etc.) via URL."""
        url = f"{WHATSAPP_API_URL}/{self.phone_number_id}/messages"
        document = {"link": media_url, "filename": filename}
        if caption:
            document["caption"] = caption

        payload = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": to,
            "type": "document",
            "document": document,
        }
        return await self._post_with_retry(url, payload)

    async def send_image(
        self,
        to: str,
        media_url: str,
        caption: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Send an image via URL."""
        url = f"{WHATSAPP_API_URL}/{self.phone_number_id}/messages"
        image = {"link": media_url}
        if caption:
            image["caption"] = caption

        payload = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": to,
            "type": "image",
            "image": image,
        }
        return await self._post_with_retry(url, payload)

    async def send_template(
        self,
        to: str,
        template_name: str,
        language_code: str = "en_US",
        components: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        """Send a pre-approved template message (works outside 24h window)."""
        url = f"{WHATSAPP_API_URL}/{self.phone_number_id}/messages"
        template = {"name": template_name, "language": {"code": language_code}}
        if components:
            template["components"] = components

        payload = {
            "messaging_product": "whatsapp",
            "to": to,
            "type": "template",
            "template": template,
        }
        return await self._post_with_retry(url, payload)

    async def download_media(self, media_id: str) -> Optional[bytes]:
        """Download media (audio, image) by media ID. Returns raw bytes."""
        session = await self._get_session()
        try:
            # Step 1: get media URL
            meta_url = f"{WHATSAPP_API_URL}/{media_id}"
            async with session.get(meta_url) as resp:
                if resp.status != 200:
                    return None
                meta = await resp.json()
                media_url = meta.get("url")
                if not media_url:
                    return None

            # Step 2: download bytes
            async with session.get(media_url) as resp:
                if resp.status != 200:
                    return None
                return await resp.read()
        except Exception as e:
            logger.error(f"Media download failed for {media_id}: {e}")
            return None

    async def mark_as_read(self, message_id: str) -> Dict[str, Any]:
        """Mark a message as read."""
        url = f"{WHATSAPP_API_URL}/{self.phone_number_id}/messages"
        payload = {
            "messaging_product": "whatsapp",
            "status": "read",
            "message_id": message_id
        }
        return await self._post_with_retry(url, payload)

    # === Parsing Incoming Messages ===

    def parse_webhook_message(self, payload: Dict[str, Any]) -> Optional[WhatsAppMessage]:
        """Parse incoming webhook payload into a WhatsAppMessage."""
        try:
            entry_list = payload.get("entry") or [{}]
            if not entry_list:
                return None
            entry = entry_list[0]

            changes_list = entry.get("changes") or [{}]
            if not changes_list:
                return None
            changes = changes_list[0]
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
            list_reply_id = None
            audio_id = None
            image_id = None
            nfm_reply_data = None

            if msg_type == "text":
                text = msg.get("text", {}).get("body")
            elif msg_type == "interactive":
                interactive = msg.get("interactive", {})
                itype = interactive.get("type")
                if itype == "button_reply":
                    button_payload = interactive.get("button_reply", {}).get("id")
                    text = interactive.get("button_reply", {}).get("title")
                elif itype == "list_reply":
                    list_reply_id = interactive.get("list_reply", {}).get("id")
                    text = interactive.get("list_reply", {}).get("title")
                elif itype == "nfm_reply":
                    nfm_reply_data = interactive.get("nfm_reply", {}).get("response_json")
                    if isinstance(nfm_reply_data, str):
                        import json
                        try:
                            nfm_reply_data = json.loads(nfm_reply_data)
                        except Exception as e:
                            logger.debug(f"Failed to parse NFM reply JSON: {e}")
            elif msg_type == "audio":
                audio_id = msg.get("audio", {}).get("id")
            elif msg_type == "image":
                image_id = msg.get("image", {}).get("id")
                text = msg.get("image", {}).get("caption")

            return WhatsAppMessage(
                from_number=from_number,
                message_id=message_id,
                timestamp=timestamp,
                text=text,
                button_payload=button_payload,
                list_reply_id=list_reply_id,
                message_type=msg_type,
                audio_id=audio_id,
                image_id=image_id,
                nfm_reply_data=nfm_reply_data,
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
