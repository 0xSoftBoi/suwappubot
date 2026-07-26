"""Progress tracking for long-running operations."""

import asyncio
import logging
import time
from typing import Optional, List, Callable
from telegram import Message
from telegram.error import RetryAfter
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

# Telegram rate-limits editMessageText per chat — throttle intermediate
# progress edits so a fast sequence of stage transitions can't trigger a 429.
# The FINAL edit (complete()/fail()) always bypasses this: the receipt landing
# matters far more than the progress bar being perfectly up to date.
MIN_EDIT_INTERVAL_SECONDS = 1.0


class ProgressTracker:
    """Track and display progress for long-running operations."""

    def __init__(
        self,
        message: Message,
        steps: List[str],
        title: str = "Processing...",
    ):
        """
        Initialize progress tracker.

        Args:
            message: Telegram message to update
            steps: List of step descriptions
            title: Title to display
        """
        self.message = message
        self.steps = steps
        self.title = title
        self.current_step = 0
        self._start_time = datetime.now(timezone.utc)
        self._update_task: Optional[asyncio.Task] = None
        self._last_edit_at: Optional[float] = None

    def _build_message(self) -> str:
        """Build the progress message."""
        lines = [f"⏳ *{self.title}*\n"]

        for i, step in enumerate(self.steps):
            if i < self.current_step:
                lines.append(f"✅ {step}")
            elif i == self.current_step:
                lines.append(f"🔄 {step}...")
            else:
                lines.append(f"⬜ {step}")

        # Add elapsed time
        elapsed = (datetime.now(timezone.utc) - self._start_time).total_seconds()
        lines.append(f"\n⏱ {elapsed:.0f}s")

        return "\n".join(lines)

    async def update(self, force: bool = False):
        """Update the message with current progress.

        Throttled to at most one edit per MIN_EDIT_INTERVAL_SECONDS unless
        ``force=True``. If two stages complete within the throttle window,
        the intermediate edit is skipped (not queued) — the next call still
        reflects the current (later) step, so no progress is lost, only its
        display is coalesced.
        """
        now = time.monotonic()
        if not force and self._last_edit_at is not None:
            if (now - self._last_edit_at) < MIN_EDIT_INTERVAL_SECONDS:
                logger.debug("Skipping progress edit (throttled)")
                return

        self._last_edit_at = now
        try:
            await self.message.edit_text(
                self._build_message(),
                parse_mode="Markdown",
            )
        except Exception as e:
            # A failed edit (rate limit, "message is not modified", network
            # blip) must never abort the caller's operation.
            logger.debug(f"Progress update failed: {e}")

    async def next_step(self):
        """Move to the next step (throttled — see update())."""
        if self.current_step < len(self.steps):
            self.current_step += 1
            await self.update()

    async def complete(self, success_message: str = None, reply_markup=None):
        """Mark operation as complete.

        Always bypasses the throttle (``force=True`` semantics) — the final
        edit that replaces the progress bar with the receipt must land
        regardless of how recently the last stage edit fired.
        """
        self.current_step = len(self.steps)

        if success_message:
            await self._final_edit(success_message, reply_markup)

    async def fail(self, error_message: str, reply_markup=None):
        """Mark operation as failed. Always bypasses the throttle."""
        await self._final_edit(f"❌ *{self.title} Failed*\n\n{error_message}", reply_markup)

    async def _final_edit(self, text: str, reply_markup) -> None:
        """Land the terminal message, retrying without Markdown if needed.

        This edit is the ONLY thing that tells the user the operation
        finished. If it silently fails, a *successful* swap leaves the message
        frozen mid-progress with no transaction details — so the user has no
        signal it landed and may submit again. Hence the retries: once more
        after a rate-limit delay, then once as plain text in case the payload
        failed to parse as Markdown.
        """
        try:
            await self.message.edit_text(text, parse_mode="Markdown", reply_markup=reply_markup)
            self._last_edit_at = time.monotonic()
            return
        except RetryAfter as e:
            await asyncio.sleep(getattr(e, "retry_after", 1))
            try:
                await self.message.edit_text(text, parse_mode="Markdown", reply_markup=reply_markup)
                self._last_edit_at = time.monotonic()
                return
            except Exception as retry_error:
                logger.warning(f"Progress final edit failed after flood wait: {retry_error}")
        except Exception as e:
            logger.warning(f"Progress final edit failed ({e}); retrying as plain text")

        try:
            await self.message.edit_text(text, reply_markup=reply_markup)
            self._last_edit_at = time.monotonic()
        except Exception as e:
            logger.error(f"Progress final edit failed permanently: {e}")


class SwapProgressTracker(ProgressTracker):
    """Specialized progress tracker for swap operations."""

    STEPS = [
        "Validating quote",
        "Checking balance",
        "Preparing transaction",
        "Signing transaction",
        "Broadcasting to network",
    ]

    def __init__(self, message: Message, is_cross_chain: bool = False):
        steps = self.STEPS.copy()
        if is_cross_chain:
            steps.append("Initiating bridge")

        super().__init__(message, steps, title="Executing Swap")


class WithdrawalProgressTracker(ProgressTracker):
    """Specialized progress tracker for withdrawal operations."""

    STEPS = [
        "Validating request",
        "Checking balance",
        "Preparing withdrawal",
        "Signing transaction",
        "Broadcasting to network",
    ]

    def __init__(self, message: Message):
        super().__init__(message, self.STEPS, title="Processing Withdrawal")


async def with_progress(
    message: Message,
    operation: Callable,
    steps: List[str],
    title: str = "Processing...",
    *args,
    **kwargs,
):
    """
    Execute an operation with progress tracking.

    Args:
        message: Message to update
        operation: Async function to execute
        steps: Progress steps
        title: Progress title
        *args, **kwargs: Arguments to pass to operation
    """
    tracker = ProgressTracker(message, steps, title)
    await tracker.update()

    try:
        result = await operation(tracker, *args, **kwargs)
        return result
    except Exception as e:
        await tracker.fail(str(e))
        raise
