"""Read-only Jupiter quote smoke script."""

import asyncio
import os
import sys

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "x" * 32)
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from bot.services.jupiter_api import JupiterAPI, SOLANA_TOKENS


async def main():
    api = JupiterAPI()
    quote = await api.get_quote(
        input_mint=SOLANA_TOKENS["SOL"],
        output_mint=SOLANA_TOKENS["USDC"],
        amount="10000000",
    )
    print({"provider": "jupiter", "out_amount": quote.out_amount})


if __name__ == "__main__":
    asyncio.run(main())
