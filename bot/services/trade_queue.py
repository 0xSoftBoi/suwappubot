"""SQS-backed trade queue for async swap processing."""

import json
import logging
import uuid
from typing import Optional
from dataclasses import dataclass, asdict
from datetime import datetime

logger = logging.getLogger(__name__)


@dataclass
class TradeMessage:
    """Trade message for queue processing."""
    user_id: int
    swap_params: dict  # Contains from_token, to_token, amount, chain, slippage, etc.
    idempotency_key: str
    timestamp: str
    priority: str = "normal"  # "normal" or "high"

    def to_json(self) -> str:
        return json.dumps(asdict(self))

    @classmethod
    def from_json(cls, data: str) -> "TradeMessage":
        return cls(**json.loads(data))


class TradeQueueService:
    """SQS-backed trade queue with inline fallback."""

    def __init__(self):
        self._sqs_client = None
        self._queue_url: Optional[str] = None
        self._dlq_url: Optional[str] = None
        self._initialized = False

    async def initialize(self, queue_url: Optional[str] = None, dlq_url: Optional[str] = None):
        """Initialize SQS client if queue URL is configured."""
        if not queue_url:
            logger.info("No SQS queue URL configured — trades will execute inline")
            return

        try:
            import boto3
            self._sqs_client = boto3.client("sqs", region_name="us-east-1")
            self._queue_url = queue_url
            self._dlq_url = dlq_url
            self._initialized = True
            logger.info(f"SQS trade queue initialized: {queue_url}")
        except Exception as e:
            logger.warning(f"Failed to initialize SQS: {e} — falling back to inline execution")
            self._initialized = False

    @property
    def is_available(self) -> bool:
        """Check if SQS queue is available."""
        return self._initialized and self._sqs_client is not None and self._queue_url is not None

    async def enqueue_trade(self, trade: TradeMessage) -> Optional[str]:
        """
        Enqueue a trade for async processing.

        Returns message ID on success, None on failure.
        """
        if not self.is_available:
            return None

        try:
            import asyncio
            loop = asyncio.get_event_loop()

            response = await loop.run_in_executor(
                None,
                lambda: self._sqs_client.send_message(
                    QueueUrl=self._queue_url,
                    MessageBody=trade.to_json(),
                    MessageGroupId=str(trade.user_id) if ".fifo" in (self._queue_url or "") else None,
                    MessageDeduplicationId=trade.idempotency_key if ".fifo" in (self._queue_url or "") else None,
                    MessageAttributes={
                        "priority": {
                            "DataType": "String",
                            "StringValue": trade.priority,
                        },
                        "user_id": {
                            "DataType": "Number",
                            "StringValue": str(trade.user_id),
                        },
                    },
                ),
            )

            message_id = response.get("MessageId")
            logger.info(f"Trade enqueued: {message_id} for user {trade.user_id}")
            return message_id

        except Exception as e:
            logger.error(f"Failed to enqueue trade: {e}")
            return None

    async def dequeue_trades(self, max_messages: int = 10) -> list[dict]:
        """
        Receive trades from queue for processing.

        Returns list of dicts with 'trade' (TradeMessage) and 'receipt_handle'.
        """
        if not self.is_available:
            return []

        try:
            import asyncio
            loop = asyncio.get_event_loop()

            response = await loop.run_in_executor(
                None,
                lambda: self._sqs_client.receive_message(
                    QueueUrl=self._queue_url,
                    MaxNumberOfMessages=min(max_messages, 10),
                    WaitTimeSeconds=5,  # Long polling
                    VisibilityTimeout=60,  # 60s to process
                    MessageAttributeNames=["All"],
                ),
            )

            messages = response.get("Messages", [])
            result = []
            for msg in messages:
                try:
                    trade = TradeMessage.from_json(msg["Body"])
                    result.append({
                        "trade": trade,
                        "receipt_handle": msg["ReceiptHandle"],
                        "message_id": msg["MessageId"],
                        "receive_count": int(msg.get("Attributes", {}).get("ApproximateReceiveCount", 1)),
                    })
                except Exception as e:
                    logger.error(f"Failed to parse trade message: {e}")

            return result

        except Exception as e:
            logger.error(f"Failed to dequeue trades: {e}")
            return []

    async def acknowledge(self, receipt_handle: str) -> bool:
        """Delete a processed message from the queue."""
        if not self.is_available:
            return False

        try:
            import asyncio
            loop = asyncio.get_event_loop()

            await loop.run_in_executor(
                None,
                lambda: self._sqs_client.delete_message(
                    QueueUrl=self._queue_url,
                    ReceiptHandle=receipt_handle,
                ),
            )
            return True
        except Exception as e:
            logger.error(f"Failed to acknowledge message: {e}")
            return False

    async def get_queue_depth(self) -> int:
        """Get approximate number of messages in the queue."""
        if not self.is_available:
            return 0

        try:
            import asyncio
            loop = asyncio.get_event_loop()

            response = await loop.run_in_executor(
                None,
                lambda: self._sqs_client.get_queue_attributes(
                    QueueUrl=self._queue_url,
                    AttributeNames=["ApproximateNumberOfMessages"],
                ),
            )

            return int(response.get("Attributes", {}).get("ApproximateNumberOfMessages", 0))
        except Exception as e:
            logger.error(f"Failed to get queue depth: {e}")
            return 0


# Global instance
trade_queue = TradeQueueService()
