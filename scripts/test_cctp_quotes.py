"""Read-only CCTP quote smoke script."""

import asyncio
import os
import sys

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "x" * 32)
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from bot.services.cctp_api import CircleCCTPAPI


async def main():
    api = CircleCCTPAPI()
    quote = await api.get_quote("base", "ethereum", "1000000")
    print({"provider": "cctp", "to_amount": quote.to_amount, "destination_domain": quote.destination_domain})


if __name__ == "__main__":
    asyncio.run(main())
