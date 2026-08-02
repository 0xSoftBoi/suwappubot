"""AEGIS scanner service — Phase 1 of docs/plans/aegis-fork-extend.md.

Thin, fail-open wrapper around the aegis-shield Shield used by every inbound
seam (Telegram, WhatsApp, agent NL API, LLM pre-flight). OBSERVE MODE ONLY in
Phase 1: scan() never blocks anything and never raises — it returns a verdict
the caller may log or (in later phases) act on.

Failure policy: if aegis-shield is not installed, the config is missing, or a
scan errors, the service degrades to "no threat" verdicts. The bot must boot
and serve traffic without AEGIS. Detections are mirrored to app logs at
WARNING level because Railway retains logs while the container-local
`.aegis/telemetry.jsonl` does not survive redeploys.
"""

import logging
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional

logger = logging.getLogger(__name__)

# Repo root: bot/services/aegis_service.py -> bot/services -> bot -> root
_REPO_ROOT = Path(__file__).resolve().parents[2]
_CONFIG_PATH = _REPO_ROOT / "bot" / "config" / "aegis.yaml"

# Bound regex work on pathological inputs; Telegram caps messages at 4096
# chars, WhatsApp ~64KB, agent API is schema-capped — 16k covers all real text.
_MAX_SCAN_CHARS = 16_384


@dataclass
class AegisVerdict:
    """Outcome of a scan. `is_threat` is advisory in Phase 1 (observe mode)."""

    is_threat: bool = False
    score: float = 0.0
    signature_ids: List[str] = field(default_factory=list)
    categories: List[str] = field(default_factory=list)
    scanned: bool = False  # False when AEGIS is unavailable or errored
    elapsed_ms: float = 0.0


_CLEAN = AegisVerdict()


class AegisService:
    """Singleton wrapper around an observe-mode aegis Shield."""

    def __init__(self) -> None:
        self._shield = None
        self._init_attempted = False

    def _ensure_shield(self):
        if self._init_attempted:
            return self._shield
        self._init_attempted = True
        try:
            from bot.config.settings import settings

            if not getattr(settings, "AEGIS_ENABLED", True):
                logger.info("AEGIS disabled via settings (AEGIS_ENABLED=false)")
                return None
            from aegis import Shield

            self._shield = Shield(policy=str(_CONFIG_PATH), mode="observe")
            self._log_signature_inventory()
        except Exception:
            # Missing dep, bad config, anything — the bot serves without AEGIS.
            logger.exception("AEGIS unavailable — scans disabled (fail-open)")
            self._shield = None
        return self._shield

    def _log_signature_inventory(self) -> None:
        try:
            scanner = getattr(self._shield, "_scanner", None)
            matcher = getattr(scanner, "_pattern_matcher", None)
            sigs = getattr(matcher, "_signatures", []) or []
            custom = [s for s in sigs if s.id.startswith("SW-")]
            if custom:
                logger.info(
                    "AEGIS scanner ready: %d signatures (%d Suwappu crypto pack)",
                    len(sigs),
                    len(custom),
                )
            else:
                logger.error(
                    "AEGIS scanner ready but the Suwappu crypto pack did NOT load "
                    "(%d bundled signatures only) — check cwd-relative path in %s",
                    len(sigs),
                    _CONFIG_PATH,
                )
        except Exception:
            logger.debug("AEGIS signature inventory check failed", exc_info=True)

    def _to_verdict(self, result, text: str, elapsed_ms: float) -> AegisVerdict:
        verdict = AegisVerdict(
            is_threat=bool(result.is_threat),
            score=float(result.threat_score),
            scanned=True,
            elapsed_ms=elapsed_ms,
        )
        if verdict.is_threat:
            # Shield's result only carries a match count; re-run the pattern
            # matcher (pure regex, ~1ms) to name the signatures for telemetry.
            # Only happens on detections, so the hot path stays single-scan.
            try:
                scanner_result = self._shield._scanner.scan_input(text)
                verdict.signature_ids = [m.signature_id for m in scanner_result.matches]
                verdict.categories = sorted({m.category for m in scanner_result.matches})
            except Exception:
                logger.debug("AEGIS signature-id extraction failed", exc_info=True)
        return verdict

    def _log_verdict(self, verdict: AegisVerdict, source: str, user_id: Optional[str]) -> None:
        if verdict.is_threat:
            logger.warning(
                "AEGIS threat detected source=%s user=%s score=%.2f signatures=%s categories=%s",
                source,
                user_id or "-",
                verdict.score,
                ",".join(verdict.signature_ids) or "-",
                ",".join(verdict.categories) or "-",
            )

    def scan(self, text: str, source: str, user_id: Optional[str] = None) -> AegisVerdict:
        """Scan text synchronously. Never raises; returns a clean verdict on failure."""
        shield = self._ensure_shield()
        if shield is None or not text:
            return _CLEAN
        text = text[:_MAX_SCAN_CHARS]
        try:
            t0 = time.perf_counter()
            result = shield.scan_input(text, source_agent_id=source)
            verdict = self._to_verdict(result, text, (time.perf_counter() - t0) * 1000)
            self._log_verdict(verdict, source, user_id)
            return verdict
        except Exception:
            logger.exception("AEGIS scan failed (fail-open) source=%s", source)
            return _CLEAN

    async def ascan(self, text: str, source: str, user_id: Optional[str] = None) -> AegisVerdict:
        """Async scan for event-loop contexts. Never raises."""
        shield = self._ensure_shield()
        if shield is None or not text:
            return _CLEAN
        text = text[:_MAX_SCAN_CHARS]
        try:
            t0 = time.perf_counter()
            result = await shield.ascan_input(text, source_agent_id=source)
            verdict = self._to_verdict(result, text, (time.perf_counter() - t0) * 1000)
            self._log_verdict(verdict, source, user_id)
            return verdict
        except Exception:
            logger.exception("AEGIS scan failed (fail-open) source=%s", source)
            return _CLEAN


_instance: Optional[AegisService] = None


def get_aegis() -> AegisService:
    global _instance
    if _instance is None:
        _instance = AegisService()
    return _instance
