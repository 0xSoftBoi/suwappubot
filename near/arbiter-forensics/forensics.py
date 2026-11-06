"""Read-only forensics: which block did the OutLayer enclave actually read?
evidence_hash = sha256(raw RPC response body). Re-fetch view_account at candidate blocks from the SAME RPC,
hash the raw bytes, and match against the on-chain evidence hashes."""
import hashlib, json, urllib.request
from concurrent.futures import ThreadPoolExecutor

RPC = "https://test.rpc.fastnear.com"
WORKER = "worker.suwappu-arbiter.testnet"
RUNS = {  # resolve tx -> (evidence_hash prefix, note)
    "CoaqcF4iFaKxkgedX49RtGScw369S2DMv8pQ5nW82oHc": ("743f57752f0c", "esc0 resolve#1 (worker 0.84, fail was correct)"),
    "4AKsjZoU6NrnsLBJ5Vq3MpWHBXL146yVKbwfhZUUAN9j": ("acd0f4417ae8", "esc0 resolve#2 after +0.3 transfer (unexpected fail)"),
    "5ysybF2HFQq1AckHWazeNdz7XTLfG1qGYCkRPdZZUvKn": ("aca9f29ddc43", "esc0 resolve#3 (unexpected fail)"),
    "EvPhBAGy4CUnCj2uL4pbVk5PNrrNQWDck9toFn58QA2V": ("c35557b94a8f", "esc1 diag (unexpected fail, check_failed_3)"),
    "437b1hxni7Qprk4PmcUMG6Z33yQ77EWjnxoFHDQSFTSh": ("afa0a1f99854", "esc5 ladder (unexpected fail)"),
}


def rpc(method, params, raw=False):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}, separators=(",", ":")).encode()
    req = urllib.request.Request(RPC, body, {"content-type": "application/json", "User-Agent": "forensics-readonly/1"})
    data = urllib.request.urlopen(req, timeout=40).read()
    return data if raw else json.loads(data)


def height_of_tx(h):
    r = rpc("tx", [h, WORKER])["result"]
    blk = rpc("block", {"block_id": r["transaction_outcome"]["block_hash"]})["result"]["header"]["height"]
    # the receipts (OutLayer execution + callback) land a few blocks later
    last = max(o["block_hash"] for o in r["receipts_outcome"]) if r.get("receipts_outcome") else None
    lblk = rpc("block", {"block_id": last})["result"]["header"]["height"] if last else blk
    return blk, lblk


def body_at(height):
    return rpc("query", {"request_type": "view_account", "block_id": height, "account_id": WORKER}, raw=True)


def match(run):
    h, (prefix, note) = run
    b0, b1 = height_of_tx(h)
    # the enclave reads "finality: final" at some time between tx inclusion and the callback; scan a generous window back and forward
    lo, hi = b0 - 12, b1 + 12
    found = None
    for height in range(lo, hi + 1):
        try:
            body = body_at(height)
        except Exception:
            continue
        if hashlib.sha256(body).hexdigest().startswith(prefix):
            j = json.loads(body)["result"]
            found = (height, int(j["amount"]) / 1e24)
            break
    return note, b0, b1, found


with ThreadPoolExecutor(5) as ex:
    for note, b0, b1, found in ex.map(match, RUNS.items()):
        if found:
            print(f"MATCH  {note}\n       resolve tx block={b0}, last receipt block={b1}; enclave read block {found[0]} "
                  f"(resolve+{found[0]-b0}) amount={found[1]:.4f} NEAR")
        else:
            print(f"no match in window [{b0-12},{b1+12}]  {note}")
