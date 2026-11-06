import sys, random, json
sys.path.insert(0, "/home/mongolraider/suwappu/.claude/worktrees/propamm-guide/docs/research/fermi-engine/decomp2/w")
sys.path.insert(0, "/home/mongolraider/suwappu/.claude/worktrees/propamm-guide/docs/research/fermi-engine/decomp2")
from fermi import rpc, keccak, pad, live, load_cfg, TOK, VAULT, ENG, pair_id
import final_model as fm

N = int(sys.argv[1]); seed = int(sys.argv[2])
random.seed(seed)
latest = int(rpc("eth_blockNumber", [])["result"], 16) - 2
blk = hex(latest)
hx = lambda v: "0x%064x" % v
SLOT = {"WETH": 3, "USDT": 2, "USDC": 9}
def bslot(sym): return hx(int(keccak(pad(VAULT) + pad("%x" % SLOT[sym])), 16))
def capslot(sym): return int(keccak(pad(TOK[sym][0]) + pad("8")), 16)
def st(a, s):
    return int(rpc("eth_getStorageAt", [a, hx(s), blk])["result"], 16)
caps = {k: st(ENG, capslot(k)) for k in TOK}
print("block", latest, "caps", {k: v / 10 ** TOK[k][1] for k, v in caps.items()})
PAIRS = [("WETH", "USDT"), ("WETH", "USDC"), ("USDC", "USDT")]
tot = 0; exact = 0; worst = 0; revmatch = 0; revmis = 0; lines = []
for (b, q) in PAIRS:
    cfg = load_cfg(TOK[b][0], TOK[q][0], blk)
    if cfg is None:
        print("no cfg", b, q); continue
    c = dict(head=cfg["w"][0], lim=cfg["w"][1], a1=cfg["a1"], a2=cfg["a2"])
    pid = cfg["pid"]; inner = keccak(pad(pid) + pad("7"))
    sb, sq = 10 ** TOK[b][1], 10 ** TOK[q][1]
    print(b, q, "head", hex(c["head"]), "lim", hex(c["lim"]), "n1/n2", len(c["a1"]), len(c["a2"]))
    for k in range(N):
        fwd = random.random() < 0.5
        if b == "USDC":
            p = int(random.uniform(0.998, 1.002) * 1e8); Bb = int(10 ** random.uniform(5, 6.5) * sb); Bq = int(10 ** random.uniform(5, 6.5) * sq)
        else:
            p = int(random.uniform(2300, 2700) * 1e8); Bb = int(random.uniform(0, 1700) * sb); Bq = int(10 ** random.uniform(4.5, 6.5) * sq)
        usd = 10 ** random.uniform(0.5, 6.7)
        if fwd:
            amt = int(usd * 1e8 * sb / p) if True else 0
        else:
            amt = int(usd * sq)
        acc = 0
        ov = {TOK[b][0]: {"stateDiff": {bslot(b): hx(Bb)}}, TOK[q][0]: {"stateDiff": {bslot(q): hx(Bq)}}}
        if random.random() < 0.5:
            acc = int(10 ** random.uniform(8, 12.3))
            dirn = 0 if fwd else 1
            slot = int(keccak(pad("%x" % dirn) + pad(inner)), 16)
            ov.setdefault(ENG, {"stateDiff": {}})["stateDiff"][hx(slot)] = hx((acc << 64) | latest)
        sel = "d6b0bdd5" if random.random() < 0.6 else "c9e270d0"
        tin, tout = (b, q) if fwd else (q, b)
        ws, err = live(sel, tin, tout, amt, p, blk, ov)
        cap_in = caps[tin]
        try:
            out, d = fm.quote(c, p, fwd, amt, Bb, Bq, sb, sq, acc_same_block=acc, cap_in=cap_in)
            mres = out
        except fm.Revert as e:
            mres = "R:" + str(e)
        tot += 1
        if ws is not None:
            lv = ws[1]
            if isinstance(mres, int):
                dd = abs(mres - lv); rel = dd / max(lv, 1)
                worst = max(worst, rel)
                if dd == 0: exact += 1
                else: lines.append("MISMATCH %s/%s %s %s amt=%d Bb=%d Bq=%d p=%d acc=%d live=%d model=%d rel=%.3e" % (b, q, sel, "fwd" if fwd else "rev", amt, Bb, Bq, p, acc, lv, mres, rel))
            else:
                revmis += 1; lines.append("MISMATCH(model reverts, live ok) %s/%s %s %s amt=%d usd=%.0f %s live=%d" % (b, q, sel, "fwd" if fwd else "rev", amt, usd, mres, lv))
        else:
            e = str(err)
            code = bytes.fromhex(e[2 + 8 + 128:2 + 8 + 128 + 2 * int(e[2 + 8 + 64:2 + 8 + 128], 16)]).decode() if e.startswith("0x08c379a0") else e[:20]
            if mres == "R:" + code: revmatch += 1; exact += 1
            else: revmis += 1; lines.append("MISMATCH(live reverts %s) %s/%s %s %s amt=%d usd=%.0f model=%s" % (code, b, q, sel, "fwd" if fwd else "rev", amt, usd, mres))
print("TOTAL", tot, "exact", exact, "(of which matching reverts %d)" % revmatch, "worst rel err on successful quotes", worst)
print("\n".join(lines[:40]))
