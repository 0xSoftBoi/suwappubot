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

import asyncio
import logging
import re
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional

from bot.utils.validators import detect_address_chain

logger = logging.getLogger(__name__)

# Repo root: bot/services/aegis_service.py -> bot/services -> bot -> root
_REPO_ROOT = Path(__file__).resolve().parents[2]
_CONFIG_PATH = _REPO_ROOT / "bot" / "config" / "aegis.yaml"

# --- Quarantine federation (Phase 2.1) --------------------------------------
#
# Reports go ONLY to BlacklistService.report_scam — never add_to_blacklist.
# report_scam is a report, not a block; the store's own quorum/threshold
# logic (or a human) decides whether a reported address ever gets blocked.
# This keeps a noisy/miscalibrated observe-mode signature from being able to
# hard-block a real token on its own.
_AEGIS_REPORTER_ID = "aegis-scanner"

# High-precision gate: broad social_engineering chatter with an address
# nearby is NOT reported (too FP-prone — e.g. "send funds to this address
# instead" next to someone's own legit deposit address). Only two narrow
# signals are trusted enough to persist as a report:
#   - category credential_extraction (seed phrase / private key solicitation)
#   - the SW-04x address-substitution pack (SW-040/SW-041), which is about a
#     *substituted* address specifically, even though its signature category
#     is social_engineering like the rest of the crypto pack.
_HIGH_PRECISION_CATEGORIES = {"credential_extraction"}
_ADDRESS_SUBSTITUTION_SIGNATURE_PREFIX = "SW-04"

# Heuristic candidate-address extraction for free text (paste-to-trade's
# detect_address_chain expects the *whole* string to be an address; scam text
# has an address embedded in a sentence). Not exhaustive — good enough to gate
# a report, not to enumerate every address in a payload. detect_address_chain
# does the real validation; this just finds substrings worth checking.
_CANDIDATE_ADDRESS_RE = re.compile(r"0x[0-9a-fA-F]{40,64}|[1-9A-HJ-NP-Za-km-z]{32,44}")


def _extract_candidate_addresses(text: str) -> List[str]:
    seen: List[str] = []
    for match in _CANDIDATE_ADDRESS_RE.finditer(text):
        candidate = match.group(0)
        if candidate in seen:
            continue
        is_valid, _chain = detect_address_chain(candidate)
        if is_valid:
            seen.append(candidate)
    return seen


# Bound regex work on pathological inputs without silently skipping suffix
# content: text is scanned in bounded chunks (with a small overlap so a
# signature spanning a boundary still matches) and the chunk verdicts are
# merged. Telegram caps messages at 4096 chars, WhatsApp ~64KB — the total
# cap covers every real payload.
_CHUNK_CHARS = 16_384
_CHUNK_OVERLAP = 256
_MAX_TOTAL_SCAN_CHARS = 131_072


def _iter_chunks(text: str):
    text = text[:_MAX_TOTAL_SCAN_CHARS]
    step = _CHUNK_CHARS - _CHUNK_OVERLAP
    for start in range(0, len(text), step):
        yield text[start : start + _CHUNK_CHARS]
        if start + _CHUNK_CHARS >= len(text):
            break


@dataclass
class AegisVerdict:
    """Outcome of a scan. `is_threat` is advisory in Phase 1 (observe mode)."""

    is_threat: bool = False
    score: float = 0.0
    signature_ids: List[str] = field(default_factory=list)
    categories: List[str] = field(default_factory=list)
    scanned: bool = False  # False when AEGIS is unavailable or errored
    elapsed_ms: float = 0.0


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

    def _merge_chunk(self, verdict: AegisVerdict, result, chunk: str) -> None:
        """Fold one chunk's Shield result into the aggregate verdict."""
        verdict.score = max(verdict.score, float(result.threat_score))
        if result.is_threat:
            verdict.is_threat = True
            # Shield's result only carries a match count; re-run the pattern
            # matcher (pure regex, ~1ms) to name the signatures for telemetry.
            # Only happens on detections, so the hot path stays single-scan.
            try:
                scanner_result = self._shield._scanner.scan_input(chunk)
                verdict.signature_ids.extend(
                    m.signature_id
                    for m in scanner_result.matches
                    if m.signature_id not in verdict.signature_ids
                )
                verdict.categories = sorted(
                    set(verdict.categories) | {m.category for m in scanner_result.matches}
                )
            except Exception:
                logger.debug("AEGIS signature-id extraction failed", exc_info=True)

    @staticmethod
    def _is_high_precision_threat(verdict: AegisVerdict) -> bool:
        """Gate for BlacklistService reporting — see module-level comment."""
        if any(cat in _HIGH_PRECISION_CATEGORIES for cat in verdict.categories):
            return True
        return any(
            sig_id.startswith(_ADDRESS_SUBSTITUTION_SIGNATURE_PREFIX)
            for sig_id in verdict.signature_ids
        )

    @staticmethod
    def _report_reason(verdict: AegisVerdict) -> str:
        return (
            f"AEGIS observe-mode detection score={verdict.score:.2f} "
            f"signatures={','.join(verdict.signature_ids) or '-'} "
            f"categories={','.join(verdict.categories) or '-'}"
        )

    async def _maybe_report_scam(self, text: str, verdict: AegisVerdict) -> None:
        """Federate a high-precision threat verdict into BlacklistService.report_scam.

        Fail-open and non-blocking by construction: every failure mode (no
        address found, blacklist_service unimportable, report_scam raising)
        is swallowed here so a scam-report hiccup can never take down the
        scan path. Only ever calls report_scam — never add_to_blacklist; the
        store's own quorum/threshold logic owns the decision to block.
        """
        if not verdict.is_threat or not self._is_high_precision_threat(verdict):
            return
        try:
            addresses = _extract_candidate_addresses(text)
            if not addresses:
                return
            from bot.services.token_security.blacklist_service import blacklist_service

            reason = self._report_reason(verdict)
            for address in addresses:
                await blacklist_service.report_scam(
                    token_mint=address,
                    reporter_id=_AEGIS_REPORTER_ID,
                    reason=reason,
                )
        except Exception:
            logger.debug("AEGIS scam-report failed (fail-open)", exc_info=True)

    def _schedule_report_scam(self, text: str, verdict: AegisVerdict) -> None:
        """Sync-context counterpart to `_maybe_report_scam` (used by `scan()`).

        `scan()` can't await, so this schedules the coroutine on a running
        event loop if one exists (fire-and-forget — never awaited here, so it
        can't add latency to the sync scan path) and otherwise skips with a
        debug log. Never spins up a nested loop and never raises.
        """
        if not verdict.is_threat or not self._is_high_precision_threat(verdict):
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            logger.debug("AEGIS scam-report skipped: no running event loop for sync scan()")
            return
        try:
            task = loop.create_task(self._maybe_report_scam(text, verdict))
            task.add_done_callback(self._log_background_report_failure)
        except Exception:
            logger.debug("AEGIS scam-report scheduling failed (fail-open)", exc_info=True)

    @staticmethod
    def _log_background_report_failure(task: "asyncio.Task") -> None:
        try:
            task.result()
        except Exception:
            logger.debug("AEGIS background scam-report task failed", exc_info=True)

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
            return AegisVerdict()
        try:
            t0 = time.perf_counter()
            verdict = AegisVerdict(scanned=True)
            for chunk in _iter_chunks(text):
                result = shield.scan_input(chunk, source_agent_id=source)
                self._merge_chunk(verdict, result, chunk)
            verdict.elapsed_ms = (time.perf_counter() - t0) * 1000
            self._log_verdict(verdict, source, user_id)
            self._schedule_report_scam(text, verdict)
            return verdict
        except Exception:
            logger.exception("AEGIS scan failed (fail-open) source=%s", source)
            return AegisVerdict()

    async def ascan(self, text: str, source: str, user_id: Optional[str] = None) -> AegisVerdict:
        """Async scan for event-loop contexts. Never raises."""
        shield = self._ensure_shield()
        if shield is None or not text:
            return AegisVerdict()
        try:
            t0 = time.perf_counter()
            verdict = AegisVerdict(scanned=True)
            for chunk in _iter_chunks(text):
                result = await shield.ascan_input(chunk, source_agent_id=source)
                self._merge_chunk(verdict, result, chunk)
            verdict.elapsed_ms = (time.perf_counter() - t0) * 1000
            self._log_verdict(verdict, source, user_id)
            await self._maybe_report_scam(text, verdict)
            return verdict
        except Exception:
            logger.exception("AEGIS scan failed (fail-open) source=%s", source)
            return AegisVerdict()


_instance: Optional[AegisService] = None


def get_aegis() -> AegisService:
    global _instance
    if _instance is None:
        _instance = AegisService()
    return _instance
