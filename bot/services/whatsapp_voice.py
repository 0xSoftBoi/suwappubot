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
        allowed, reserved_micros, est_usd = await self._reserve_transcription_budget(
            message.from_number, len(audio_bytes)
        )
        if not allowed:
            return (
                "Voice transcription is temporarily unavailable (daily limit reached). "
                "Please type your command instead."
            )

        # 2. Transcribe via OpenAI Whisper, then settle the reservation against
        # the REAL duration the API reports. On failure the reservation is
        # deliberately kept — the request may still have been billed upstream,
        # and refunding would make failures free.
        text, duration_s = await self._transcribe(audio_bytes)
        if text is None:
            return (
                "Sorry, I couldn't transcribe your voice message. Please type your command instead."
            )
        actual_usd = est_usd
        if duration_s is not None:
            actual_usd = (duration_s / 60.0) * _WHISPER_USD_PER_MINUTE
        await self._settle_transcription_budget(message.from_number, reserved_micros, actual_usd)
        self._log_transcription_cost(message.from_number, len(audio_bytes), actual_usd, duration_s)

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
        """Reserve estimated Whisper spend. Returns (allowed, reserved_micros, est_usd).

        Whisper is priced per audio-minute rather than per token, so the cost
        basis is computed here — but the two-bucket reserve-and-unwind itself
        is `llm_credit_service.reserve_spend`, shared with the token-priced
        LLM path so the two can't drift apart.
        """
        try:
            from bot.services import llm_credit_service

            # Gated on the BUDGET settings, not the model-catalog flag: Whisper
            # runs on OPENAI_API_KEY and has nothing to do with multi-provider
            # routing, so tying it to that flag would leave it unmetered by
            # default — exactly the hole this closes.
            # Cost is computed even when the budget is disabled: the spend is
            # real either way, and reporting $0 would silently undercount
            # OpenAI usage in invoice reconciliation.
            est_usd = self._estimate_minutes(audio_bytes_len) * _WHISPER_USD_PER_MINUTE
            if (
                llm_credit_service.user_budget_capacity_micros() <= 0
                and llm_credit_service.global_budget_capacity_micros() <= 0
            ):
                return True, 0, est_usd
            # `wa:` namespaces the bucket away from Telegram ids and DB user
            # ids, which share the same integer space.
            # Tier is resolved so paying subscribers get the same tier-scaled
            # headroom as on the Telegram path instead of the FREE ceiling.
            tier = await self._resolve_tier(from_number)
            allowed, reserved = await llm_credit_service.reserve_spend(
                f"wa:{from_number}", est_usd, tier
            )
            return allowed, reserved, est_usd
        except Exception:
            # A budget failure must not take voice transcription offline.
            logger.exception("whatsapp_voice: transcription budget check failed")
            return True, 0, 0.0

    async def _resolve_tier(self, from_number):
        """Subscription tier for a WhatsApp sender, or None if unknown."""
        try:
            from bot.services import llm_credit_service

            ctx = await llm_credit_service.get_whatsapp_user_context(from_number)
            return ctx.tier if ctx else None
        except Exception:
            logger.debug("whatsapp_voice: tier lookup failed", exc_info=True)
            return None

    async def _settle_transcription_budget(self, from_number, reserved_micros: int, actual_usd):
        """Reconcile the reservation against real billed duration."""
        if not reserved_micros:
            return
        try:
            from bot.services import llm_credit_service

            tier = await self._resolve_tier(from_number)
            await llm_credit_service.settle_budget(
                f"wa:{from_number}", reserved_micros, actual_usd, tier
            )
        except Exception:
            logger.exception("whatsapp_voice: transcription budget settle failed")

    def _log_transcription_cost(
        self, from_number, audio_bytes_len: int, cost_usd: float, duration_s=None
    ) -> None:
        source = "provider" if duration_s is not None else "estimated"
        logger.info(
            "llm_cost provider=openai model=%s audio_bytes=%d duration_s=%s "
            "raw_usd=%.6f source=%s metered=False",
            WHISPER_MODEL,
            audio_bytes_len,
            f"{duration_s:.1f}" if duration_s is not None else "?",
            cost_usd,
            source,
            extra={
                "event": "llm_cost",
                "user_key": f"wa:{from_number}",
                "provider": "openai",
                "model": WHISPER_MODEL,
                "audio_bytes": audio_bytes_len,
                "duration_seconds": duration_s,
                "raw_cost_usd": cost_usd,
                "usage_source": source,
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

    async def _transcribe(self, audio_bytes: bytes):
        """Send audio to OpenAI Whisper.

        Returns (text, duration_seconds). `verbose_json` is requested purely so
        the response carries the REAL audio duration: Whisper bills per second,
        and inferring duration from byte count is codec-dependent — the sender
        chooses the codec, so a low-bitrate format (AMR-NB, or Opus with DTX
        comfort-noise frames) can hold many times more audio in the same bytes
        than any fixed-bitrate assumption predicts.
        """
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                files = {
                    "file": ("voice.ogg", io.BytesIO(audio_bytes), "audio/ogg"),
                }
                data = {
                    "model": WHISPER_MODEL,
                    "response_format": "verbose_json",
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
                    return None, None

                result = resp.json()
                duration = result.get("duration")
                try:
                    duration = float(duration) if duration is not None else None
                except (TypeError, ValueError):
                    duration = None
                return result.get("text"), duration

        except httpx.TimeoutException:
            logger.error("Whisper API request timed out")
            return None, None
        except Exception as e:
            logger.error(f"Whisper transcription error: {e}")
            return None, None


# Singleton
voice_handler = WhatsAppVoiceHandler()
