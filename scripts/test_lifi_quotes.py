"""Read-only Li.Fi quote smoke script."""

import asyncio
import os
import sys

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "x" * 32)
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from bot.services.lifi_api import LiFiAPI


async def main():
    api = LiFiAPI()
    quote = await api.get_quote(
        from_chain="base",
        to_chain="ethereum",
        from_token="0x0000000000000000000000000000000000000000",
        to_token="0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        from_amount="1000000000000000",
        from_address="0x1111111111111111111111111111111111111111",
    )
    print({"provider": "lifi", "id": quote.id, "to_amount": quote.to_amount})


if __name__ == "__main__":
    asyncio.run(main())
