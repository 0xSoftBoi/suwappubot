#!/usr/bin/env python3
"""Verify TP/SL rides along with a real HyperLiquid entry. MONEY-PATH, MAINNET.

This is the end-to-end check that unit tests cannot do: whether HyperLiquid
actually accepts the ``normalTpsl`` grouping, and whether the statuses come back
parallel to the orders sent. Both are assumptions in place_order that are taken
from the API spec rather than observed.

It opens the smallest viable position with both triggers attached, confirms the
exchange is holding them, then closes and cleans up. Real funds, real fees.

Usage:
    # Key is read from the environment or a gitignored file; never printed.
    set -a; . ./.env.hlsmoke; set +a
    HL_LIVE_CONFIRM=yes python3.12 scripts/hl_tpsl_live_check.py

Env:
    HL_SMOKE_PRIVATE_KEY  required, the funded mainnet key
    HL_LIVE_CONFIRM       required, must be "yes" — guards against accidents
    HL_LIVE_MARKET        optional, default ETH-USD
    HL_LIVE_USD           optional, target notional in USD, default 12
"""

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from bot.services.hyperliquid_client import HyperLiquidClient  # noqa: E402

MARKET = os.getenv("HL_LIVE_MARKET", "ETH-USD")
TARGET_USD = float(os.getenv("HL_LIVE_USD", "12"))


def hdr(t):
    print(f"\n=== {t} ===", flush=True)


async def main() -> int:
    key = os.getenv("HL_SMOKE_PRIVATE_KEY")
    if not key:
        print("HL_SMOKE_PRIVATE_KEY is not set. Nothing to do.")
        return 2
    if os.getenv("HL_LIVE_CONFIRM") != "yes":
        print("Refusing to trade without HL_LIVE_CONFIRM=yes. Nothing was sent.")
        return 2

    # Explicitly mainnet: is_mainnet flows into every signature, so getting this
    # wrong produces orders the exchange rejects rather than a silent testnet run.
    client = HyperLiquidClient(testnet=False)
    print(f"Target: {'MAINNET' if client.is_mainnet else 'TESTNET'}  {client.EXCHANGE_URL}")

    from eth_account import Account

    address = Account.from_key(key).address
    print(f"Account: {address}")

    hdr("account state (read)")
    state = await client.get_account_state(address)
    if not state:
        print("Could not read account state — stopping before any order.")
        return 1
    margin = float(state.get("marginSummary", {}).get("accountValue", 0) or 0)
    print(f"  account value: ${margin:,.2f}")
    if margin < TARGET_USD:
        print(f"  not enough margin for a ${TARGET_USD} test. Stopping.")
        return 1

    mid = await client.get_mark_price(MARKET)
    if not mid:
        print(f"  no mid price for {MARKET}. Stopping.")
        return 1
    size = round(TARGET_USD / mid, 4)
    tp = round(mid * 1.25, 2)  # far out so neither can trigger during the test
    sl = round(mid * 0.75, 2)
    print(f"  {MARKET} mid={mid} size={size} tp={tp} sl={sl}")

    hdr("open long with TP/SL attached (WRITE)")
    result = await client.place_order(
        address=address,
        api_key=key,
        api_secret=key,
        market=MARKET,
        side="long",
        size=size,
        leverage=2,
        order_type="market",
        tp_price=tp,
        sl_price=sl,
    )
    if not result:
        print("  order returned None — nothing opened.")
        return 1
    print(f"  entry oid={result.order_id} status={result.status} fill={result.fill_price}")
    print(f"  tp_order_id={result.tp_order_id}  sl_order_id={result.sl_order_id}")

    grouping_ok = bool(result.tp_order_id and result.sl_order_id)
    print(f"  >>> grouping accepted by HyperLiquid: {grouping_ok}")

    hdr("confirm the triggers are resting (read)")
    resting = await client.get_open_orders(address)
    triggers = [o for o in (resting or []) if o.get("is_trigger") or o.get("reduce_only")]
    for o in triggers:
        print(
            f"  oid={o.get('order_id')} type={o.get('order_type')} trigger={o.get('trigger_price')}"
        )
    print(f"  reduce-only/trigger orders resting: {len(triggers)}")

    hdr("close the position + cancel leftovers (WRITE, cleanup)")
    closed = await client.place_order(
        address=address,
        api_key=key,
        api_secret=key,
        market=MARKET,
        side="long",
        size=size,
        order_type="market",
        reduce_only=True,
    )
    print(f"  close: {'ok' if closed else 'FAILED — check the account manually'}")

    for o in triggers:
        oid = o.get("order_id")
        if oid:
            ok = await client.cancel_order(
                address=address, api_key=key, api_secret=key, market=MARKET, order_id=str(oid)
            )
            print(f"  cancel {oid}: {'ok' if ok else 'failed'}")

    hdr("verdict")
    left = await client.get_open_positions(address)
    print(f"  open positions remaining: {len(left or [])}")
    print(f"  normalTpsl grouping verified: {grouping_ok}")
    return 0 if grouping_ok else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
