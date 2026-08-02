#!/usr/bin/env python3
"""Complete-universe head snapshot: every documented USDT0 leg in one session.

Reads totalSupply() on all 20 directly-readable legs of the issuer's 22-leg
registry (Ethereum's row IS the lockbox; HyperCore is a verified sub-ledger of
HyperEVM and adding it would double-count), plus the lockbox balance.

NOT block-aligned: reads span ~a minute of wall clock. At a buffer of ~$1m on
~$3.45bn this non-alignment noise is the same order as the buffer itself, so
the output supports "indistinguishable from 1:1", not a signed surplus claim.

Writes data/head_snapshot_<YYYYMMDD>.json
"""
import datetime
import json
import os
import time
import urllib.request

CHAINS = [
    ("Arbitrum", "https://arbitrum.gateway.tenderly.co", "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9"),
    ("Polygon", "https://polygon.drpc.org", "0xc2132D05D31c914a87C6611C10748AEb04B58e8F"),
    ("Plasma", "https://plasma.drpc.org", "0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb"),
    ("Mantle", "https://mantle.drpc.org", "0x779Ded0c9e1022225f8E0630b35a9b54bE713736"),
    ("XLayer", "https://rpc.xlayer.tech", "0x779Ded0c9e1022225f8E0630b35a9b54bE713736"),
    ("HyperEVM", "https://rpc.hyperliquid.xyz/evm", "0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb"),
    ("Ink", "https://ink.drpc.org", "0x0200C29006150606B650577BBE7B6248F58470c1"),
    ("Berachain", "https://berachain.drpc.org", "0x779Ded0c9e1022225f8E0630b35a9b54bE713736"),
    ("Flare", "https://flare.drpc.org", "0xe7cd86e13AC4309349F30B3435a9d337750fC82D"),
    ("Optimism", "https://optimism.drpc.org", "0x01bFF41798a0BcF287b996046Ca68b395DbC1071"),
    ("Unichain", "https://unichain.drpc.org", "0x9151434b16b9763660705744891fA906F660EcC5"),
    ("Sei", "https://evm-rpc.sei-apis.com", "0x9151434b16b9763660705744891fA906F660EcC5"),
    ("Rootstock", "https://rootstock.drpc.org", "0x779dED0C9e1022225F8e0630b35A9B54Be713736"),
    ("Monad", "https://rpc.monad.xyz", "0xe7cd86e13AC4309349F30B3435a9d337750fC82D"),
    ("Stable", "https://rpc.stable.xyz", "0x779Ded0c9e1022225f8E0630b35a9b54bE713736"),
    ("Conflux", "https://evm.confluxrpc.com", "0xaf37E8B6C9ED7f6318979f56Fc287d76c30847ff"),
    ("Tempo", "https://rpc.tempo.xyz", "0x20C00000000000000000000014f22CA97301EB73"),
    ("Morph", "https://rpc.morphl2.io", "0xe7cd86e13AC4309349F30B3435a9d337750fC82D"),
    ("MegaETH", "https://mainnet.megaeth.com/rpc", "0xb8ce59fc3717ada4c02eadf9682a9e934f625ebb"),
    ("Hedera", "https://mainnet.hashio.io/api", "0x00000000000000000000000000000000009Ce723"),
]
ETH_RPC = "https://eth.drpc.org"
USDT = "0xdAC17F958D2ee523a2206206994597C13D831ec7"
LOCKBOX = "6C96dE32CEa08842dcc4058c14d3aaAD7Fa41dee"

HERE = os.path.dirname(os.path.abspath(__file__))


def call(url, to, data):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "eth_call",
                       "params": [{"to": to, "data": data}, "latest"]}).encode()
    req = urllib.request.Request(url, data=body, headers={
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64)"})
    r = json.loads(urllib.request.urlopen(req, timeout=25).read())
    return int(r["result"], 16)


if __name__ == "__main__":
    now = datetime.datetime.now(datetime.timezone.utc)
    out = {"ts_utc": now.isoformat(timespec="seconds"), "supplies": {}, "errors": {}}
    tot = 0.0
    for name, url, tok in CHAINS:
        for attempt in range(3):
            try:
                v = call(url, tok, "0x18160ddd") / 1e6
                out["supplies"][name] = v
                tot += v
                print(f"  {name:10} ${v:>18,.2f}")
                break
            except Exception as e:  # noqa: BLE001
                if attempt == 2:
                    out["errors"][name] = str(e)
                    print(f"  {name:10} ERROR {e}")
                time.sleep(1.5)
        time.sleep(0.2)
    lock = call(ETH_RPC, USDT, "0x70a08231" + "0" * 24 + LOCKBOX) / 1e6
    # HyperCore containment check: the Core-side float is the HyperEVM token
    # balance locked at the spot system address, and must be <= the HyperEVM
    # totalSupply already counted above (i.e., a sub-ledger, not a missing leg).
    core = call("https://rpc.hyperliquid.xyz/evm",
                "0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb",
                "0x70a08231" + "0" * 24 + "200000000000000000000000000000000000010c") / 1e6
    out["hypercore_locked_float"] = core
    out["hypercore_contained"] = core <= out["supplies"].get("HyperEVM", 0)
    print(f"  HyperCore locked float: ${core:,.2f}  contained in HyperEVM supply: {out['hypercore_contained']}")
    out.update(lockbox=lock, total_liabilities=tot, ratio=lock / tot, buffer=lock - tot)
    print(f"\n  TOTAL liabilities: ${tot:,.2f}\n  Lockbox:           ${lock:,.2f}")
    print(f"  Ratio: {lock / tot:.5f}    Buffer: ${lock - tot:,.2f}")
    path = os.path.join(HERE, "..", "data", f"head_snapshot_{now:%Y%m%d}.json")
    json.dump(out, open(path, "w"), indent=2)
    print(f"  wrote {path}")
