"""Pure deep-link builders for routing Telegram alerts into the terminal.

No I/O, no DB, no network — just string building.
"""

from urllib.parse import urlencode

from bot.config.settings import settings


def build_alert_deep_link(alert: dict) -> str:
    """Build a terminal deep link for an alert notification.

    Maps the alert dict (as built in bot/services/alerts.py) to a URL of the
    shape:
        {terminal_url}/terminal/alert-swap?alertId=<id>&token=<symbol>&chain=<chain>
            [&side=<buy|sell>][&amount=<amount>]&ref=alert

    Optional action params (`side`, `amount`) are only included when present
    on the alert, so a notify-only alert (no attached action) still produces
    a well-formed URL with just alertId/token/chain/ref.

    Only intent fields are carried — no identity, credentials, or secrets.
    """
    params = {
        "alertId": alert.get("alertId", alert.get("alert_id")),
        "token": alert.get("token", alert.get("token_symbol")),
        "chain": alert.get("action_chain", alert.get("chain")),
    }

    side = alert.get("action_side", alert.get("side"))
    if side:
        params["side"] = side

    amount = alert.get("action_amount", alert.get("amount"))
    if amount:
        params["amount"] = amount

    params["ref"] = "alert"

    base_url = settings.terminal_url.rstrip("/")
    query = urlencode(params)
    return f"{base_url}/terminal/alert-swap?{query}"
