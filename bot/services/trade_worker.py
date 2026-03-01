"""Trade worker that processes swaps from SQS queue."""

import asyncio
import logging
import time
from typing import Optional

from bot.services.trade_queue import trade_queue, TradeMessage

logger = logging.getLogger(__name__)


class TradeWorker:
    """Worker that polls SQS and executes swaps."""

    def __init__(self, concurrency: int = 5, max_retries: int = 3):
        self._concurrency = concurrency
        self._max_retries = max_retries
        self._running = False
        self._task: Optional[asyncio.Task] = None
        self._semaphore: Optional[asyncio.Semaphore] = None
        self._processed_count = 0
        self._error_count = 0
        self._start_time: Optional[float] = None

    async def start(self):
        """Start the trade worker."""
        if self._running:
            return

        if not trade_queue.is_available:
            logger.info("Trade queue not available — worker not started")
            return

        self._running = True
        self._semaphore = asyncio.Semaphore(self._concurrency)
        self._start_time = time.time()
        self._task = asyncio.create_task(self._poll_loop())
        logger.info(f"Trade worker started (concurrency={self._concurrency})")

    async def stop(self):
        """Stop the trade worker."""
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info(
            f"Trade worker stopped. Processed: {self._processed_count}, "
            f"Errors: {self._error_count}"
        )

    async def _poll_loop(self):
        """Main polling loop."""
        while self._running:
            try:
                messages = await trade_queue.dequeue_trades(max_messages=self._concurrency)

                if not messages:
                    # No messages — short sleep before next poll
                    await asyncio.sleep(1)
                    continue

                # Process messages concurrently with semaphore
                tasks = [
                    self._process_message(msg)
                    for msg in messages
                ]
                await asyncio.gather(*tasks, return_exceptions=True)

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Trade worker poll error: {e}")
                await asyncio.sleep(5)

    async def _process_message(self, message: dict):
        """Process a single trade message."""
        async with self._semaphore:
            trade: TradeMessage = message["trade"]
            receipt_handle = message["receipt_handle"]
            receive_count = message.get("receive_count", 1)

            try:
                logger.info(
                    f"Processing trade for user {trade.user_id}: "
                    f"{trade.swap_params.get('from_token', '?')} → {trade.swap_params.get('to_token', '?')}"
                )

                # Execute the swap
                await self._execute_trade(trade)

                # Acknowledge successful processing
                await trade_queue.acknowledge(receipt_handle)
                self._processed_count += 1

            except Exception as e:
                self._error_count += 1
                logger.error(f"Trade processing failed for user {trade.user_id}: {e}")

                if receive_count >= self._max_retries:
                    # Message will go to DLQ after max retries
                    logger.warning(
                        f"Trade for user {trade.user_id} exceeded max retries ({self._max_retries}). "
                        f"Message will move to DLQ."
                    )
                    # Acknowledge to prevent further retries (SQS DLQ handles this)
                    await trade_queue.acknowledge(receipt_handle)

    async def _execute_trade(self, trade: TradeMessage):
        """Execute a trade via the swap engine."""
        from bot.services.swap_engine import SwapEngine

        swap_engine = SwapEngine()
        params = trade.swap_params

        # Execute the swap using the swap engine
        # The swap engine handles all provider routing, MEV protection, etc.
        result = await swap_engine.execute_swap(
            user_id=trade.user_id,
            from_token=params.get("from_token"),
            to_token=params.get("to_token"),
            amount=params.get("amount"),
            from_chain=params.get("from_chain"),
            to_chain=params.get("to_chain"),
            slippage=params.get("slippage", 0.5),
            wallet_id=params.get("wallet_id"),
            idempotency_key=trade.idempotency_key,
        )

        if not result or result.get("status") == "failed":
            raise Exception(f"Swap failed: {result.get('error', 'unknown')}")

        logger.info(f"Trade executed successfully for user {trade.user_id}: {result.get('tx_hash', 'pending')}")

    def get_stats(self) -> dict:
        """Get worker statistics."""
        uptime = time.time() - self._start_time if self._start_time else 0
        return {
            "running": self._running,
            "processed": self._processed_count,
            "errors": self._error_count,
            "uptime_seconds": round(uptime),
            "success_rate": (
                round(self._processed_count / (self._processed_count + self._error_count) * 100, 1)
                if (self._processed_count + self._error_count) > 0
                else 100.0
            ),
        }


# Global instance
trade_worker = TradeWorker()
