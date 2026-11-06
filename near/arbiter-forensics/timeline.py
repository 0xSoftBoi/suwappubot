import json, urllib.request

RPC = "https://test.rpc.fastnear.com"
W = "worker.suwappu-arbiter.testnet"
TX = "4AKsjZoU6NrnsLBJ5Vq3MpWHBXL146yVKbwfhZUUAN9j"  # esc0 resolve #2 (unexpected fail)
H0 = 276433838


def rpc(method, params):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}, separators=(",", ":")).encode()
    req = urllib.request.Request(RPC, body, {"content-type": "application/json", "User-Agent": "forensics-readonly/1"})
    return json.loads(urllib.request.urlopen(req, timeout=40).read())


print("worker balance per block around the resolve (tx included in block %d):" % H0)
prev = None
for h in range(H0 - 2, H0 + 16):
    r = rpc("query", {"request_type": "view_account", "block_id": h, "account_id": W})
    a = int(r["result"]["amount"]) / 1e24 if "result" in r else None
    d = "" if prev is None or a is None else f"  ({a - prev:+.4f})"
    print(f"  {h}: {a:.4f}{d}" if a is not None else f"  {h}: n/a")
    prev = a if a is not None else prev

r = rpc("tx", [TX, W])["result"]
to = r["transaction"]
print("\ntx: signer", to["signer_id"], "receiver", to["receiver_id"])
for act in to["actions"]:
    fc = act.get("FunctionCall")
    if fc:
        print("  action FunctionCall", fc["method_name"], "gas", fc["gas"] / 1e12, "Tgas", "deposit", int(fc["deposit"]) / 1e24)
print("transaction_outcome tokens_burnt", int(r["transaction_outcome"]["outcome"]["tokens_burnt"]) / 1e24)
for o in r["receipts_outcome"]:
    out = o["outcome"]
    print(f"  receipt {o['id'][:8]} exec={out['executor_id']} gas_burnt={out['gas_burnt']/1e12:.1f}T tokens_burnt={int(out['tokens_burnt'])/1e24:.5f}",
          "status", list(out["status"].keys())[0] if isinstance(out["status"], dict) else out["status"])
for rc in r.get("receipts", []):
    acts = rc["receipt"]["Action"]["actions"] if isinstance(rc["receipt"], dict) and "Action" in rc["receipt"] else []
    for a in acts:
        if "FunctionCall" in a:
            fc = a["FunctionCall"]
            print(f"  receipt-action {rc['predecessor_id']} -> {rc['receiver_id']}.{fc['method_name']} gas={fc['gas']/1e12:.0f}T deposit={int(fc['deposit'])/1e24:.4f}")
        elif "Transfer" in a:
            print(f"  receipt-action {rc['predecessor_id']} -> {rc['receiver_id']} Transfer {int(a['Transfer']['deposit'])/1e24:.4f}")
