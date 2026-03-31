"""Voice message handler — transcribes WhatsApp audio and returns text.

Downloads the audio via the WhatsApp Media API, sends it to OpenAI Whisper
for transcription, and returns the resulting text so the router can feed it
back through the normal command flow.
"""

import io
import logging
import os
from typing import Optional

import httpx

from bot.services.whatsapp_service import WhatsAppMessage, whatsapp_service

logger = logging.getLogger(__name__)

OPENAI_TRANSCRIPTION_URL = "https://api.openai.com/v1/audio/transcriptions"
WHISPER_MODEL = "whisper-1"

# Maximum audio size we'll accept (25 MB — OpenAI limit)
_MAX_AUDIO_BYTES = 25 * 1024 * 1024


class WhatsAppVoiceHandler:
    """Handles voice messages by transcribing and routing as text."""

    def __init__(self):
        self._api_key: Optional[str] = os.environ.get("OPENAI_API_KEY")

    @property
    def is_configured(self) -> bool:
        """True when an OpenAI API key is available for transcription."""
        return bool(self._api_key)

    async def handle_voice(self, message: WhatsAppMessage) -> Optional[str]:
        """Download audio, transcribe via Whisper, return text.

        Returns the transcribed text on success, or a user-friendly error
        string if something went wrong.  Returns ``None`` only when there is
        no audio to process (missing ``audio_id``).
        """
        if not message.audio_id:
            return None

        if not self.is_configured:
            logger.warning("Voice message received but OPENAI_API_KEY is not set")
            return (
                "Voice messages require an OpenAI API key for transcription. "
                "Please type your command instead."
            )

        # 1. Download audio bytes from WhatsApp
        audio_bytes = await self._download_audio(message.audio_id)
        if audio_bytes is None:
            return "Sorry, I couldn't download your voice message. Please try again."

        if len(audio_bytes) > _MAX_AUDIO_BYTES:
            return "Voice message is too large (max 25 MB). Please send a shorter recording."

        # 2. Transcribe via OpenAI Whisper
        text = await self._transcribe(audio_bytes)
        if text is None:
            return "Sorry, I couldn't transcribe your voice message. Please type your command instead."

        text = text.strip()
        if not text:
            return "I couldn't make out any words in your voice message. Please try again or type your command."

        logger.info(
            f"Voice transcription for {message.from_number}: "
            f"{text[:80]}{'...' if len(text) > 80 else ''}"
        )
        return text

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _download_audio(self, audio_id: str) -> Optional[bytes]:
        """Download audio bytes using the WhatsApp media API."""
        try:
            data = await whatsapp_service.download_media(audio_id)
            if data is None:
                logger.error(f"WhatsApp media download returned None for {audio_id}")
            return data
        except Exception as e:
            logger.error(f"Failed to download audio {audio_id}: {e}")
            return None

    async def _transcribe(self, audio_bytes: bytes) -> Optional[str]:
        """Send audio to OpenAI Whisper and return the transcribed text."""
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                files = {
                    "file": ("voice.ogg", io.BytesIO(audio_bytes), "audio/ogg"),
                }
                data = {
                    "model": WHISPER_MODEL,
                }
                headers = {
                    "Authorization": f"Bearer {self._api_key}",
                }

                resp = await client.post(
                    OPENAI_TRANSCRIPTION_URL,
                    headers=headers,
                    files=files,
                    data=data,
                )

                if resp.status_code != 200:
                    logger.error(
                        f"Whisper API error {resp.status_code}: {resp.text[:200]}"
                    )
                    return None

                result = resp.json()
                return result.get("text")

        except httpx.TimeoutException:
            logger.error("Whisper API request timed out")
            return None
        except Exception as e:
            logger.error(f"Whisper transcription error: {e}")
            return None


# Singleton
voice_handler = WhatsAppVoiceHandler()
