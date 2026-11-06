#!/usr/bin/env python3
"""Pull every escrow from an Arbiter contract via PUBLIC read-only view calls (no keys, no accounts).

  python3 -I extract.py [contract] [rpc]   ->  prints a JSON list of escrows and writes edges.json

Data source = the contract's own state (`total_escrows` + `get_escrow(id)`), not an indexer, so anyone can
re-derive the same graph from one RPC endpoint. A `Paid` escrow with verdict `pass` is an ATTESTED DELIVERY:
buyer -> worker, amount (yocto), rubric, evidence_hash.
"""
import base64, json, sys, urllib.request

CONTRACT = sys.argv[1] if len(sys.argv) > 1 else "arb2.suwappu-arbiter.testnet"
RPC = sys.argv[2] if len(sys.argv) > 2 else "https://test.rpc.fastnear.com"


def view(method, args):
    body = {"jsonrpc": "2.0", "id": 1, "method": "query", "params": {
        "request_type": "call_function", "finality": "final", "account_id": CONTRACT,
        "method_name": method, "args_base64": base64.b64encode(json.dumps(args).encode()).decode()}}
    req = urllib.request.Request(RPC, json.dumps(body).encode(), {"content-type": "application/json", "User-Agent": "arbiter-reputation/0"})
    r = json.loads(urllib.request.urlopen(req, timeout=40).read())
    if "error" in r or "error" in r.get("result", {}):
        raise RuntimeError(json.dumps(r)[:300])
    return json.loads(bytes(r["result"]["result"]).decode())


def main():
    n = view("total_escrows", {})
    escrows = []
    for i in range(n):
        e = view("get_escrow", {"id": i})
        if e:  # refunded escrows are deleted from state
            escrows.append(e)
    edges = []
    for e in escrows:
        attested = e["status"] == "Paid" and e.get("last_verdict") == "pass"
        edges.append({"id": e["id"], "buyer": e["buyer"], "worker": e["worker"], "amount_yocto": e["amount"],
                      "storage_deposit_yocto": e["storage_deposit"], "attested": attested,
                      "rubric": e.get("rubric", "github_pr_v1"), "evidence_hash": e.get("evidence_hash")})
    json.dump(edges, open("edges.json", "w"), indent=1)
    print(f"{CONTRACT}: total_escrows={n}, live={len(escrows)}, attested={sum(x['attested'] for x in edges)}")
    for x in edges:
        print(f"  #{x['id']} {x['buyer']} -> {x['worker']} amount={int(x['amount_yocto'])/1e24:.4f} NEAR "
              f"storage_deposit={int(x['storage_deposit_yocto'])/1e24:.5f} NEAR attested={x['attested']} rubric={x['rubric']}")


main()
