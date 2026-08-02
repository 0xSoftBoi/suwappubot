"""
Push notification service using Expo Push API.

Sends push notifications to iOS/Android users who have registered
their Expo push token via the mobile app.
"""

import logging
import httpx

logger = logging.getLogger(__name__)

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"


async def send_push_notification(
    push_token: str,
    title: str,
    body: str,
    data: dict | None = None,
    category: str | None = None,
) -> bool:
    """
    Send a push notification via Expo Push API.

    Args:
        push_token: Expo push token (ExponentPushToken[...])
        title: Notification title
        body: Notification body text
        data: Optional data payload for deep linking
        category: Optional notification category for actionable notifications

    Returns:
        True if sent successfully, False otherwise
    """
    if not push_token or not push_token.startswith("ExponentPushToken"):
        logger.warning(f"Invalid push token format: {push_token[:20] if push_token else 'None'}...")
        return False

    payload = {
        "to": push_token,
        "title": title,
        "body": body,
        "sound": "default",
    }

    if data:
        payload["data"] = data
    if category:
        payload["categoryId"] = category

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(EXPO_PUSH_URL, json=payload)
            if response.status_code == 200:
                result = response.json()
                if result.get("data", {}).get("status") == "ok":
                    return True
                logger.warning(f"Push notification status: {result}")
            else:
                logger.error(f"Push API returned {response.status_code}: {response.text}")
    except Exception as e:
        logger.error(f"Failed to send push notification: {e}")

    return False


async def send_push_batch(
    notifications: list[dict],
) -> list[bool]:
    """
    Send multiple push notifications in a single batch request.

    Each notification dict should have: push_token, title, body, data (optional), category (optional)
    """
    if not notifications:
        return []

    messages = []
    for n in notifications:
        token = n.get("push_token", "")
        if not token or not token.startswith("ExponentPushToken"):
            continue
        msg = {
            "to": token,
            "title": n.get("title", ""),
            "body": n.get("body", ""),
            "sound": "default",
        }
        if n.get("data"):
            msg["data"] = n["data"]
        if n.get("category"):
            msg["categoryId"] = n["category"]
        messages.append(msg)

    if not messages:
        return [False] * len(notifications)

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(EXPO_PUSH_URL, json=messages)
            if response.status_code == 200:
                results = response.json().get("data", [])
                return [r.get("status") == "ok" for r in results]
    except Exception as e:
        logger.error(f"Failed to send push batch: {e}")

    return [False] * len(notifications)


# Notification categories for actionable notifications on iOS
CATEGORIES = {
    "ALERT_TRIGGERED": "alert_triggered",
    "ORDER_FILLED": "order_filled",
    "SWAP_COMPLETED": "swap_completed",
    "COPY_TRADE": "copy_trade",
    "DCA_EXECUTED": "dca_executed",
}
