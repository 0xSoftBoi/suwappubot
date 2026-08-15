#!/usr/bin/env python3
"""HyperLiquid order-path smoke test (testnet by default).

Exercises the real money paths end-to-end against HyperLiquid **testnet** so the
signing/resolution/order logic can be validated without risking mainnet funds.

Usage:
    # Read-only (no key needed) — proves connectivity + resolution/pricing:
    python scripts/hl_smoke_test.py

    # Account reads (balances, account value, staking) for a funded testnet key:
    HL_SMOKE_PRIVATE_KEY=0x... python scripts/hl_smoke_test.py

    # Live writes (tiny testnet spot buy) — opt-in, irreversible on testnet:
    HL_SMOKE_PRIVATE_KEY=0x... HL_SMOKE_WRITE=1 python scripts/hl_smoke_test.py

    # Target mainnet instead of testnet (be careful — real funds):
    HL_SMOKE_MAINNET=1 ... python scripts/hl_smoke_test.py

Fund a testnet account at https://app.hyperliquid-testnet.xyz (faucet).
"""

import asyncio
import os
import sys

# Import the real client (no bot settings needed for the client itself).
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from bot.services.hyperliquid_client import HyperLiquidClient  # noqa: E402


def _hdr(t):
    print(f"\n=== {t} ===")


async def read_only(c: HyperLiquidClient) -> bool:
    ok = True

    _hdr("perp markets (connectivity)")
    markets = await c.get_markets()
    print(f"  {len(markets)} perp markets; sample: {[m.name for m in markets[:5]]}")
    ok &= len(markets) > 0

    _hdr("ranked validators (staking read)")
    vals = await c.get_ranked_validators(limit=3)
    for v in vals:
        print(f"  {v['name'][:20]:20} apr={v['apr_pct']:.2f}% comm={v['commission_pct']:.0f}%")
    ok &= len(vals) > 0

    _hdr("spot resolution + mid (money-path read)")
    meta = await c._get_spot_meta()
    universe = meta.get("universe", [])
    if universe:
        # Resolve the first USDC-quoted pair by explicit @index (network-agnostic).
        pair = next((u for u in universe if u.get("tokens", [0, 0])[1] == 0), universe[0])
        coin = f"@{pair['index']}"
        a = await c.resolve_spot_asset(coin)
        mid = await c.get_spot_mid(a["name"]) if a else None
        print(
            f"  {coin} -> asset_id={a['asset_id']} name={a['name']} szDec={a['sz_decimals']} mid={mid}"
        )
        ok &= a is not None and a["asset_id"] == 10000 + pair["index"]
    else:
        print("  no spot universe (unexpected)")
        ok = False

    # Impostor safety still holds on whichever network.
    bogus = await c.resolve_spot_asset("DEFINITELYNOTAREALTOKEN")
    print(f"  unknown symbol -> {bogus} (expected None)")
    ok &= bogus is None
    return ok


async def account_reads(c: HyperLiquidClient, address: str):
    _hdr(f"account reads for {address}")
    print(f"  perps account value: ${await c.get_account_value(address):,.2f}")
    print(f"  spot value: ${await c.get_spot_value_usd(address):,.2f}")
    bals = await c.get_spot_balances(address)
    print(f"  spot balances: {[(b['coin'], b['total']) for b in bals[:6]] or 'none'}")
    summ = await c.get_staking_summary(address)
    print(f"  staking: delegated={summ.get('delegated')} undelegated={summ.get('undelegated')}")


async def live_write(c: HyperLiquidClient, address: str, pk: str):
    _hdr("LIVE WRITE: tiny spot buy (testnet)")
    meta = await c._get_spot_meta()
    pair = next((u for u in meta.get("universe", []) if u.get("tokens", [0, 0])[1] == 0), None)
    if not pair:
        print("  no tradable pair found; skipping")
        return
    coin = f"@{pair['index']}"
    mid = await c.get_spot_mid(coin if coin in (pair["name"],) else pair["name"])
    if mid <= 0:
        print(f"  {coin} has no mid; skipping")
        return
    size = round(2.0 / mid, 4)  # ~$2 notional
    print(f"  buying ~$2 of {pair['name']} (size {size}) ...")
    res = await c.place_spot_order(address, "", pk, coin, is_buy=True, size=size)
    print(f"  result: {res}")


async def main():
    testnet = os.getenv("HL_SMOKE_MAINNET") != "1"
    net = "TESTNET" if testnet else "MAINNET"
    print(f"HyperLiquid smoke test — target: {net}")
    c = HyperLiquidClient(testnet=testnet)
    print(f"  is_mainnet={c.is_mainnet}  info={c.INFO_URL}")

    overall = await read_only(c)

    pk = os.getenv("HL_SMOKE_PRIVATE_KEY")
    if pk:
        from eth_account import Account

        address = Account.from_key(pk).address
        await account_reads(c, address)
        if os.getenv("HL_SMOKE_WRITE") == "1":
            if not testnet and os.getenv("HL_SMOKE_CONFIRM_MAINNET") != "1":
                print("\nRefusing mainnet write without HL_SMOKE_CONFIRM_MAINNET=1.")
            else:
                await live_write(c, address, pk)
    else:
        print("\n(set HL_SMOKE_PRIVATE_KEY for account reads / writes)")

    await c.close()
    print(f"\nREAD-ONLY SMOKE: {'PASS' if overall else 'FAIL'}")
    sys.exit(0 if overall else 1)


if __name__ == "__main__":
    asyncio.run(main())
