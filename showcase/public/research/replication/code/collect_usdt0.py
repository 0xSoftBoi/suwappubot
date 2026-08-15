#!/usr/bin/env python3
"""
Point-in-time collateral reconciliation for USDT0 (omnichain USDT).

Measures, at aligned UTC timestamps across 15 EVM chains:
  - collateral: USDT held by the USDT0 OAdapter lockbox on Ethereum
  - liabilities: sum of USDT0 totalSupply() on every remote chain
  - legacy escrows: USDT held by canonical bridge escrows (provenance control)

Method note: chains have heterogeneous block times, so "latest" on 15 chains is
NOT a consistent snapshot. For each target timestamp we locate the highest block
on each chain with block.timestamp <= target, then read state at that block.

Output: usdt0_panel.csv (long format, one row per chain-date observation)
Reproduce: python3 collect_usdt0.py
"""
import json, os, sys, time, threading, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "usdt0_panel.csv")
DAYS = int(os.environ.get("DAYS", "365"))
STEP_HOURS = int(os.environ.get("STEP_HOURS", "24"))

SEL_TOTAL_SUPPLY = "0x18160ddd"
SEL_BALANCE_OF = "0x70a08231"
USDT_ETH = "0xdAC17F958D2ee523a2206206994597C13D831ec7"

# Remote USDT0 deployments. Every address below was verified live via eth_call
# (symbol/decimals/totalSupply) before inclusion.
CHAINS = [
    # name,            rpc,                              token,                                        decimals, class
    ("Arbitrum",   ["https://arbitrum.gateway.tenderly.co", "https://arbitrum.drpc.org"],
     "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", 6, "upgraded-in-place"),
    ("Polygon",    ["https://polygon.drpc.org", "https://polygon.gateway.tenderly.co"],
     "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", 6, "upgraded-in-place"),
    ("Plasma",     ["https://plasma.drpc.org", "https://rpc.plasma.to"],
     "0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb", 6, "native-oft"),
    ("Mantle",     ["https://mantle.drpc.org", "https://rpc.mantle.xyz"],
     "0x779Ded0c9e1022225f8E0630b35a9b54bE713736", 6, "native-oft"),
    ("XLayer",     ["https://rpc.xlayer.tech"],
     "0x779Ded0c9e1022225f8E0630b35a9b54bE713736", 6, "native-oft"),
    ("HyperEVM",   ["https://hyperliquid.drpc.org", "https://rpc.hyperliquid.xyz/evm"],
     "0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb", 6, "native-oft"),
    ("Ink",        ["https://ink.drpc.org", "https://rpc-gel.inkonchain.com"],
     "0x0200C29006150606B650577BBE7B6248F58470c1", 6, "native-oft"),
    ("Berachain",  ["https://berachain.drpc.org", "https://rpc.berachain.com"],
     "0x779Ded0c9e1022225f8E0630b35a9b54bE713736", 6, "native-oft"),
    ("Flare",      ["https://flare.drpc.org", "https://flare-api.flare.network/ext/C/rpc"],
     "0xe7cd86e13AC4309349F30B3435a9d337750fC82D", 6, "native-oft"),
    ("Optimism",   ["https://optimism.drpc.org", "https://optimism.gateway.tenderly.co"],
     "0x01bFF41798a0BcF287b996046Ca68b395DbC1071", 6, "native-oft"),
    ("Unichain",   ["https://unichain.drpc.org", "https://mainnet.unichain.org"],
     "0x9151434b16b9763660705744891fA906F660EcC5", 6, "native-oft"),
    ("Sei",        ["https://evm-rpc.sei-apis.com", "https://sei.drpc.org"],
     "0x9151434b16b9763660705744891fA906F660EcC5", 6, "native-oft"),
    ("Rootstock",  ["https://rootstock.drpc.org", "https://public-node.rsk.co"],
     "0x779dED0C9e1022225F8e0630b35A9B54Be713736", 6, "native-oft"),
    # Added after the first draft: these documented deployments were omitted from
    # the original 12-chain universe. Each verified live via totalSupply() before
    # inclusion. Their combined supply is material to the collateralization ratio.
    ("Monad",      ["https://rpc.monad.xyz", "https://monad.drpc.org"],
     "0xe7cd86e13AC4309349F30B3435a9d337750fC82D", 6, "native-oft"),
    ("Stable",     ["https://rpc.stable.xyz"],
     "0x779Ded0c9e1022225f8E0630b35a9b54bE713736", 6, "native-oft"),
    ("Conflux",    ["https://evm.confluxrpc.com"],
     "0xaf37E8B6C9ED7f6318979f56Fc287d76c30847ff", 6, "native-oft"),
    ("Tempo",      ["https://rpc.tempo.xyz"],
     "0x20C00000000000000000000014f22CA97301EB73", 6, "native-oft"),
    ("Morph",      ["https://rpc.morphl2.io"],
     "0xe7cd86e13AC4309349F30B3435a9d337750fC82D", 6, "native-oft"),
    # v3: MegaETH exposed a public mainnet RPC (chainId 4326); symbol/decimals
    # verified live 2026-07-31. Serves >=1M blocks of history.
    ("MegaETH",    ["https://mainnet.megaeth.com/rpc", "https://megaeth.drpc.org"],
     "0xb8ce59fc3717ada4c02eadf9682a9e934f625ebb", 6, "native-oft"),
]

# Ethereum-side contracts read as balanceOf(USDT).
ETH_ACCOUNTS = [
    ("USDT0_lockbox",      "0x6C96dE32CEa08842dcc4058c14d3aaAD7Fa41dee", "collateral"),
    ("Optimism_L1Bridge",  "0x99C9fc46f92E8a1c0deC1b1747d010903E884bE1", "legacy-escrow"),
    ("Arbitrum_L1Gateway", "0xcEe284F754E854890e311e3280b767F80797180d", "legacy-escrow"),
    # v2 mislabeled 0x8484Ef72... as the Polygon ERC20 predicate; it is not,
    # and its ~$0.02 reading produced Correction 2 (see paper Section 5).
    # Retained under an honest name so the v2 series stays reproducible.
    ("Wrong_Polygon_Pred_v2", "0x8484Ef722627bf18ca5Ae6BcF031c23E6e922B30", "legacy-escrow"),
    # The canonical Polygon PoS ERC20 predicate — the account that actually
    # backed Polygon-leg supply until the 2025-08-27 migration.
    ("Polygon_ERC20Pred_canonical", "0x40ec5B33f54e0E8A33A975908C5BA1c14e5BbbDf", "legacy-escrow"),
]
ETH_RPC = ["https://eth.drpc.org", "https://rpc.mevblocker.io", "https://mainnet.gateway.tenderly.co"]

_print_lock = threading.Lock()
def log(msg):
    with _print_lock:
        print(f"[{datetime.now(timezone.utc).strftime('%H:%M:%S')}] {msg}", flush=True)

class RPC:
    """JSON-RPC client with retry/backoff and a per-chain block->timestamp cache."""
    def __init__(self, url, name):
        self.urls = url if isinstance(url, list) else [url]
        self.idx = 0
        self.name = name
        self.ts_cache = {}
        self.calls = 0
        self.lock = threading.Lock()

    def _post(self, method, params, tries=5):
        body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
        last = None
        for a in range(tries):
            try:
                url = self.urls[self.idx % len(self.urls)]
                req = urllib.request.Request(url, data=body, headers={
                    "Content-Type": "application/json",
                    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                                  "(KHTML, like Gecko) Chrome/126.0 Safari/537.36",
                    "Accept": "application/json",
                })
                with urllib.request.urlopen(req, timeout=30) as r:
                    d = json.loads(r.read())
                with self.lock:
                    self.calls += 1
                if "error" in d:
                    last = d["error"].get("message", "")
                    low = last.lower()
                    # state/history genuinely absent at this height -> not an error
                    if any(s in low for s in ("not found", "missing trie",
                                              "only supported from block",
                                              "before evm", "no state available",
                                              "pruned", "is not available")):
                        return None
                    self.idx += 1  # rate limit / node error -> try next endpoint
                    time.sleep(0.6 * (a + 1))
                    continue
                return d.get("result")
            except Exception as e:
                last = str(e)
                self.idx += 1  # rotate to fallback endpoint
                time.sleep(0.8 * (a + 1))
        raise RuntimeError(f"{self.name} {method} failed: {last}")

    def block_number(self):
        return int(self._post("eth_blockNumber", []), 16)

    def block_ts(self, n):
        if n in self.ts_cache:
            return self.ts_cache[n]
        r = self._post("eth_getBlockByNumber", [hex(n), False])
        if r is None:
            return None
        ts = int(r["timestamp"], 16)
        self.ts_cache[n] = ts
        return ts

    def call(self, to, data, block):
        r = self._post("eth_call", [{"to": to, "data": data}, hex(block)])
        if r is None or r == "0x":
            return None
        try:
            return int(r, 16)
        except ValueError:
            return None

    def block_at_or_before(self, target_ts, lo, hi):
        """Highest block with timestamp <= target_ts. Binary search over cached ts."""
        lo_ts = self.block_ts(lo)
        if lo_ts is None or lo_ts > target_ts:
            return None  # chain younger than target
        hi_ts = self.block_ts(hi)
        if hi_ts is not None and hi_ts <= target_ts:
            return hi
        while lo < hi - 1:
            # interpolate rather than plain bisect: block times are near-constant,
            # so this converges in far fewer RPC calls
            lo_ts = self.block_ts(lo); hi_ts = self.block_ts(hi)
            if lo_ts is None or hi_ts is None or hi_ts <= lo_ts:
                mid = (lo + hi) // 2
            else:
                frac = (target_ts - lo_ts) / (hi_ts - lo_ts)
                mid = lo + int(frac * (hi - lo))
                mid = max(lo + 1, min(hi - 1, mid))
            mts = self.block_ts(mid)
            if mts is None:
                mid = (lo + hi) // 2
                mts = self.block_ts(mid)
                if mts is None:
                    return lo
            if mts <= target_ts:
                lo = mid
            else:
                hi = mid
        return lo


def targets():
    now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    out = []
    t = now - timedelta(days=DAYS)
    while t <= now:
        out.append(int(t.timestamp()))
        t += timedelta(hours=STEP_HOURS)
    return out


def collect_chain(name, url, token, decimals, klass, tgts, rows, errors):
    try:
        rpc = RPC(url, name)
        head = rpc.block_number()
        head_ts = rpc.block_ts(head)
        # Find the earliest queryable block. Some chains (e.g. Sei) only expose
        # EVM state above a cutoff, so probe upward then bisect for the boundary.
        lo, lo_ts = None, None
        for cand in (1, 100, 1000, 10000, 100000, 1000000, 10000000,
                     50000000, 79123881, 100000000):
            if cand >= head:
                break
            t = rpc.block_ts(cand)
            if t is not None:
                lo, lo_ts = cand, t
                break
        if lo is None:
            a, b = 1, head          # bisect for the first available block
            for _ in range(40):
                if a >= b - 1:
                    break
                m = (a + b) // 2
                if rpc.block_ts(m) is None:
                    a = m
                else:
                    b = m
            lo, lo_ts = b, rpc.block_ts(b)
        if lo_ts is None:
            raise RuntimeError("could not establish a queryable lower bound")
        log(f"{name}: head={head} head_ts={head_ts} genesis_ts={lo_ts}")
        n_ok, n_err = 0, 0
        for ts in tgts:
            try:
                if lo_ts is not None and ts < lo_ts:
                    rows.append((ts, name, klass, None, 0, "pre-history"))
                    continue
                b = rpc.block_at_or_before(ts, lo, head)
                if b is None:
                    rows.append((ts, name, klass, None, 0, "pre-history"))
                    continue
                v = rpc.call(token, SEL_TOTAL_SUPPLY, b)
                if v is None:
                    rows.append((ts, name, klass, b, 0, "not-deployed"))
                else:
                    rows.append((ts, name, klass, b, v / (10 ** decimals), "ok"))
                    n_ok += 1
            except Exception as e:
                n_err += 1
                rows.append((ts, name, klass, None, 0, "rpc-error"))
        if n_err:
            log(f"{name}: {n_err} target(s) failed with RPC errors")
        log(f"{name}: done, {n_ok}/{len(tgts)} live obs, {rpc.calls} rpc calls")
    except Exception as e:
        log(f"{name}: FAILED {e}")
        errors.append((name, str(e)))


def collect_eth(tgts, rows, errors):
    try:
        rpc = RPC(ETH_RPC, "Ethereum")
        head = rpc.block_number()
        log(f"Ethereum: head={head}")
        for ts in tgts:
            try:
                b = rpc.block_at_or_before(ts, 1, head)
                if b is None:
                    continue
                for label, addr, klass in ETH_ACCOUNTS:
                    data = SEL_BALANCE_OF + "0" * 24 + addr[2:].lower()
                    v = rpc.call(USDT_ETH, data, b)
                    rows.append((ts, label, klass, b, (v / 1e6) if v is not None else 0.0,
                                 "ok" if v is not None else "no-state"))
            except Exception as e:
                log(f"Ethereum: target {ts} failed: {str(e)[:70]}")
        log(f"Ethereum: done, {rpc.calls} rpc calls")
    except Exception as e:
        log(f"Ethereum: FAILED {e}")
        errors.append(("Ethereum", str(e)))


def main():
    tgts = targets()
    log(f"{len(tgts)} target timestamps, {DAYS}d @ {STEP_HOURS}h, {len(CHAINS)} remote chains")
    rows, errors = [], []
    with ThreadPoolExecutor(max_workers=8) as ex:
        futs = [ex.submit(collect_eth, tgts, rows, errors)]
        for (n, u, t, d, k) in CHAINS:
            futs.append(ex.submit(collect_chain, n, u, t, d, k, tgts, rows, errors))
        for f in futs:
            f.result()
    rows.sort(key=lambda r: (r[0], r[1]))
    with open(OUT, "w") as f:
        f.write("ts,date_utc,entity,class,block,value_usd,status\n")
        for ts, ent, klass, blk, val, st in rows:
            d = datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%d")
            f.write(f"{ts},{d},{ent},{klass},{blk if blk is not None else ''},{val:.6f},{st}\n")
    log(f"wrote {OUT}: {len(rows)} rows; errors={errors}")


if __name__ == "__main__":
    main()
