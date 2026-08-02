#!/usr/bin/env python3
"""Archive backfill of the canonical Polygon PoS ERC20 predicate's USDT balance
at the panel's 16 pre-break aligned Ethereum blocks.

This is the collateral-side correction of v3 (Section 2.3 / 3.2): version 2's
escrow control read 0x8484Ef722627bf18ca5Ae6BcF031c23E6e922B30 (not the
canonical predicate; ~$0.02) and concluded the escrow was empty. The canonical
predicate is 0x40ec5B33f54e0E8A33A975908C5BA1c14e5BbbDf, and it held
$1.22-1.39bn across the whole pre-break window.

Blocks below are the panel's aligned Ethereum blocks (from usdt0_panel.csv,
entity=USDT0_lockbox, pre-break observations), reproduced inline so this
script is self-contained. Writes data/polygon_predicate_prebreak.json.
"""
import json
import os
import time
import urllib.request

USDT = "0xdAC17F958D2ee523a2206206994597C13D831ec7"
PREDICATE = "40ec5B33f54e0E8A33A975908C5BA1c14e5BbbDf"  # canonical PoS ERC20 predicate
RPC = "https://eth.drpc.org"  # free archive reads; browser UA required

BLOCKS = {
    "2025-07-26": 23004969, "2025-07-28": 23019291, "2025-07-30": 23033589,
    "2025-08-01": 23047881, "2025-08-03": 23062187, "2025-08-05": 23076512,
    "2025-08-07": 23090832, "2025-08-09": 23105152, "2025-08-11": 23119456,
    "2025-08-13": 23133781, "2025-08-15": 23148087, "2025-08-17": 23162426,
    "2025-08-19": 23176770, "2025-08-21": 23191107, "2025-08-23": 23205435,
    "2025-08-25": 23219773,
    # The Section 3.1 bracket blocks (27 Aug 2025 12:00 / 18:00 UTC), so the
    # two most load-bearing numbers in the paper are regenerable from here:
    # $1,366,840,226 at open and $7,998,647 at close.
    "2025-08-27T12:00Z(bracket-open)": 23232316,
    "2025-08-27T18:00Z(bracket-close)": 23234104,
}

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "data", "polygon_predicate_prebreak.json")


def read(block):
    body = json.dumps({
        "jsonrpc": "2.0", "id": 1, "method": "eth_call",
        "params": [{"to": USDT, "data": "0x70a08231" + "0" * 24 + PREDICATE}, hex(block)],
    }).encode()
    req = urllib.request.Request(RPC, data=body, headers={
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64)",
    })
    r = json.loads(urllib.request.urlopen(req, timeout=30).read())
    return int(r["result"], 16) / 1e6


if __name__ == "__main__":
    out = {}
    for date, block in BLOCKS.items():
        for attempt in range(3):
            try:
                out[date] = read(block)
                print(f"{date}  block {block:,}  ${out[date]:,.0f}")
                break
            except Exception as e:  # noqa: BLE001
                if attempt == 2:
                    raise
                time.sleep(2)
        time.sleep(0.4)
    json.dump({
        "address": "0x" + PREDICATE,
        "token": "USDT (Ethereum)",
        "method": "balanceOf at panel-aligned blocks",
        "balances_usd": out,
    }, open(OUT, "w"), indent=2)
    print(f"wrote {OUT}")
