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

# Whisper is billed per audio-minute. whisper-1 list price as of 2026-08-04.
_WHISPER_USD_PER_MINUTE = 0.006
# Low-end Opus bitrate for WhatsApp voice notes. Assuming the LOW end makes the
# duration estimate LONGER, which over-reserves budget rather than under.
_ASSUMED_OPUS_BITRATE_BPS = 16_000


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

        # 1b. Spend budget. Whisper is billed per audio-MINUTE, not per token,
        # so it needs its own cost basis — but it is real provider spend on the
        # same OpenAI key and was previously entirely unmetered and unbounded.
        allowed, est_usd = await self._reserve_transcription_budget(
            message.from_number, len(audio_bytes)
        )
        if not allowed:
            return (
                "Voice transcription is temporarily unavailable (daily limit reached). "
                "Please type your command instead."
            )

        # 2. Transcribe via OpenAI Whisper. There is no settle step: Whisper
        # returns no usage object, so the estimate IS the charge. On failure the
        # reservation is deliberately kept — the request may still have been
        # billed upstream, and refunding would make failures free.
        text = await self._transcribe(audio_bytes)
        if text is None:
            return (
                "Sorry, I couldn't transcribe your voice message. Please type your command instead."
            )
        self._log_transcription_cost(message.from_number, len(audio_bytes), est_usd)

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

    def _estimate_minutes(self, audio_bytes_len: int) -> float:
        """Estimated audio duration in minutes from the encoded byte count.

        WhatsApp voice notes are Opus in an OGG container, typically 16-24
        kbps. We assume the LOW end deliberately: a lower assumed bitrate
        yields a LONGER estimated duration, which over-reserves rather than
        under-reserves. "Round the price up" — see bot/config/llm_models.py.
        """
        bits = audio_bytes_len * 8
        return bits / (_ASSUMED_OPUS_BITRATE_BPS * 60.0)

    async def _reserve_transcription_budget(self, from_number, audio_bytes_len: int):
        """Reserve estimated Whisper spend. Returns (allowed, est_usd)."""
        try:
            from bot.config.settings import settings
            from bot.services import llm_credit_service
            from bot.utils.llm_budget import (
                GLOBAL_BUDGET_KEY,
                llm_budget,
                user_budget_key,
                usd_to_micros,
            )

            if not getattr(settings, "LLM_MULTI_PROVIDER_ENABLED", False):
                return True, 0.0

            minutes = self._estimate_minutes(audio_bytes_len)
            est_usd = minutes * _WHISPER_USD_PER_MINUTE
            micros = usd_to_micros(est_usd)

            key = user_budget_key(f"wa:{from_number}")
            user_cap = llm_credit_service.user_budget_capacity_micros()
            ok, _ = await llm_budget.try_consume(key, micros, user_cap)
            if not ok:
                return False, est_usd
            ok_global, _ = await llm_budget.try_consume(
                GLOBAL_BUDGET_KEY, micros, llm_credit_service.global_budget_capacity_micros()
            )
            if not ok_global:
                await llm_budget.refund(key, micros, user_cap)
                return False, est_usd
            return True, est_usd
        except Exception:
            # A budget failure must not take voice transcription offline.
            logger.exception("whatsapp_voice: transcription budget check failed")
            return True, 0.0

    def _log_transcription_cost(self, from_number, audio_bytes_len: int, est_usd: float) -> None:
        logger.info(
            "llm_cost provider=openai model=%s audio_bytes=%d est_usd=%.6f metered=False",
            WHISPER_MODEL,
            audio_bytes_len,
            est_usd,
            extra={
                "event": "llm_cost",
                "user_key": f"wa:{from_number}",
                "provider": "openai",
                "model": WHISPER_MODEL,
                "audio_bytes": audio_bytes_len,
                "raw_cost_usd": est_usd,
                "usage_source": "estimated",
            },
        )

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
                    logger.error(f"Whisper API error {resp.status_code}: {resp.text[:200]}")
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
