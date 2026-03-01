"""STON.fi DEX integration for TON swaps.

STON.fi is the largest DEX on TON, supporting TON <-> Jetton and Jetton <-> Jetton swaps.
API docs: https://docs.ston.fi/
"""

import logging
from typing import Optional
from dataclasses import dataclass

import aiohttp

from bot.config.settings import settings

logger = logging.getLogger(__name__)

STONFI_API_BASE = "https://api.ston.fi/v1"
STONFI_ROUTER_ADDRESS = "EQB3ncyBUTjZUA5EnFKR5_EnOMI9V1tTEAAPaiU71gc4TiUt"

# Well-known Jetton master addresses on TON
TON_TOKENS = {
    "USDT": "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs",
    "NOT": "EQAvlWFDxGF2lXm67y4yzC17wYKD9A0guwPkMs1gOsM__NOT",
    "DOGS": "EQCvxJy4eG8hyHBFsZ7eePxrRsUQSFE_jpptRAYBmcG_DOGS",
    "STON": "EQA2kCVNwVsil2EM2mB0SkXytxCqQjS4mttjDpnXmwG9T6bO",
    "SCALE": "EQBlqsm144Dq6SjbPI4jjZvA1hqTIP3CvHovbIfW_t-SCALE",
}


@dataclass
class StonfiQuote:
    """Quote from STON.fi DEX."""
    offer_address: str
    ask_address: str
    offer_amount: str
    ask_amount: str
    min_ask_amount: str
    price_impact: float
    fee_amount: str
    router_address: str
    swap_rate: float


async def get_quote(
    offer_token: str,
    ask_token: str,
    offer_amount: int,
    slippage: float = 0.5,
) -> Optional[StonfiQuote]:
    """Get a swap quote from STON.fi.

    Args:
        offer_token: Token to sell (address or symbol like "TON", "USDT")
        ask_token: Token to buy (address or symbol)
        offer_amount: Amount in smallest units (nanotons for TON)
        slippage: Slippage tolerance as percentage

    Returns:
        StonfiQuote or None if quote fails
    """
    # Resolve token symbols to addresses
    if offer_token.upper() == "TON":
        offer_address = "EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c"  # Native TON
    else:
        offer_address = TON_TOKENS.get(offer_token.upper(), offer_token)

    if ask_token.upper() == "TON":
        ask_address = "EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c"
    else:
        ask_address = TON_TOKENS.get(ask_token.upper(), ask_token)

    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{STONFI_API_BASE}/swap/simulate",
                json={
                    "offer_address": offer_address,
                    "ask_address": ask_address,
                    "units": str(offer_amount),
                    "slippage_tolerance": str(slippage / 100),
                },
            ) as resp:
                if resp.status != 200:
                    error_text = await resp.text()
                    logger.error("STON.fi quote failed: %d %s", resp.status, error_text[:200])
                    return None

                data = await resp.json()

                ask_amount = int(data.get("ask_units", "0"))
                min_ask = int(data.get("min_ask_units", "0"))
                fee = data.get("fee_units", "0")
                price_impact = float(data.get("price_impact", "0"))

                swap_rate = ask_amount / offer_amount if offer_amount > 0 else 0

                return StonfiQuote(
                    offer_address=offer_address,
                    ask_address=ask_address,
                    offer_amount=str(offer_amount),
                    ask_amount=str(ask_amount),
                    min_ask_amount=str(min_ask),
                    price_impact=price_impact,
                    fee_amount=str(fee),
                    router_address=STONFI_ROUTER_ADDRESS,
                    swap_rate=swap_rate,
                )

    except Exception as e:
        logger.error("STON.fi quote error: %s", e)
        return None


async def build_swap_transaction(
    quote: StonfiQuote,
    sender_address: str,
) -> Optional[dict]:
    """Build a swap transaction message for STON.fi.

    Returns a dict with the transaction parameters to sign and send.
    This creates the internal message to the STON.fi router contract.
    """
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{STONFI_API_BASE}/swap/build",
                json={
                    "offer_address": quote.offer_address,
                    "ask_address": quote.ask_address,
                    "units": quote.offer_amount,
                    "min_ask_units": quote.min_ask_amount,
                    "sender_address": sender_address,
                },
            ) as resp:
                if resp.status != 200:
                    logger.error("STON.fi build failed: %d", resp.status)
                    return None

                data = await resp.json()
                return {
                    "to": data.get("to"),
                    "value": data.get("value"),
                    "body": data.get("body"),  # Base64 encoded BOC
                }

    except Exception as e:
        logger.error("STON.fi build error: %s", e)
        return None
