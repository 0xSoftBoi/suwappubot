"""Progress tracking for long-running operations."""

import asyncio
import logging
from typing import Optional, List, Callable
from telegram import Message
from datetime import datetime, timezone

logger = logging.getLogger(__name__)


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
    
    async def update(self):
        """Update the message with current progress."""
        try:
            await self.message.edit_text(
                self._build_message(),
                parse_mode="Markdown",
            )
        except Exception as e:
            logger.debug(f"Progress update failed: {e}")
    
    async def next_step(self):
        """Move to the next step."""
        if self.current_step < len(self.steps):
            self.current_step += 1
            await self.update()
    
    async def complete(self, success_message: str = None):
        """Mark operation as complete."""
        self.current_step = len(self.steps)
        
        if success_message:
            try:
                await self.message.edit_text(success_message, parse_mode="Markdown")
            except Exception:
                pass
    
    async def fail(self, error_message: str):
        """Mark operation as failed."""
        text = f"❌ *{self.title} Failed*\n\n{error_message}"
        try:
            await self.message.edit_text(text, parse_mode="Markdown")
        except Exception:
            pass


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

