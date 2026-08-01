#!/usr/bin/env python3
"""Date the August 2025 collateral consolidation to ~6 hours.

Lean version: lockbox collateral plus the two material remote supplies
(Arbitrum, Polygon), 6-hourly across the bracketing window.
Output: usdt0_break.csv
"""
import os, csv
from datetime import datetime, timezone, timedelta
from collect_usdt0 import RPC, ETH_RPC, USDT_ETH, SEL_BALANCE_OF, SEL_TOTAL_SUPPLY, log

HERE = os.path.dirname(os.path.abspath(__file__))
LOCKBOX = "0x6C96dE32CEa08842dcc4058c14d3aaAD7Fa41dee"
WATCH = [
    ("Arbitrum", ["https://arbitrum.gateway.tenderly.co", "https://arbitrum.drpc.org"],
     "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", 6),
    ("Polygon", ["https://polygon.drpc.org", "https://polygon.gateway.tenderly.co"],
     "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", 6),
]

START = datetime(2025, 8, 25, tzinfo=timezone.utc)
END = datetime(2025, 9, 1, tzinfo=timezone.utc)
STEP = timedelta(hours=6)

targets, t = [], START
while t <= END:
    targets.append(int(t.timestamp()))
    t += STEP
log(f"{len(targets)} samples @6h over {START.date()}..{END.date()}")

eth = RPC(ETH_RPC, "Ethereum")
head = eth.block_number()
lock, blocks = {}, {}
for ts in targets:
    b = eth.block_at_or_before(ts, 1, head)
    blocks[ts] = b
    v = eth.call(USDT_ETH, SEL_BALANCE_OF + "0" * 24 + LOCKBOX[2:].lower(), b)
    lock[ts] = (v / 1e6) if v else 0.0
log(f"lockbox done ({eth.calls} calls)")

sup = {}
for name, urls, token, dec in WATCH:
    rpc = RPC(urls, name)
    h = rpc.block_number()
    for ts in targets:
        b = rpc.block_at_or_before(ts, 1, h)
        v = rpc.call(token, SEL_TOTAL_SUPPLY, b) if b else None
        sup[(name, ts)] = (v / 10 ** dec) if v else 0.0
    log(f"{name} done ({rpc.calls} calls)")

with open(os.path.join(HERE, "usdt0_break.csv"), "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["datetime_utc", "eth_block", "lockbox_usd", "arbitrum_supply", "polygon_supply"])
    prev = None
    for ts in targets:
        dt = datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%d %H:%M")
        a, p = sup[("Arbitrum", ts)], sup[("Polygon", ts)]
        w.writerow([dt, blocks[ts], f"{lock[ts]:.2f}", f"{a:.2f}", f"{p:.2f}"])
        d = "" if prev is None else f"  Δ={lock[ts]-prev:+,.0f}"
        print(f"{dt}  lockbox=${lock[ts]/1e9:.4f}B  arb=${a/1e6:,.0f}M  poly=${p/1e6:,.0f}M{d}")
        prev = lock[ts]
print("\nwrote usdt0_break.csv")
