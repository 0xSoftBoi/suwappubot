#!/usr/bin/env python3
"""Run recorded fixtures through the NATIVE arbiter-http build (no network, no wasm runtime needed).

  cd near/arbiter-http && cargo build --release && python3 -I fixtures/run.py

Each case = (name, input terms, fixture "status:body" or None, expected verdict, expected reason).
The native build reads ARBITER_HTTP_FIXTURE instead of fetching; that code is cfg'd out of the wasm artifact.
This checks the rubric logic only. It does NOT prove the wasm component fetches correctly on OutLayer.
"""
import json, os, subprocess, sys, tempfile, hashlib

BIN = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "target", "release", "arbiter-http")
RPC = "https://rpc.testnet.near.org"
BODY = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "query", "params": {
    "request_type": "view_account", "finality": "final", "account_id": "treasury.testnet"}})
ACCT = json.dumps({"jsonrpc": "2.0", "result": {"amount": "2500000000000000000000000", "block_height": 12, "ok": True,
                                                  "name": "treasury", "n": 7, "f": 1.5}, "id": 1})


def base(**kw):
    t = {"context": "http_json_v1", "escrow_id": 1, "url": RPC, "method": "POST", "body": BODY,
         "checks": [{"path": "/result/amount", "op": "gte_int", "value": "1000000000000000000000000"}]}
    t.update(kw)
    return t


def chk(path, op, value=None):
    c = {"path": path, "op": op}
    if value is not None:
        c["value"] = value
    return c


CASES = [
    # --- demo cases (design doc): ~2.5e24 yocto held vs 1e24 / 1e27 thresholds ---
    ("pass: amount >= 1 NEAR", base(), "200:acct", "pass", "checks_satisfied"),
    ("fail: amount >= 1e27 unreachable", base(checks=[chk("/result/amount", "gte_int", "1000000000000000000000000000")]), "200:acct", "fail", "check_failed_0"),
    ("pass: lte_int", base(checks=[chk("/result/amount", "lte_int", "3000000000000000000000000")]), "200:acct", "pass", "checks_satisfied"),
    ("fail: second check reported by index", base(checks=[chk("/result/ok", "eq", True), chk("/result/n", "eq", 8)]), "200:acct", "fail", "check_failed_1"),
    # --- op semantics ---
    ("eq bool", base(checks=[chk("/result/ok", "eq", True)]), "200:acct", "pass", "checks_satisfied"),
    ("eq string", base(checks=[chk("/result/name", "eq", "treasury")]), "200:acct", "pass", "checks_satisfied"),
    ("eq int", base(checks=[chk("/result/n", "eq", 7)]), "200:acct", "pass", "checks_satisfied"),
    ("eq no coercion (string vs int)", base(checks=[chk("/result/n", "eq", "7")]), "200:acct", "fail", "check_failed_0"),
    ("exists", base(checks=[chk("/result/block_height", "exists")]), "200:acct", "pass", "checks_satisfied"),
    ("exists missing path", base(checks=[chk("/result/nope", "exists")]), "200:acct", "fail", "check_failed_0"),
    ("contains", base(checks=[chk("/result/name", "contains", "reas")]), "200:acct", "pass", "checks_satisfied"),
    ("contains on non-string target", base(checks=[chk("/result/n", "contains", "7")]), "200:acct", "fail", "check_failed_0"),
    ("gte_int on float target fails closed", base(checks=[chk("/result/f", "gte_int", "1")]), "200:acct", "fail", "check_failed_0"),
    ("gte_int target is JSON integer", base(checks=[chk("/result/n", "gte_int", 7)]), "200:acct", "pass", "checks_satisfied"),
    ("root pointer exists", base(checks=[chk("", "exists")]), "200:acct", "pass", "checks_satisfied"),
    # --- response handling ---
    ("fail: 301 redirect never trusted", base(), "301:", "fail", "http_status_301"),
    ("fail: 404", base(), "404:", "fail", "http_status_404"),
    ("fail: 429", base(), "429:", "fail", "http_status_429"),
    ("fail: non-JSON body", base(), "200:text", "fail", "bad_json"),
    ("fail: fetch error (no fixture)", base(), None, "fail", "fetch_failed"),
    # --- expect_sha256 ---
    ("sha256 match, no checks", base(checks=[], expect_sha256=hashlib.sha256(ACCT.encode()).hexdigest()), "200:acct", "pass", "checks_satisfied"),
    ("sha256 mismatch", base(checks=[], expect_sha256="0" * 64), "200:acct", "fail", "hash_mismatch"),
    ("sha256 match works on non-JSON body", base(checks=[], expect_sha256=hashlib.sha256(b"not json at all").hexdigest()), "200:text", "pass", "checks_satisfied"),
    # --- term probes: must all be rejected before any fetch ---
    ("reject: http://", base(url="http://rpc.testnet.near.org"), "200:acct", "fail", "invalid_terms"),
    ("reject: IPv4 literal", base(url="https://127.0.0.1/"), "200:acct", "fail", "invalid_terms"),
    ("reject: decimal IPv4", base(url="https://2130706433/"), "200:acct", "fail", "invalid_terms"),
    ("reject: hex IPv4", base(url="https://0x7f.0.0.1/"), "200:acct", "fail", "invalid_terms"),
    ("reject: IPv6", base(url="https://[::1]/"), "200:acct", "fail", "invalid_terms"),
    ("reject: localhost", base(url="https://localhost/"), "200:acct", "fail", "invalid_terms"),
    ("reject: .internal", base(url="https://metadata.google.internal/"), "200:acct", "fail", "invalid_terms"),
    ("reject: port 8080", base(url="https://rpc.testnet.near.org:8080/"), "200:acct", "fail", "invalid_terms"),
    ("reject: userinfo", base(url="https://evil.com@rpc.testnet.near.org/"), "200:acct", "fail", "invalid_terms"),
    ("reject: backslash authority trick", base(url="https://rpc.testnet.near.org\\@evil.com/"), "200:acct", "fail", "invalid_terms"),
    ("reject: whitespace in url", base(url="https://rpc.testnet.near.org/a b"), "200:acct", "fail", "invalid_terms"),
    ("reject: url > 300", base(url="https://a.example.com/" + "x" * 300), "200:acct", "fail", "invalid_terms"),
    ("reject: 5 checks", base(checks=[chk("/result/n", "exists")] * 5), "200:acct", "fail", "invalid_terms"),
    ("reject: float value", base(checks=[chk("/result/n", "gte_int", 1.5)]), "200:acct", "fail", "invalid_terms"),
    ("reject: leading-zero int string", base(checks=[chk("/result/n", "gte_int", "007")]), "200:acct", "fail", "invalid_terms"),
    ("reject: int string > 38 digits", base(checks=[chk("/result/n", "gte_int", "1" * 39)]), "200:acct", "fail", "invalid_terms"),
    ("reject: unknown op", base(checks=[chk("/result/n", "regex", ".*")]), "200:acct", "fail", "invalid_terms"),
    ("reject: exists with value", base(checks=[chk("/result/n", "exists", 1)]), "200:acct", "fail", "invalid_terms"),
    ("reject: bad pointer escape", base(checks=[chk("/a~2b", "exists")]), "200:acct", "fail", "invalid_terms"),
    ("reject: pointer without leading slash", base(checks=[chk("result", "exists")]), "200:acct", "fail", "invalid_terms"),
    ("reject: POST body > 512", base(body=json.dumps({"x": "y" * 600})), "200:acct", "fail", "invalid_terms"),
    ("reject: POST body not JSON", base(body="not json"), "200:acct", "fail", "invalid_terms"),
    ("reject: POST with empty body", base(body=""), "200:acct", "fail", "invalid_terms"),
    ("reject: GET with body", base(method="GET"), "200:acct", "fail", "invalid_terms"),
    ("reject: method PUT", base(method="PUT"), "200:acct", "fail", "invalid_terms"),
    ("reject: no checks and no hash", base(checks=[]), "200:acct", "fail", "invalid_terms"),
    ("reject: bad sha256 format", base(checks=[], expect_sha256="ABC"), "200:acct", "fail", "invalid_terms"),
    ("reject: github_pr_v1 context", base(context="github_pr_v1"), "200:acct", "fail", "unknown_context"),
    ("reject: contains empty needle", base(checks=[chk("/result/name", "contains", "")]), "200:acct", "fail", "invalid_terms"),
]


def main():
    if not os.path.exists(BIN):
        sys.exit("build first: cargo build --release")
    tmp = tempfile.mkdtemp()
    files = {"acct": ACCT.encode(), "text": b"not json at all", "": b""}
    paths = {}
    for k, v in files.items():
        p = os.path.join(tmp, "f_" + (k or "empty"))
        open(p, "wb").write(v)
        paths[k] = p
    bad = 0
    for name, terms, fx, want_v, want_r in CASES:
        env = dict(os.environ)
        env.pop("ARBITER_HTTP_FIXTURE", None)
        if fx is not None:
            status, key = fx.split(":", 1)
            env["ARBITER_HTTP_FIXTURE"] = f"{status}:{paths[key] if key else ''}"
        r = subprocess.run([BIN], input=json.dumps(terms).encode(), capture_output=True, env=env, timeout=10)
        try:
            out = json.loads(r.stdout)
        except Exception:
            out = {"verdict": "CRASH", "reason": (r.stdout + r.stderr).decode()[:120]}
        ok = out.get("verdict") == want_v and out.get("reason") == want_r
        extra = ""
        if ok and len(r.stdout) >= 900:
            ok, extra = False, f" output {len(r.stdout)}B >= 900"
        if ok and out.get("rubric") != "http_json_v1":
            ok, extra = False, " rubric echo wrong"
        if ok and out.get("escrow_id") != terms["escrow_id"]:
            ok, extra = False, " escrow_id echo wrong"
        print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  want {want_v}/{want_r} got {out.get('verdict')}/{out.get('reason')}{extra}"))
        bad += 0 if ok else 1
    # malformed stdin must fail closed too
    r = subprocess.run([BIN], input=b"{nope", capture_output=True, timeout=10)
    o = json.loads(r.stdout)
    ok = o["verdict"] == "fail" and o["reason"] == "bad_input_json"
    print(("ok   " if ok else "FAIL ") + "malformed stdin fails closed")
    bad += 0 if ok else 1
    print(f"\n{len(CASES) + 1 - bad}/{len(CASES) + 1} passed")
    sys.exit(1 if bad else 0)


main()
