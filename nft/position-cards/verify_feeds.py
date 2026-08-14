#!/usr/bin/env python3
"""Re-verify every committed Chainlink feed against live Robinhood Chain.

feeds.json is a point-in-time snapshot. Chainlink can add, retire or re-point
feeds, and docs.robinhood.com warns that a matching ticker/name does NOT identify
a canonical Robinhood asset — so this calls each aggregator and checks that the
feed's own description() names the ticker we mapped it to.

  python3 nft/position-cards/verify_feeds.py            # verify committed feeds.json
  python3 nft/position-cards/verify_feeds.py --refresh  # re-pull from Chainlink first

Exit code is non-zero if any feed fails, so it can gate a deploy.
"""

import argparse
import json
import os
import re
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
RPC = os.environ.get("ROBINHOOD_RPC_URL", "https://rpc.mainnet.chain.robinhood.com")
DIRECTORY = "https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json"

SEL_DESCRIPTION = "0x7284e416"
SEL_DECIMALS = "0x313ce567"
SEL_LATEST_ROUND = "0xfeaf968c"


def rpc(method: str, params: list):
    payload = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
    out = subprocess.run(
        [
            "curl",
            "-sS",
            "--max-time",
            "25",
            "-X",
            "POST",
            RPC,
            "-H",
            "content-type: application/json",
            "-d",
            payload,
        ],
        capture_output=True,
        text=True,
    ).stdout
    return json.loads(out).get("result")


def call(to: str, data: str):
    return rpc("eth_call", [{"to": to, "data": data}, "latest"])


def decode_string(h: str) -> str:
    b = bytes.fromhex(h[2:])
    ln = int.from_bytes(b[32:64], "big")
    return b[64 : 64 + ln].decode(errors="replace")


def normalise(desc: str) -> str:
    d = desc.upper().replace("ROBINHOOD", "").replace("RH", "")
    return d.replace("/", "").replace("-", "").replace(" ", "")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true", help="re-pull the Chainlink directory")
    args = ap.parse_args()

    path = os.path.join(HERE, "feeds.json")
    doc = json.load(open(path))
    feeds = doc["feeds"]

    chain_id = rpc("eth_chainId", [])
    if chain_id is None:
        print("FAIL: no RPC response", file=sys.stderr)
        return 1
    if int(chain_id, 16) != doc["chain_id"]:
        print(
            f"FAIL: RPC is chain {int(chain_id, 16)}, expected {doc['chain_id']}", file=sys.stderr
        )
        return 1
    print(f"chain {int(chain_id, 16)} · verifying {len(feeds)} feeds via {RPC}")

    if args.refresh:
        raw = subprocess.run(
            ["curl", "-sS", "--max-time", "60", DIRECTORY], capture_output=True, text=True
        ).stdout
        live = json.loads(raw)
        live_proxies = {f["proxyAddress"].lower() for f in live}
        for t, f in feeds.items():
            if f["aggregator"].lower() not in live_proxies:
                print(f"  WARN {t}: aggregator no longer listed in the Chainlink directory")

    failures = []
    for ticker, f in sorted(feeds.items()):
        agg = f["aggregator"]
        try:
            desc = decode_string(call(agg, SEL_DESCRIPTION))
            dec = int(call(agg, SEL_DECIMALS), 16)
            lrd = call(agg, SEL_LATEST_ROUND)
            words = [lrd[2 + i * 64 : 2 + (i + 1) * 64] for i in range(5)]
            answer = int(words[1], 16)
            if answer >= 1 << 255:
                answer -= 1 << 256
            updated_at = int(words[3], 16)
        except Exception as e:
            failures.append(f"{ticker}: call failed ({e})")
            continue

        age_h = (time.time() - updated_at) / 3600
        problems = []
        if not normalise(desc).startswith(ticker.upper()):
            problems.append(f"description() is {desc!r}")
        if dec != f["feed_decimals"]:
            problems.append(f"decimals {dec} != committed {f['feed_decimals']}")
        if answer <= 0:
            problems.append("non-positive answer")
        if age_h > 72:
            problems.append(f"stale {age_h:.1f}h")

        status = "FAIL" if problems else "ok"
        print(f"  {status:4} {ticker:6} ${answer / 10 ** dec:>10,.2f}  {age_h:>5.1f}h  {desc}")
        if problems:
            failures.append(f"{ticker}: {'; '.join(problems)}")

    if failures:
        print(f"\n{len(failures)} FAILED:", file=sys.stderr)
        for x in failures:
            print("  " + x, file=sys.stderr)
        return 1
    print(f"\nall {len(feeds)} feeds verified live")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
