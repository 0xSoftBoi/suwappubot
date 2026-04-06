"""Read-only Across quote smoke script."""

import asyncio
import os
import sys

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "x" * 32)
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from bot.services.across_api import AcrossAPI


async def main():
    api = AcrossAPI()
    quote = await api.get_quote(
        from_chain="base",
        to_chain="ethereum",
        token="USDC",
        amount="1000000",
        from_address="0x1111111111111111111111111111111111111111",
    )
    print({"provider": "across", "to_amount": quote.to_amount, "relay_fee": quote.relay_fee})


if __name__ == "__main__":
    asyncio.run(main())
