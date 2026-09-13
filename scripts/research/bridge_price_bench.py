"""Head-to-head cross-chain price benchmark: Relay vs Across vs Li.Fi vs deBridge.

Quotes identical routes and sizes against each provider's public API (no keys),
and writes a markdown table with output amount, effective cost in bps, and the
provider's own time estimate. Run: python3 scripts/research/bridge_price_bench.py
"""
import json, time, urllib.request, urllib.parse, sys, os, datetime as dt

UA = {"user-agent": "suwappu-research", "content-type": "application/json"}
DEAD = "0x000000000000000000000000000000000000dEaD"
USDC = {8453: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", 42161: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", 1: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", 10: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85"}
ZERO = "0x0000000000000000000000000000000000000000"
ROUTES = [
    ("USDC Base→Arbitrum", 8453, 42161, USDC[8453], USDC[42161], 6, 6, [25, 1000, 50000]),
    ("USDC Base→Ethereum", 8453, 1, USDC[8453], USDC[1], 6, 6, [1000, 50000]),
    ("ETH Base→Arbitrum", 8453, 42161, ZERO, ZERO, 18, 18, [0.01, 1.0]),
    ("USDC Arbitrum→Optimism", 42161, 10, USDC[42161], USDC[10], 6, 6, [1000]),
]
ETH_USD = None

def http(method, url, body=None, headers=None, timeout=40):
    h = dict(UA); h.update(headers or {})
    req = urllib.request.Request(url, data=(json.dumps(body).encode() if body is not None else None), headers=h, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        try: return e.code, json.load(e)
        except Exception: return e.code, {"error": e.read()[:200].decode(errors="ignore")}
    except Exception as e:
        return 0, {"error": str(e)[:200]}

def eth_price():
    global ETH_USD
    if ETH_USD: return ETH_USD
    s, d = http("GET", "https://api.relay.link/currencies/token/price?address=0x0000000000000000000000000000000000000000&chainId=8453")
    ETH_USD = float(d.get("price", 0)) if s == 200 else 0.0
    return ETH_USD

def relay(o, dst, tin, tout, amt_raw):
    s, d = http("POST", "https://api.relay.link/quote/v2", {"user": DEAD, "originChainId": o, "destinationChainId": dst, "originCurrency": tin, "destinationCurrency": tout, "amount": str(amt_raw), "tradeType": "EXACT_INPUT", "recipient": DEAD})
    if s != 200: return {"err": f"{s} {d.get('message', d.get('errorCode', ''))}"}
    det = d["details"]
    return {"out": int(det["currencyOut"]["amount"]), "min": int(det["currencyOut"]["minimumAmount"]), "gas_usd": float(d["fees"]["gas"]["amountUsd"]), "fee_usd": float(d["fees"]["relayer"]["amountUsd"]), "t": det.get("timeEstimate"), "impact": det.get("totalImpact", {}).get("percent")}

def across(o, dst, tin, tout, amt_raw):
    tin_q = tin if tin != ZERO else "0x4200000000000000000000000000000000000006" if o == 8453 else "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1"
    q = urllib.parse.urlencode({"inputToken": tin_q, "outputToken": (tout if tout != ZERO else ZERO), "originChainId": o, "destinationChainId": dst, "amount": str(amt_raw), "recipient": DEAD})
    s, d = http("GET", f"https://app.across.to/api/suggested-fees?{q}")
    if s != 200: return {"err": f"{s} {str(d)[:80]}"}
    fee = int(d["totalRelayFee"]["total"])
    return {"out": int(amt_raw) - fee, "min": int(amt_raw) - fee, "gas_usd": None, "fee_usd": None, "t": d.get("estimatedFillTimeSec"), "impact": None, "fee_raw": fee}

def lifi(o, dst, tin, tout, amt_raw):
    q = urllib.parse.urlencode({"fromChain": o, "toChain": dst, "fromToken": tin, "toToken": tout, "fromAmount": str(amt_raw), "fromAddress": DEAD, "toAddress": DEAD, "slippage": "0.005"})
    s, d = http("GET", f"https://li.quest/v1/quote?{q}")
    if s != 200: return {"err": f"{s} {d.get('message', str(d))[:80]}"}
    est = d["estimate"]
    gas = sum(float(g.get("amountUSD", 0) or 0) for g in est.get("gasCosts", []))
    fees = sum(float(f.get("amountUSD", 0) or 0) for f in est.get("feeCosts", []) if not f.get("included"))
    return {"out": int(est["toAmount"]), "min": int(est["toAmountMin"]), "gas_usd": gas, "fee_usd": fees, "t": est.get("executionDuration"), "impact": None, "tool": d.get("tool")}

def debridge(o, dst, tin, tout, amt_raw):
    q = urllib.parse.urlencode({"srcChainId": o, "srcChainTokenIn": tin, "srcChainTokenInAmount": str(amt_raw), "dstChainId": dst, "dstChainTokenOut": tout, "dstChainTokenOutAmount": "auto", "prependOperatingExpenses": "false", "dstChainTokenOutRecipient": DEAD, "srcChainOrderAuthorityAddress": DEAD, "dstChainOrderAuthorityAddress": DEAD})
    s, d = http("GET", f"https://dln.debridge.finance/v1.0/dln/order/create-tx?{q}")
    if s != 200: return {"err": f"{s} {d.get('errorMessage', d.get('errorId', str(d)))[:80]}"}
    est = d["estimation"]
    out = int(est["dstChainTokenOut"]["amount"]); mn = int(est["dstChainTokenOut"].get("recommendedAmount", out))
    fix = d.get("fixFee"); gas_usd = None
    if fix: gas_usd = int(fix) / 1e18 * eth_price()
    return {"out": out, "min": mn, "gas_usd": gas_usd, "fee_usd": None, "t": d.get("order", {}).get("approximateFulfillmentDelay"), "impact": None}

PROVIDERS = [("Relay", relay), ("Across", across), ("Li.Fi", lifi), ("deBridge", debridge)]

def main():
    rows = []
    for name, o, dst, tin, tout, dec_in, dec_out, sizes in ROUTES:
        for size in sizes:
            amt_raw = int(round(size * 10 ** dec_in))
            usd_in = size if dec_in == 6 else size * eth_price()
            for pname, fn in PROVIDERS:
                r = fn(o, dst, tin, tout, amt_raw); time.sleep(0.6)
                if "err" in r:
                    rows.append((name, size, usd_in, pname, None, None, None, None, r["err"])); continue
                out_h = r["out"] / 10 ** dec_out
                usd_out = out_h if dec_out == 6 else out_h * eth_price()
                cost_bps = (usd_in - usd_out) / usd_in * 1e4 if usd_in else None
                total_bps = cost_bps + ((r.get("gas_usd") or 0) / usd_in * 1e4 if usd_in else 0)
                rows.append((name, size, usd_in, pname, out_h, cost_bps, total_bps, r.get("t"), r.get("tool") or ""))
    ts = dt.datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")
    md = [f"# Cross-chain price benchmark: Relay vs Across vs Li.Fi vs deBridge ({ts})", "",
          "Same route, same size, same second, all public endpoints without API keys. `Cost` = (USD in − USD out) in bps, i.e. everything the user loses to fees, impact, and any origin gas the provider deducts from output; `+gas` adds the provider's own origin-gas estimate when it reports one (Relay, Li.Fi, deBridge). ETH priced from Relay's token-price endpoint at run time. Script: `scripts/research/bridge_price_bench.py`.", ""]
    cur = None
    for name, size, usd_in, pname, out_h, cost, total, t, note in rows:
        key = (name, size)
        if key != cur:
            cur = key; md += ["", f"## {name}, {size} ({'$%.0f' % usd_in})", "", "| Provider | Output | Cost (bps) | +gas (bps) | ETA (s) | Note |", "|---|---|---|---|---|---|"]
        if out_h is None: md.append(f"| {pname} | — | — | — | — | {note} |")
        else: md.append(f"| {pname} | {out_h:,.6f} | {cost:.2f} | {total:.2f} | {t if t is not None else '—'} | {note} |")
    # winners
    md += ["", "## Cheapest by route and size (by output, before origin gas)", "", "| Route | Size | Winner | Runner-up | Gap (bps) |", "|---|---|---|---|---|"]
    from itertools import groupby
    for key, grp in groupby(rows, key=lambda r: (r[0], r[1])):
        g = sorted([r for r in grp if r[4] is not None], key=lambda r: r[5])
        if len(g) >= 2: md.append(f"| {key[0]} | {key[1]} | {g[0][3]} ({g[0][5]:.2f}) | {g[1][3]} ({g[1][5]:.2f}) | {g[1][5]-g[0][5]:.2f} |")
        elif g: md.append(f"| {key[0]} | {key[1]} | {g[0][3]} ({g[0][5]:.2f}) | — | — |")
    out = "/home/user/suwappubot/docs/research/relay/17-price-benchmark.md"
    open(out, "w").write("\n".join(md) + "\n"); print("\n".join(md))

if __name__ == "__main__":
    main()
